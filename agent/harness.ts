import { Agent } from "./agent.ts";
import { InferenceProvider } from "../llm/types.ts";
import { Plugin } from "./plugin.ts";
import { AnyTool } from "./tool.ts";
import { config, system as configSystem } from "../config/index.ts";

export const plugins: Plugin[] = [];
export const tools: AnyTool[] = [];

export const newAgent = (llm?: InferenceProvider, system?: string, id?: string): Agent => {
	const agent = new Agent(llm ?? config.llm, system ?? configSystem, id);

	for (const t of tools)
		agent.addTool(t);

	for (const p of plugins)
		if (p.newAgent)
			p.newAgent(agent);

	return agent;
};

export const getPlugin = <T extends Plugin>(t: abstract new (...args: any) => T): T | undefined =>
	plugins.find(p => p instanceof t) as T | undefined;
