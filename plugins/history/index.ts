import type { Plugin } from "../../agent/plugin.ts";
import type { Agent } from "../../agent/agent.ts";
import { promises as fs } from "node:fs";
import { resolve } from "@std/path";
import { tameDataFolder } from "../../config/index.ts";
import { newAgent } from "../../agent/harness.ts";
import { InputMessage } from "../../llm/types.ts";

const historyFolder = resolve(tameDataFolder, "history");

export interface History {
    id: string;
    title?: string;
    system: string;
    context: InputMessage[];
    history: InputMessage[];
}

export interface HistoryAgentData {
    title?: string;
    history: InputMessage[];
};

const dataKey = Symbol("tame:history:plugin-data-key");

export const getAgentHistory = (agent: Agent): HistoryAgentData => {
    if (!agent.pluginData.has(dataKey))
        agent.pluginData.set(dataKey, {
            history: []
        });
    return agent.pluginData.get(dataKey) as HistoryAgentData;
}

export const saveAgent = async (agent: Agent) => {
    const data = getAgentHistory(agent);
    const path = resolve(historyFolder, agent.id);
    const history: History = {
        id: agent.id,
        system: agent.system,
        context: agent.context,
        history: data.history
    };
    await fs.writeFile(path, JSON.stringify(history), { encoding: "utf-8" })
};

export const historyList = async (): Promise<string[]> => {
    const files = await fs.readdir(historyFolder, { withFileTypes: true });
    const agents = [];
    for (const file of files)
        if (file.isFile())
            agents.push(file.name);
    return agents;
};

export const historyLoad = async (id: string): Promise<History> => {
    const data = await fs.readFile(resolve(historyFolder, id), { encoding: "utf-8" });
    return JSON.parse(data);
};

export const historyToAgent = async (history: History): Promise<Agent> => {
    const agent = newAgent(undefined, history.system, history.id);
    agent.context = history.context;
    Object.assign(getAgentHistory(agent), {
        history: history.history
    } as HistoryAgentData);
    return agent;
};

export const historyLoadAgent = async (id: string): Promise<Agent> => {
    return await historyToAgent(await historyLoad(id));
};

export default {
    async init() {
        try {
            fs.access(historyFolder);
        } catch {
            fs.mkdir(historyFolder);
        }
    },
    newAgent(agent) {
        agent.after("userMessage", async (e) => {
            saveAgent(agent);

            const hist = getAgentHistory(agent);
            if (!hist.title) {
                const text = e.msg.content.filter(c => c.type === "text").map(c => c.text).join("");
                if (text.length > 0) {
                    const nl = text.indexOf("\n");
                    hist.title = nl !== -1 ? text.substring(0, nl) : text;
                }
            }
            return e;
        });
        agent.after("assistantMessage", async (e) => {
            saveAgent(agent);
            return e;
        });
    }
} as Plugin;
