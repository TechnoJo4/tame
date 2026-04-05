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
    system: string;
    context: InputMessage[];
    //history: InputMessage[];
}

export const saveAgent = async (agent: Agent) => {
    const path = resolve(historyFolder, agent.id);
    const history: History = {
        id: agent.id,
        system: agent.system,
        context: agent.context
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
    return agent;
};

export const historyLoadAgent = async (id: string): Promise<Agent> => {
    return await historyToAgent(await historyLoad(id));
};

export default {
    async init() {
        fs.mkdir(historyFolder);
    },
    newAgent(agent) {
        agent.after("userMessage", async (e) => {
            saveAgent(agent);
            return e;
        });

        agent.after("assistantMessage", async (e) => {
            saveAgent(agent);
            return e;
        });
    }
} as Plugin;
