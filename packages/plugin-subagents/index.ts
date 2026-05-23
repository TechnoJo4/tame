import { type Plugin, tool, Type, type IAgent, type IHarness } from "@tame/sdk";
import type { ToolResult } from "@tame/sdk";

// ---- agent definitions ----

export interface AgentDefinition {
	/** Unique type name, used as subagent_type in the tool call. */
	type: string;
	/** Description shown to the calling agent (via context, not the tool schema). */
	whenToUse: string;
	/** System prompt for this agent type. */
	systemPrompt: string;
	/**
	 * Optional tool allowlist. If omitted, inherits all parent tools.
	 * The subagent tool is removed at maxDepth; it is NOT automatically excluded
	 * when tools is omitted — bump maxDepth above 1 and subagents can spawn
	 * further subagents unless the depth guard fires.
	 */
	tools?: string[];
}

// ---- config ----

// Type.Number used here rather than Type.Integer because the SDK re-exports
// typebox with no Integer alias. Floats get truncated to integers at runtime.
export const configSchema = Type.Object({
	maxDepth: Type.Number({ default: 1, description: "Maximum nesting depth. 0 = no subagents, 1 = top-level only." }),
	maxToolResultLength: Type.Number({ default: 2000, description: "Truncate tool results in the output summary." }),
});

export type SubagentsConfig = { maxDepth: number; maxToolResultLength: number };

// ---- plugin data keys ----

export const depthKey = Symbol("tame:subagents:depth");

// ---- default agent ----

const DEFAULT_AGENT: AgentDefinition = {
	type: "general-purpose",
	whenToUse: "multi-step research and code search",
	systemPrompt: [
		"You are a subagent. Complete the given task and report your findings concisely.",
		"",
		"Guidelines:",
		"- Be thorough but don't gold-plate.",
		"- Report what was done and any key findings.",
		"- If the task can't be completed, explain why and suggest next steps.",
		"- Never create files unless explicitly asked.",
		"- Never proactively create documentation files (*.md) or README files.",
	].join("\n"),
};

// ---- async task tracking ----

interface AsyncTask {
	agent: IAgent;
	parentId: string;
	description: string;
}

// ---- plugin ----

export class SubagentsPlugin implements Plugin {
	id = "subagents" as const;
	enabled?: true;

	#config: SubagentsConfig;
	#agents = new Map<string, AgentDefinition>();
	#tasks = new Map<string, AsyncTask>();
	#harness: IHarness | undefined;

	constructor(config: SubagentsConfig) {
		this.#config = config;
		this.#agents.set(DEFAULT_AGENT.type, DEFAULT_AGENT);
	}

	/** Register an agent definition. Call from other plugins' init(). */
	registerAgent(def: AgentDefinition): void {
		this.#agents.set(def.type, def);
	}

	/** Get a registered agent definition. */
	getAgent(type: string): AgentDefinition | undefined {
		return this.#agents.get(type);
	}

	/** List all registered agent definitions. */
	listAgents(): AgentDefinition[] {
		return [...this.#agents.values()];
	}

	/** List IDs of currently running background subagents. */
	listRunning(): string[] {
		return [...this.#tasks.keys()];
	}

	async init(harness: IHarness) {
		this.#harness = harness;
		harness.addTools(this.#subagentTool(harness), this.#killSubagentTool());
	}

	newAgent(agent: IAgent) {
		agent.pluginData.set(depthKey, 0);
	}

	// ---- notification injection ----

	/** Fire a notification user message into the parent agent. */
	#notify(agentId: string, description: string, status: "completed" | "failed", text: string) {
		const parent = this.#harness?.getAgent(agentId);
		if (!parent) return; // parent may have been GC'd

		const header = status === "completed"
			? `[Subagent "${description}" completed]`
			: `[Subagent "${description}" failed]`;

		parent.fire("userMessage", {
			msg: {
				role: "user",
				content: [{ type: "text", text: `${header}\n\n${text}` }],
			},
		});
	}

	// ---- shared subagent setup ----

	#setupSubagent(
		harness: IHarness,
		parentAgent: IAgent,
		args: { description: string; prompt: string; subagent_type?: string },
	): { subagent: IAgent; assistantTexts: string[] } | { status: "error"; error: string } {
		const depth = (parentAgent.pluginData.get(depthKey) as number) ?? 0;
		if (depth >= this.#config.maxDepth) {
			return { status: "error", error: `Max subagent depth (${this.#config.maxDepth}) reached.` };
		}

		if (parentAgent.signal?.aborted) {
			return { status: "error", error: "Parent agent was aborted." };
		}

		const def = args.subagent_type
			? this.#agents.get(args.subagent_type)
			: this.#agents.get("general-purpose");
		if (!def) {
			return {
				status: "error",
				error: `Unknown subagent type: "${args.subagent_type}". Available: ${[...this.#agents.keys()].join(", ")}`,
			};
		}

		const systemPrompt = [
			def.systemPrompt,
			"",
			`Your task: ${args.description}`,
		].join("\n");

		const subagent = harness.newAgent(parentAgent.llm, systemPrompt);
		subagent.pluginData.set(depthKey, depth + 1);

		// filter tools if the definition has an allowlist
		if (def.tools) {
			const allowed = new Set(def.tools);
			for (const [name] of subagent.tools) {
				if (!allowed.has(name)) subagent.tools.delete(name);
			}
		}

		// prevent recursion: remove subagent tool at max depth
		if (depth + 1 >= this.#config.maxDepth) {
			subagent.tools.delete("subagent");
			subagent.tools.delete("kill_subagent");
		}

		const assistantTexts: string[] = [];
		subagent.after("assistantMessage", async (e) => {
			const text = e.msg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (text) assistantTexts.push(text);
			return e;
		});

		return { subagent, assistantTexts };
	}

	/** Collect tool call summary from context. */
	#collectToolCalls(
		context: IAgent["context"],
		maxLen: number,
	): { name: string; result: string; error: boolean }[] {
		const resultMap = new Map<string, ToolResult>();
		for (const m of context) {
			if (m.role !== "user") continue;
			for (const c of m.content) {
				if (c.type === "tool_result") resultMap.set(c.tool_use_id, c as ToolResult);
			}
		}

		const toolCalls: { name: string; result: string; error: boolean }[] = [];
		for (const msg of context) {
			if (msg.role !== "assistant") continue;
			for (const c of msg.content) {
				if (c.type !== "tool_use") continue;
				const rb = resultMap.get(c.id);
				let resultText = rb?.content ?? "(no result)";
				if (resultText.length > maxLen) {
					resultText = resultText.slice(0, maxLen) +
						`\n[... ${resultText.length - maxLen} more characters]`;
				}
				toolCalls.push({
					name: c.name,
					result: resultText,
					error: rb?.is_error ?? false,
				});
			}
		}
		return toolCalls;
	}

