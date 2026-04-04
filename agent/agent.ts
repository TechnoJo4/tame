import { Ajv, type ValidateFunction } from "ajv";
import type { InferenceProvider, InputMessage, UserMessage, AssistantMessage, ToolUse, StopReason } from "../llm/types.ts";
import type { AnyTool } from "./tool.ts";
import { Thread } from "./thread.ts";

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

export interface IdleEvent {
    stopReason: AgentStopReason
};

export interface AgentEvents {
    userMessage: UserMessageEvent;
    assistantMessage: AssistantMessageEvent;
    toolResult: ToolResultEvent;
    idle: IdleEvent;
};

export type Handler<T extends keyof AgentEvents> = (data: AgentEvents[T]) => Promise<AgentEvents[T]>;

export class Agent {
    #thread = new Thread();
    #handlers = new Map<keyof AgentEvents, ((e: never) => unknown)[]>();
    #onceHandlers = new Map<keyof AgentEvents, ((e: never) => unknown)[]>();
    #tools = new Map<string, AnyTool>();
    #context: InputMessage[] = [];
    #completionQueued = false;
    #schemas = new Map<AnyTool, ValidateFunction<unknown>>();
    #ajv = new Ajv({
        allErrors: true,
        strict: false,
        coerceTypes: true,
    });

    llm: InferenceProvider;
    system: string;

    constructor(llm: InferenceProvider, system: string) {
        this.llm = llm;
        this.system = system;

        this.after("userMessage", async (e: UserMessageEvent) => {
            this.#context.push(e.msg);
            this.queueCompletion();
            return e;
        });

        this.after("assistantMessage", async (e: AssistantMessageEvent) => {
            this.#context.push(e.msg);
            const calls = e.msg.content.filter(c => c.type === "tool_use");
            if (calls.length > 0)
                this.#thread.queue(async () => {
                    const promises = [];
                    for (const call of calls) {
                        const tool = this.#tools.get(call.name);
                        if (tool)
                            promises.push(this.#execTool(tool, call));
                        else
                            this.do("toolResult", {
                                error: true,
                                toolUse: call.id,
                                result: `tool "${call.name}" not found`
                            });
                    }
                    await Promise.all(promises);
                    this.queueCompletion();
                });
            else
                this.do("idle", { stopReason: e.msg.stop_reason });
            return e;
        });

        this.after("toolResult", async (e: ToolResultEvent) => {
            let m = this.#context.at(-1);
            if (m?.role !== "user") {
                m = {
                    role: "user",
                    content: []
                };
                this.#context.push(m);
            }

            m.content.push({
                type: "tool_result",
                tool_use_id: e.toolUse,
                content: e.result
            });
            return e;
        });
    }

    get signal() {
        return this.#thread.signal;
    }

    /** Promise that resolves on abort. */
    get aborted() {
        return new Promise<void>(r => {
            this.#thread.signal?.addEventListener("abort", () => r());
        });
    }

    /** Abort processing and clear the queue. */
    abort() {
        this.#thread.abort();
        this.do("idle", { stopReason: "aborted" });
    }

    /** Add an event onto the queue. */
    do<T extends keyof AgentEvents>(event: T, data: AgentEvents[T]) {
        this.#thread.queue(() => {
            let p: Promise<AgentEvents[T]> = Promise.resolve(data);
            for (const h of this.#onceHandlers.get(event) ?? []) {
                p = p.then(h as Handler<T>);
            }
            for (const h of this.#handlers.get(event) ?? []) {
                p = p.then(h as Handler<T>);
            }
            return p;
        });
    }

    /** Add a handler at the start of an event's processing. */
    before<T extends keyof AgentEvents>(event: T, f: Handler<T>) {
        if (!this.#handlers.has(event))
            this.#handlers.set(event, []);
        this.#handlers.get(event)!.unshift(f);
    }

    /** Add a handler at the end of an event's processing. */
    after<T extends keyof AgentEvents>(event: T, f: Handler<T>) {
        if (!this.#handlers.has(event))
            this.#handlers.set(event, []);
        this.#handlers.get(event)!.push(f);
    }

    /** Add a handler for the processing of the single next instance of an event. */
    once<T extends keyof AgentEvents>(event: T, f: Handler<T>) {
        if (!this.#onceHandlers.has(event))
            this.#onceHandlers.set(event, []);
        this.#onceHandlers.get(event)!.push(f);
    }

    waitFor<T extends keyof AgentEvents>(event: T): Promise<AgentEvents[T]> {
        return new Promise(resolve => {
            this.once(event, async (e) => {
                resolve(e);
                return e;
            })
        })
    }

    queueCompletion() {
        if (!this.#completionQueued) {
            this.#completionQueued = true;
            this.#thread.queue(async () => {
                try {
                    const msg = await this.llm.complete({
                        system: this.system,
                        messages: this.#context,
                        tools: this.#tools.values().map(t => ({
                            name: t.name,
                            description: t.desc,
                            input_schema: t.args
                        })).toArray()
                    }, this.signal);
                    this.#completionQueued = false;
                    this.do("assistantMessage", { msg });
                } catch {
                    this.do("idle", { stopReason: "error" });
                }
            });
        }
    }

    addTool(tool: AnyTool) {
        this.#tools.set(tool.name, tool);
        this.#schemas.set(tool, this.#ajv.compile(tool.args));
    }

    async #execTool(tool: AnyTool, call: ToolUse) {
        try {
            const args = structuredClone(call.input);
            const val = this.#schemas.get(tool)!;
            if (!val(args)) {
                const errors = val.errors?.map(err => `- ${err.instancePath || err.params.missingProperty || "root"}: ${err.message}`);
                throw new Error(`invalid args to "${call.name}":\n${errors?.join("\n")}`);
            }

            let res = await tool.exec(args, this);
            if (typeof res !== "string")
                res = JSON.stringify(res);

            this.do("toolResult", {
                toolUse: call.id,
                error: false,
                result: res as string
            });
        } catch (e) {
            this.do("toolResult", {
                toolUse: call.id,
                error: false,
                result: e instanceof Error ? e.message : e as string
            });
        }
    }
}
