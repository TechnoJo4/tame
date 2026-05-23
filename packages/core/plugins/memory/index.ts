import type { IAgent } from "@tame/sdk";
import { Plugin, tool, Type } from "@tame/sdk";
import type { IHarness } from "@tame/sdk";
import type { HistoryPlugin } from "../history/index.ts";

export interface Memory {
	forgotten: boolean;
	text: string;
}

export class MemoryPlugin implements Plugin {
	id = "memory" as const;

	memory = new Map<IAgent, Memory[]>();

	enabled?: true;

	remember = tool({
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
	});

	forget = tool({
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
	});

	async init(harness: IHarness) {
		harness.addTools(this.remember, this.forget);

		harness.getPlugin<HistoryPlugin>("history")?.addHook<Memory[]>("memory", {
			load: (agent, mem) => this.memory.set(agent, mem),
			save: (agent) => this.memory.get(agent)!
		});
	}

	newAgent(agent: IAgent) {
		this.memory.set(agent, []);
	}

	getAgentMemory(agent: IAgent) {
		return this.memory.get(agent)!;
	}
}
