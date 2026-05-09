import { Agent } from "./agent.ts";
import { InferenceProvider } from "../llm/types.ts";
import { Plugin } from "./plugin.ts";
import { AnyTool } from "./tool.ts";
import { config, system as configSystem } from "../config/index.ts";

export class Harness {
	#tools: AnyTool[] = [];
	#plugins = new Map<string, Plugin>();

	getPluginByType<T extends Plugin>(t: abstract new (...args: any) => T): T | undefined {
		return this.#plugins.values().find(p => p instanceof t) as T | undefined
	}

	getPlugin<T extends Plugin>(id: string): T | undefined {
		return this.#plugins.get(id) as T | undefined
	}

	addTools(...tool: AnyTool[]) {
		this.#tools.push(...tool);
	}

	addPlugins(...plugins: Plugin[]) {
		for (const p of plugins)
			this.#plugins.set(p.id, p);
		for (const p of plugins)
			p.init?.(this);
	}

	newAgent(llm?: InferenceProvider, system?: string, id?: string): Agent {
		const agent = new Agent(llm ?? config.llm, system ?? configSystem, id);

		for (const t of this.#tools)
			agent.addTool(t);

		for (const p of this.#plugins.values())
			if (p.newAgent)
				p.newAgent(agent);

		return agent;
	}
}
