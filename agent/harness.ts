import { Agent } from "./agent.ts";
import { InferenceProvider } from "../llm/types.ts";
import { Plugin } from "./plugin.ts";
import { AnyTool } from "./tool.ts";
import { config, system as configSystem } from "../config/index.ts";

export const plugins: Plugin[] = [];
export const tools: AnyTool[] = [];

export const newAgent = (llm?: InferenceProvider, system?: string): Agent => {
    const agent = new Agent(llm ?? config.llm, system ?? configSystem);

    for (const t of tools)
        agent.addTool(t);

    for (const p of plugins)
        if (p.newAgent)
            p.newAgent(agent);

    return agent;
};
