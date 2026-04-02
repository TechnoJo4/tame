import { InferenceProvider, InputMessage, UserMessage, AssistantMessage } from "../llm/types.ts";
import { Thread } from "./thread.ts";

export interface UserMessageEvent {
    msg: UserMessage
};

export interface AssistantMessageEvent {
    msg: AssistantMessage
};

export interface AgentEvents {
    userMessage: UserMessageEvent;
    assistantMessage: AssistantMessageEvent;
};

export type Handler<T extends keyof AgentEvents> = (data: AgentEvents[T]) => Promise<AgentEvents[T]>;

export class Agent {
    #thread = new Thread();
    #handlers = new Map<keyof AgentEvents, ((e: never) => unknown)[]>();
    #context: InputMessage[] = [];

    llm: InferenceProvider;
    system: string;

    constructor(llm: InferenceProvider, system: string) {
        this.llm = llm;
        this.system = system;

        this.after("userMessage", async (e: UserMessageEvent) => {
            this.#context.push(e.msg);
            return e;
        });
    }

    get signal() {
        return this.#thread.signal;
    }

    abort() {
        return this.#thread.abort();
    }

    do<T extends keyof AgentEvents>(event: T, data: AgentEvents[T]) {
        this.#thread.queue(() => {
            let p: Promise<AgentEvents[T]> = Promise.resolve(data);
            for (const h of this.#handlers.get(event)!) {
                p = p.then(h as Handler<T>);
            }
            return p;
        });
    }

    before<T extends keyof AgentEvents>(event: T, f: Handler<T>) {
        this.#handlers.get(event)?.unshift(f);
    }

    after<T extends keyof AgentEvents>(event: T, f: Handler<T>) {
        this.#handlers.get(event)?.push(f);
    }

    complete() {
        this.#thread.queue(async () => {
            const msg = await this.llm.complete({
                system: this.system,
                messages: this.#context,
            }, this.signal);
            this.do("assistantMessage", { msg });
        });
    }
}