	// ---- the subagent tool ----

	#subagentTool(harness: IHarness) {
		const agentList = () =>
			[...this.#agents.values()]
				.map((a) => `- ${a.type}: ${a.whenToUse}`)
				.join("\n");

		// agentList() is captured once at init() time when the tool is registered.
		// Agents registered by other plugins after init() won't appear in the
		// tool description but will resolve correctly at runtime via exec().

		return tool({
			name: "subagent",
			desc: [
				"Launch a subagent to handle a complex, multi-step task autonomously.",
				"",
				"Available agent types (use the subagent_type parameter to select):",
				agentList(),
				"",
				"Usage notes:",
				"- Always include a short description (3-5 words) summarizing the task.",
				"- The subagent starts fresh — it doesn't see your conversation. Give it full context in the prompt.",
				"- The subagent returns a single result. Summarize it for the user if needed.",
				"- Launch multiple subagents concurrently by issuing several subagent calls in one message.",
				"- Set run_in_background to true to run the subagent asynchronously. You'll be notified when it completes.",
				"  Use this when you have independent work to do in parallel.",
			].join("\n"),
			args: Type.Object({
				description: Type.String({ description: "A short (3-5 word) description of the task" }),
				prompt: Type.String({
					description:
						"The task for the subagent to perform. Include all necessary context — the subagent starts fresh.",
				}),
				subagent_type: Type.Optional(
					Type.String({
						description: "Type of agent to use. Omit for general-purpose.",
					}),
				),
				run_in_background: Type.Optional(
					Type.Boolean({
						default: false,
						description:
							"Run asynchronously. Returns immediately with agentId; a notification is injected when the subagent finishes.",
					}),
				),
			}),
			exec: async (args, parentAgent) => {
				const setup = this.#setupSubagent(harness, parentAgent, args);
				if ("status" in setup) return setup;

				const { subagent, assistantTexts } = setup;

				// propagate parent abort to subagent
				const onParentAbort = () => subagent.abort();
				parentAgent.signal?.addEventListener("abort", onParentAbort, { once: true });

				// kick off
				subagent.fire("userMessage", {
					msg: {
						role: "user",
						content: [{ type: "text", text: args.prompt }],
					},
				});

				// ---- async path ----
				if (args.run_in_background) {
					this.#tasks.set(subagent.id, {
						agent: subagent,
						parentId: parentAgent.id,
						description: args.description,
					});

					// detach: when the subagent finishes, notify the parent
					subagent.waitFor("idle").then((idle) => {
						this.#tasks.delete(subagent.id);
						parentAgent.signal?.removeEventListener("abort", onParentAbort);

						if (idle.stopReason === "error") {
							this.#notify(parentAgent.id, args.description, "failed",
								"LLM error or max retries exceeded.");
						} else if (idle.stopReason === "aborted") {
							this.#notify(parentAgent.id, args.description, "failed",
								"Subagent was aborted.");
						} else if (idle.stopReason === "refusal") {
							this.#notify(parentAgent.id, args.description, "failed",
								assistantTexts.join("\n\n") || "Subagent refused the task.");
						} else if (idle.stopReason !== "end_turn" && idle.stopReason !== "tool_use") {
							this.#notify(parentAgent.id, args.description, "failed",
								`Subagent stopped unexpectedly: ${idle.stopReason}.`);
						} else {
							const toolCalls = this.#collectToolCalls(
								subagent.context,
								this.#config.maxToolResultLength,
							);
							const result = assistantTexts.join("\n\n") || "(no output)";
							let text = result;
							if (toolCalls.length) {
								const summary = toolCalls
									.map((tc) => `${tc.name}${tc.error ? " (error)" : ""}`)
									.join(", ");
								text += `\n\n_tools used: ${summary}_`;
							}
							this.#notify(parentAgent.id, args.description, "completed", text);
						}

