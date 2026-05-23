import { Agent } from "./agent.ts";
import type { InferenceProvider, Plugin, AnyTool, IHarness } from "@tame/sdk";
import { config, system as configSystem } from "../config/index.ts";

export class Harness implements IHarness {
	#tools: AnyTool[] = [];
	#plugins = new Map<string, Plugin>();
	#agents = new Map<string, WeakRef<Agent>>();

	/** @deprecated Use getPlugin instead */
	getPluginByType<T extends Plugin>(t: abstract new (...args: any) => T): T | undefined {
		return this.#plugins.values().find(p => p instanceof t) as T | undefined
	}

	getPlugin<T extends Plugin>(id: T["id"]): T | undefined {
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

		this.#agents.set(agent.id, new WeakRef(agent));

		return agent;
	}

	getAgent(id: string): Agent | undefined {
		return this.#agents.get(id)?.deref();
	}

	listAgents(): { id: string; title?: string }[] {
		const result: { id: string; title?: string }[] = [];
		for (const [id, ref] of this.#agents) {
			const agent = ref.deref();
			if (agent) result.push({ id, title: agent.title });
		}
		return result;
	}

	cleanup() {
		this.#agents.entries()
			.filter(([_,v]) => !v.deref())
			.forEach(([k,_]) => this.#agents.delete(k));
	}
}
