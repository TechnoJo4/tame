import type { Plugin } from "../../agent/plugin.ts";
import type { Agent } from "../../agent/agent.ts";
import { promises as fs } from "node:fs";
import { resolve } from "@std/path";
import { tameDataFolder } from "../../config/index.ts";
import { newAgent } from "../../agent/harness.ts";
import { InputMessage, TameMessageMeta } from "../../llm/types.ts";
import { tameMsgMeta } from "../../util/symbols.ts";

const historyFolder = resolve(tameDataFolder, "history");

const dataKey = Symbol("tame:history:plugin-data-key");

export interface History {
    id: string;
    title?: string;
    system: string;
    context: InputMessage[];
    history: InputMessage[];
}

export type PersistedMessage = InputMessage & {
    [tameMsgMeta]: undefined;
    _tame?: TameMessageMeta;
};

export type PersistedHistory = History & {
    context: PersistedMessage[];
    history: PersistedMessage[];
}

export interface HistoryAgentData {
    title?: string;
    history: InputMessage[];
};

export const messageToPersisted = (msg: InputMessage): PersistedMessage => ({
    ...msg,
    [tameMsgMeta]: undefined,
    _tame: msg?.[tameMsgMeta]
});

export const messageFromPersisted = (msg: PersistedMessage): InputMessage => ({
    ...msg,
    [tameMsgMeta]: msg?._tame
});

export const getAgentHistory = (agent: Agent): HistoryAgentData => {
    if (!agent.pluginData.has(dataKey))
        agent.pluginData.set(dataKey, {
            history: []
        });
    return agent.pluginData.get(dataKey) as HistoryAgentData;
}

export interface HistoryHook<T> {
    save(agent: Agent): T;
    load(agent: Agent, t: T): void;
};

export class HistoryPlugin implements Plugin {
    #hooks = new Map<string, HistoryHook<unknown>>();
    
    loaded?: true;

    async init() {
        try {
            await fs.access(historyFolder);
        } catch {
            await fs.mkdir(historyFolder);
        }
    }

    newAgent(agent: Agent) {
        agent.after("userMessage", async (e) => {
            const hist = getAgentHistory(agent);
            if (!hist.title) {
                const text = e.msg.content.filter(c => c.type === "text").map(c => c.text).join("");
                if (text.length > 0) {
                    const nl = text.indexOf("\n");
                    hist.title = nl !== -1 ? text.substring(0, nl) : text;
                }
            }

            await this.saveAgent(agent);
            return e;
        });
        agent.after("assistantMessage", async (e) => {
            await this.saveAgent(agent);
            return e;
        });
    }

    addHook<T>(key: string, hook: HistoryHook<T>): void {
        if (this.#hooks.has(key))
            throw new Error(`duplicate history hook key '${key}'`);
        this.#hooks.set(key, hook);
    }

    async saveAgent(agent: Agent) {
        const data = getAgentHistory(agent);
        const path = resolve(historyFolder, agent.id);
        const history: History = {
            id: agent.id,
            system: agent.system,
            context: agent.context.map(messageToPersisted),
            history: data.history.map(messageToPersisted)
        };
        await fs.writeFile(path, JSON.stringify(history), { encoding: "utf-8" })
    };

    async historyList(): Promise<string[]> {
        const files = await fs.readdir(historyFolder, { withFileTypes: true });
        const agents = [];
        for (const file of files)
            if (file.isFile())
                agents.push(file.name);
        return agents;
    };

    async historyLoad(id: string): Promise<History> {
        const json = await fs.readFile(resolve(historyFolder, id), { encoding: "utf-8" });
        const data: PersistedHistory = JSON.parse(json);
        return {
            ...data,
            context: data.context.map(messageFromPersisted),
            history: data.history.map(messageFromPersisted),
        };
    };

    async historyToAgent(history: History): Promise<Agent> {
        const agent = newAgent(undefined, history.system, history.id);
        agent.context = history.context;
        Object.assign(getAgentHistory(agent), {
            history: history.history
        } as HistoryAgentData);
        return agent;
    };

    async historyLoadAgent(id: string): Promise<Agent> {
        return await this.historyToAgent(await this.historyLoad(id));
    };
}

export default new HistoryPlugin();