						subagent.abort();
						subagent.pluginData.clear();
					});

					return {
						status: "async_launched",
						agentId: subagent.id,
						description: args.description,
						prompt: args.prompt,
					};
				}

				// ---- sync path ----
				try {
					const idle = await subagent.waitFor("idle");

					if (idle.stopReason === "error") {
						return {
							status: "error",
							error: "Subagent failed: LLM error or max retries exceeded.",
							agentId: subagent.id,
						};
					}

					if (idle.stopReason === "aborted") {
						return {
							status: "error",
							error: "Subagent was aborted.",
							agentId: subagent.id,
						};
					}

					if (idle.stopReason === "refusal") {
						return {
							status: "error",
							error: assistantTexts.join("\n\n") || "Subagent refused the task.",
							agentId: subagent.id,
						};
					}

					if (idle.stopReason !== "end_turn" && idle.stopReason !== "tool_use") {
						return {
							status: "error",
							error: `Subagent stopped unexpectedly: ${idle.stopReason}.`,
							agentId: subagent.id,
						};
					}

					const toolCalls = this.#collectToolCalls(
						subagent.context,
						this.#config.maxToolResultLength,
					);

					return {
						status: "completed",
						result: assistantTexts.join("\n\n") || "(no output)",
						agentId: subagent.id,
						toolCalls,
					};
				} finally {
					parentAgent.signal?.removeEventListener("abort", onParentAbort);
					subagent.abort();
					subagent.pluginData.clear();
				}
			},
			view: {
				compact: (args, result) => {
					const desc = args.description ?? "Subagent";
					const type = args.subagent_type ? ` (${args.subagent_type})` : "";
					let summary = `Subagent${type}: ${desc}`;
					if (result?.content) {
						try {
							const parsed = JSON.parse(result.content);
							if (parsed.status === "completed") {
								const preview = parsed.result.slice(0, 120);
								summary += ` — ${preview}${parsed.result.length > 120 ? "…" : ""}`;
							} else if (parsed.status === "async_launched") {
								summary += ` [background]`;
							} else {
								summary += ` — ${parsed.error}`;
							}
						} catch { summary += ` — ${result.content.slice(0, 120)}`; }
					}
					return summary;
				},
				acp: (args, result) => {
					let text = "";
					if (result?.content) {
						try {
							const parsed = JSON.parse(result.content);
							if (parsed.status === "completed") {
								text = parsed.result;
								if (parsed.toolCalls?.length) {
									const summary = parsed.toolCalls
										.map((tc: { name: string }) => tc.name)
										.join(", ");
									text += `\n\n_${parsed.toolCalls.length} tool calls: ${summary}_`;
								}
							} else if (parsed.status === "async_launched") {
								text = `Running in background (agentId: ${parsed.agentId})`;
							} else {
								text = `Error: ${parsed.error}`;
							}
						} catch {
							text = result.content;
						}
					}
					return {
						kind: "think",
						title: `Subagent: ${args.description ?? "Subagent"}`,
						content: text ? [{
							"type": "content",
							"content": { "type": "text", "text": text },
						}] : [],
					};
				},
			},
		});
	}

	// ---- kill_subagent tool ----

	#killSubagentTool() {
		return tool({
			name: "kill_subagent",
			desc: [
				"Abort a running background subagent.",
				"Use the agentId returned by the subagent tool's async_launched response.",
			].join("\n"),
			args: Type.Object({
				agentId: Type.String({ description: "The agentId of the background subagent to kill." }),
			}),
			exec: async (args) => {
				const task = this.#tasks.get(args.agentId);
				if (!task) {
					return { status: "error", error: `No running subagent with id "${args.agentId}".` };
				}

				task.agent.abort();
				this.#tasks.delete(args.agentId);
				this.#notify(task.parentId, task.description, "failed", "Subagent was killed.");

				return { status: "killed", agentId: args.agentId };
			},
			view: {
				compact: (args) => `Kill subagent ${args.agentId}`,
				acp: (args) => ({
					kind: "think",
					title: `Kill subagent ${args.agentId}`,
				}),
			},
		});
	}
}
