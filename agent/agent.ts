import type * as pi from "@mariozechner/pi-ai";
export type { Message, UserMessage, AssistantMessage } from "@mariozechner/pi-ai";
import db from "./db.ts";
import type { AnyTool } from "./tool.ts";

export const RESERVED_CTX_SLOTS = 3;
export const RESERVED_CTX_SLOT_TOOLS = 0;
export const RESERVED_CTX_SLOT_MEMORY = 1;
export const RESERVED_CTX_SLOT_STATE = 2;

export interface AgentOptions {
    /** ID to load an existing agent from */
    id?: number;
    /** System prompt */
    systemPrompt?: string;
    /** Duration (milliseconds) for which to keep messages before they get pruned */
    messagePruneTime?: number;
};

const describeTool = (t: AnyTool["def"]) => `<tool>
<name>${t.name}</name>
<description>${t.description}</description>
<schema>
${JSON.stringify(t.parameters)}
</schema>
</tool>`;

/** The data in one slot of an agent's internal state */
export interface InternalData {
    /** Description of the data to include in the agent's context */
    describe(): string | undefined
}

/** An "agent" with its context, tools, memory, and internal state */
export class Agent {
    #data: Map<symbol, InternalData> = new Map();
    #options: AgentOptions;

    id: number;

    tools: Map<string, AnyTool> = new Map();

    lastSavedMessage: number = 0;

    /** The agent's context */
    ctx: pi.Context;

    /**
     * This field is set if and only if this promise is unfulfilled, so that the harness can wait
     * for its completion. This promise should set this field to undefined after completing.
     */
    promise?: Promise<void>;

    /** Function that returns the next message, or undefined if the agent should stop */
    continuation?(): string | undefined;

    constructor(options: AgentOptions) {
        this.#options = options;
        this.ctx = {
            systemPrompt: options.systemPrompt,
            messages: []
        };

        if (options.id) {
            this.id = options.id;
        } else {
            this.id = 0;
        }
    }

    /** Create a new Agent with the same internal data */
    async inherit(options: AgentOptions): Promise<Agent> {
        const agent = new Agent(options);
        await agent.init();
        for (const [k,v] of this.#data.entries())
            agent.setInternal(k, v);
        return agent;
    }

    selfBlock?: string;
    /** Initialize the agent (e.g. ID assignment). Should be called immediately after constructing an Agent. */
    async init() {
        if (this.id === 0)
            this.id = await db.agent.new();

        this.selfBlock = "agent/"+this.id;
        await db.memory.set(this.selfBlock, "");
        await db.memory.attach(this.id, this.selfBlock);
    }

    /** Add reserved context messages for tools, memory, etc. */
    async initCtx() {
        while (this.ctx.messages.length < RESERVED_CTX_SLOTS)
            this.ctx.messages.unshift({ role: "user", content: [], timestamp: Date.now() });

        this.updateTools();
        await this.updateCtx();
    }

    async updateCtx() {
        this.updateState();
        await this.updateMemory();

        // TODO: also prune messages when going over max tokens
        const now = Date.now()
        const pruneIdx = this.ctx.messages.findLastIndex(m => (now - m.timestamp) > (this.#options.messagePruneTime ?? 300000));
        if (pruneIdx > RESERVED_CTX_SLOTS) {
            console.debug(`harness: pruning ${pruneIdx - 1 - RESERVED_CTX_SLOTS} messages`)
            this.ctx.messages.splice(RESERVED_CTX_SLOTS, pruneIdx - 1 - RESERVED_CTX_SLOTS);
        }
    }

    updateTools() {
        this.ctx.tools = Array.from(this.tools.values().map(t => t.def));
        this.ctx.messages[RESERVED_CTX_SLOT_TOOLS].content = [
            {
                type: "text",
                text: "<tools>\n" + this.ctx.tools.map(t => describeTool(t)).join("\n") + "\n</tools>"
            }
        ];
    }

    async updateMemory() {
        const allMem = await db.memory.list();
        const attachedMem = await db.memory.getAttached(this.id);

        const mem = [];
        for (const id of allMem) {
            if (id === this.selfBlock) {
                mem.push(`<attached>\n<name>self</name>\n<alias>${id}</alias>\n<content>\n${attachedMem[id]}\n</content>\n</attached>`)
            } else if (id in attachedMem) {
                mem.push(`<attached>\n<name>${id}</name>\n<content>\n${attachedMem[id]}\n</content>\n</attached>`)
            } else {
                mem.push(`<detached>${id}</detached>`)
            }
        }

        this.ctx.messages[RESERVED_CTX_SLOT_MEMORY].content = [
            { type: "text", text: "<memory>" + mem.join("\n") + "</memory>" }
        ];
    }

    updateState() {
        this.ctx.messages[RESERVED_CTX_SLOT_STATE].content = [
            {
                type: "text",
                text: "<state>\n" + Array.from(this.#data.values().map(d => d.describe()).filter(p => p)).join("\n") + "\n</state>"
            }
        ];
    }

    setInternal<T extends InternalData>(key: symbol, value: T) {
        this.#data.set(key, value);
    }

    getInternal<T extends InternalData>(key: symbol): T {
        return this.#data.get(key) as T;
    }

    hasInternal(key: symbol): boolean {
        return this.#data.has(key);
    }

    save() {}

    addTool(tool: AnyTool) {
        this.tools.set(tool.def.name, tool);
    }
}
