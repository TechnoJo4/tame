import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import * as harness from "../../agent/harness.ts";
import { tool, Type } from "../../agent/tool.ts";
import { default as history } from "../history/index.ts";

export interface Memory {
	forgotten: boolean;
	text: string;
};

export class MemoryPlugin implements Plugin {
	memory = new Map<Agent, Memory[]>();

	enabled?: true;

	async init() {
		harness.tools.push(tool({
			name: "remember",
			desc: `Add a thought to session memory. It will be persisted after compaction.`,
			args: Type.Object({ thought: Type.String({ description: "Text to remember" }) }),
			exec: async ({ thought }, agent) => {
				const n = this.memory.get(agent)!.push({ text: thought, forgotten: false });
				return `Added memory #${n}`;
			},
			view: {
				compact: (_, result) => result?.content ?? "Add memory",
				acp: ({ thought }, result) => ({
					kind: "think",
					title: result?.content ?? "Remember",
					content: [ {
						"type": "content",
						"content": {
							"type": "text",
							"text": thought
						}
					} ]
				})
			}
		}));

		harness.tools.push(tool({
			name: "forget",
			desc: "Remove a thought from session memory",
			args: Type.Object({ numbers: Type.Array(Type.Number(), { description: "Numbers of the memories to remove from session memory" }) }),
			exec: async ({ numbers }, agent) => {
				const mem  = this.memory.get(agent)!;
				for (const n of numbers) {
					if (!(n-1 in mem) || mem[n-1].forgotten)
						throw new Error(`Memory #${n} does not exist or was already forgotten`);
					mem[n-1].forgotten = true;
				}
				return "Done";
			},
			view: {
				compact: ({ numbers }) => `Forget ${numbers.map(n => "#"+n).join(", ")}`,
				acp: ({ numbers }) => ({
					kind: "think",
					title: `Forget ${numbers.map(n => "#"+n).join(", ")}`
				})
			}
		}));

		if (history.enabled) {
			history.addHook<Memory[]>("memory", {
				load: (agent, mem) => this.memory.set(agent, mem),
				save: (agent) => this.memory.get(agent)!
			});
		}
	}

	newAgent(agent: Agent) {
		this.memory.set(agent, []);
	}

	getAgentMemory(agent: Agent) {
		return this.memory.get(agent)!;
	}
}

export default new MemoryPlugin();
