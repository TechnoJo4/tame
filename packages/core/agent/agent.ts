import { Compile, type Validator } from "typebox/compile";
import type { TSchema } from "typebox";
import {
	Emitter,
	handlerWrapperSkipErrors,
	ValidationError,
	assertSchema,
	type InferenceProvider,
	type InputMessage,
	type ToolUse,
	type AnyTool,
	type Tool,
	type IAgent,
	type AgentEvents,
	type UserMessageEvent,
	type AssistantMessageEvent,
	type ToolResultEvent,
	type CompletionEvent,
	type IdleEvent,
	type AgentStopReason,
} from "@tame/sdk";

export type { AgentStopReason };
export type { UserMessageEvent, AssistantMessageEvent, ToolResultEvent, CompletionEvent, IdleEvent, AgentEvents };

export class Agent extends Emitter<AgentEvents> implements IAgent {
	#id: string;
	#pendingToolCalls = new Set<string>();
	#abortedToolCalls = new Set<string>();
	#completionQueued = false;
	#validators = new Map<AnyTool, Validator<any>>();

	llm: InferenceProvider;
	system: string;
	title?: string;
	context: InputMessage[] = [];
	tools = new Map<string, AnyTool>();
	pluginData = new Map<symbol, unknown>();

	constructor(llm: InferenceProvider, system: string, id?: string) {
		super();
		this.wrapHandler = handlerWrapperSkipErrors;
		this.llm = llm;
		this.system = system;
		this.#id = id ?? Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		this.after("userMessage", async (e: UserMessageEvent) => {
			this.context.push(e.msg);
			this.queueCompletion();
			return e;
		});

		this.after("assistantMessage", async (e: AssistantMessageEvent) => {
			const i = this.context.push(e.msg) - 1;
			const calls = e.msg.content.filter(c => c.type === "tool_use");
			if (calls.length > 0) {
				this.thread.queue(async () => {
					for (const call of calls) {
						const tool = this.tools.get(call.name);
						if (tool)
							this.#execTool(tool, call, i);
						else
							this.fire("toolResult", {
								error: true,
								toolUse: call.id,
								result: `tool "${call.name}" not found`,
								messageIdx: i
							});
					}
				});
			}
			else
				this.fire("idle", { stopReason: e.msg.stop_reason });
			return e;
		});

		this.after("toolResult", async (e: ToolResultEvent) => {
			const call = this.context[e.messageIdx].content.find(c => c.type === "tool_use" && c.id === e.toolUse)! as ToolUse;
			call.result = {
				type: "tool_result",
				is_error: e.error,
				content: e.result
			};

			this.#pendingToolCalls.delete(e.toolUse);
			if (this.#pendingToolCalls.size === 0 && !this.#abortedToolCalls.has(e.toolUse))
				this.queueCompletion();

			return e;
		});

		this.after("completion", async (e) => {
			const signal = this.signal!;
			try {
				const msg = await this.llm.complete(e.req, signal);
				this.#completionQueued = false;
				this.fire("assistantMessage", { msg });
			} catch {
				this.#completionQueued = false;
				if (signal.aborted)
					this.fire("idle", { stopReason: "aborted" });
				else if (e.retriesLeft > 0)
					this.queueCompletion(e.retriesLeft - 1);
				else
					this.fire("idle", { stopReason: "error" });
			}
			return e;
		});
	}

	get id() {
		return this.#id;
	}

	override abort(): void {
		super.abort();
		for (const t of this.#pendingToolCalls)
			this.#abortedToolCalls.add(t);
		this.#pendingToolCalls.clear();
		this.#completionQueued = false;
		this.fire("idle", { stopReason: "aborted" });
	}

	queueCompletion(maxRetries: number = 5) {
		if (!this.#completionQueued && this.#pendingToolCalls.size === 0) {
			this.#completionQueued = true;
			this.thread.queue(async () => {
				this.fire("completion", {
					retriesLeft: maxRetries,
					req: {
						max_tokens: 32000,
						system: this.system,
						session_id: this.id,
						messages: structuredClone(this.context),
						tools: this.tools.values().map(t => ({
							name: t.name,
							description: t.desc,
							input_schema: t.args
						})).toArray()
					}
				});
			});
		}
	}

	addTool(tool: AnyTool) {
		this.tools.set(tool.name, tool);
		this.#validators.set(tool, Compile(tool.args));
	}

	viewToolCall(view: string, call: ToolUse) {
		try {
			const tool = this.tools.get(call.name)! as Tool<TSchema>;
			assertSchema(call.input, tool.args, "", this.#validators.get(tool)!);
			return tool.view?.[view]?.(call.input, call.result);
		} catch (e) {
			if (!(e instanceof ValidationError)) {
				console.warn("error while viewing tool call:", call, e);
			}
			return undefined;
		}
	}

	async #execTool(tool: AnyTool, call: ToolUse, messageIdx: number) {
		this.#pendingToolCalls.add(call.id);
		try {
			const args = assertSchema(call.input, tool.args, `invalid args to "${call.name}":`, this.#validators.get(tool)!);

			let res = await (tool as Tool<TSchema>).exec(args, this);
			if (typeof res !== "string")
				res = JSON.stringify(res);

			this.fire("toolResult", {
				toolUse: call.id,
				error: false,
				result: res as string,
				messageIdx
			});
		} catch (e) {
			this.fire("toolResult", {
				toolUse: call.id,
				error: true,
				result: e instanceof Error ? e.message : e as string,
				messageIdx
			});
		}
	}
}
