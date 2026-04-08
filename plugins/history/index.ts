import type { Plugin } from "../../agent/plugin.ts";
import type { Agent } from "../../agent/agent.ts";
import { promises as fs } from "node:fs";
import { resolve } from "@std/path";
import { tameDataFolder } from "../../config/index.ts";
import { newAgent } from "../../agent/harness.ts";
import { InputMessage, TameMessageMeta } from "../../llm/types.ts";
import { tameMsgMeta } from "../../util/symbols.ts";

const historyFolder = resolve(tameDataFolder, "history");
const indexFile = resolve(historyFolder, "index.json");

const dataKey = Symbol("tame:history:plugin-data-key");

export interface History {
    id: string;
    title?: string;
    system: string;
    context: InputMessage[];
    history: InputMessage[];
    extra: Record<string, unknown>;
}

export interface SessionInfo {
    id: string;
    title?: string;
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

    enabled?: true;

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
                await this.updateIndex(agent);
            }

            await this.saveAgent(agent);
            return e;
        });
        agent.after("assistantMessage", async (e) => {
            await this.saveAgent(agent);
            return e;
        });
        agent.after("toolResult", async (e) => {
            await this.saveAgent(agent);
            return e;
        });
    }

    addHook<T>(key: string, hook: HistoryHook<T>): void {
        if (this.#hooks.has(key))
            throw new Error(`duplicate history hook key '${key}'`);
        this.#hooks.set(key, hook);
    }

    async saveAgent(agent: Agent) { // TODO: debounce (use own thread?)
        const data = getAgentHistory(agent);
        const path = resolve(historyFolder, agent.id);
        const history: History = {
            id: agent.id,
            system: agent.system,
            context: agent.context.map(messageToPersisted),
            history: data.history.map(messageToPersisted),
            extra: Object.fromEntries(this.#hooks.entries().map(([k,v]) => [k, v.save(agent)]))
        };
        await fs.writeFile(path, JSON.stringify(history), { encoding: "utf-8" })
    };

    async updateIndex(...agents: Agent[]) {
        const data = await fs.readFile(indexFile, { encoding: "utf-8" });
        const index: SessionInfo[] = JSON.parse(data);
        for (const agent of agents) {
            const s = index.find(s => s.id === agent.id);
            if (s)
                s.title = getAgentHistory(agent).title;
            else
                index.push({ id: agent.id, title: getAgentHistory(agent).title });
        }
        await fs.writeFile(indexFile, JSON.stringify(index), { encoding: "utf-8" })
    };

    async list(): Promise<SessionInfo[]> {
        const data = await fs.readFile(indexFile, { encoding: "utf-8" });
        const index: SessionInfo[] = JSON.parse(data);
        const files = await fs.readdir(historyFolder, { withFileTypes: true });
        for (const file of files)
            if (file.isFile() && file.name != "index.json" && !index.find(s => s.id === file.name))
                index.push({ id: file.name });
        return index;
    };

    async load(id: string): Promise<History> {
        const json = await fs.readFile(resolve(historyFolder, id), { encoding: "utf-8" });
        const data: PersistedHistory = JSON.parse(json);
        return {
            ...data,
            context: data.context.map(messageFromPersisted),
            history: data.history.map(messageFromPersisted),
        };
    };

    async loadAgent(id: string): Promise<Agent> {
        return await this.historyToAgent(await this.load(id));
    };

    async historyToAgent(history: History): Promise<Agent> {
        const agent = newAgent(undefined, history.system, history.id);
        agent.context = history.context;
        Object.assign(getAgentHistory(agent), {
            title: history.title,
            history: history.history
        } as HistoryAgentData);

        for (const [k,v] of Object.entries(history.extra ?? {})) {
            const hook = this.#hooks.get(k);
            if (!hook) {
                console.warn(`extra data '${k}' in history for agent but hook not found`)
                continue;
            }
            hook.load(agent, v);
        }

        await this.updateIndex(agent);
        return agent;
    };
}

export default new HistoryPlugin();
