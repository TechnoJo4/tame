import { Compile, Validator } from "typebox/compile";
import { TSchema } from "typebox";
import { Thread } from "../util/thread.ts";
import { Emitter } from "../util/emitter.ts";
import type { InferenceProvider, InputMessage, UserMessage, AssistantMessage, ToolUse, StopReason, MessageRequest } from "../llm/types.ts";
import type { AnyTool, Tool } from "./tool.ts";
import { assertSchema } from "../util/validate.ts";

export type AgentStopReason = StopReason | "aborted" | "error";

export interface UserMessageEvent {
	msg: UserMessage
};

export interface AssistantMessageEvent {
	msg: AssistantMessage
};

export interface ToolResultEvent {
	toolUse: string;
	error: boolean;
	result: string;
};

export interface CompletionEvent {
	retriesLeft: number;
	req: MessageRequest;
};

export interface IdleEvent {
	stopReason: AgentStopReason
};

export interface AgentEvents {
	userMessage: UserMessageEvent;
	assistantMessage: AssistantMessageEvent;
	toolResult: ToolResultEvent;
	completion: CompletionEvent;
	idle: IdleEvent;
};

export class Agent extends Emitter<AgentEvents> {
	#id: string;
	#thread = new Thread();
	#pendingToolCalls = new Set<string>();
	#abortedToolCalls = new Set<string>();
	#completionQueued = false;
	#validators = new Map<AnyTool, Validator<any>>();

	llm: InferenceProvider;
	system: string;
	context: InputMessage[] = [];
	tools = new Map<string, AnyTool>();
	pluginData = new Map<symbol, unknown>();

	constructor(llm: InferenceProvider, system: string, id?: string) {
		super();
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
			this.context.push(e.msg);
			const calls = e.msg.content.filter(c => c.type === "tool_use");
			if (calls.length > 0)
				this.#thread.queue(async () => {
					for (const call of calls) {
						const tool = this.tools.get(call.name);
						if (tool)
							this.#execTool(tool, call)
						else
							this.fire("toolResult", {
								error: true,
								toolUse: call.id,
								result: `tool "${call.name}" not found`
							});
					}
				});
			else
				this.fire("idle", { stopReason: e.msg.stop_reason });
			return e;
		});

		this.after("toolResult", async (e: ToolResultEvent) => {
			let m = this.context.at(-1);
			if (m?.role !== "user") {
				m = {
					role: "user",
					content: []
				};
				this.context.push(m);
			}

			m.content.push({
				type: "tool_result",
				is_error: e.error,
				tool_use_id: e.toolUse,
				content: e.result
			});

			this.#pendingToolCalls.delete(e.toolUse);
			if (this.#pendingToolCalls.size === 0 && !this.#abortedToolCalls.has(e.toolUse))
				this.queueCompletion();

			return e;
		});

		this.after("completion", async (e) => {
			try {
				const msg = await this.llm.complete(e.req, this.signal);
				this.#completionQueued = false;
				this.fire("assistantMessage", { msg });
			} catch {
				this.#completionQueued = false;
				if (e.retriesLeft > 0)
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
		this.fire("idle", { stopReason: "aborted" });
	}

	queueCompletion(maxRetries: number = 5) {
		if (!this.#completionQueued && this.#pendingToolCalls.size === 0) {
			this.#completionQueued = true;
			this.#thread.queue(async () => {
				this.fire("completion", {
					retriesLeft: maxRetries,
					req: {
						system: this.system,
						session_id: this.id,
						messages: this.context,
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

	async #execTool(tool: AnyTool, call: ToolUse) {
		this.#pendingToolCalls.add(call.id);
		try {
			const args = assertSchema(call.input, tool.args, `invalid args to "${call.name}":`, this.#validators.get(tool)!)

			let res = await (tool as Tool<TSchema>).exec(args, this);
			if (typeof res !== "string")
				res = JSON.stringify(res);

			this.fire("toolResult", {
				toolUse: call.id,
				error: false,
				result: res as string
			});
		} catch (e) {
			this.fire("toolResult", {
				toolUse: call.id,
				error: true,
				result: e instanceof Error ? e.message : e as string
			});
		}
	}
}
