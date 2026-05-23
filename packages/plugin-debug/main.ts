import type { IAgent } from "@tame/sdk";
import type { Plugin } from "@tame/sdk";

export default {
	id: "debug",

	newAgent(agent: IAgent) {
		agent.after("assistantMessage", async (e) => {
			console.log(e.msg);
			return e;
		});
		agent.after("toolResult", async (e) => {
			console.log(e);
			return e;
		});
		agent.after("idle", async (e) => {
			console.log("idle", e.stopReason);
			return e;
		});
	}
} as Plugin;
