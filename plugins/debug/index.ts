import type { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";

export default {
    newAgent(agent: Agent) {
        agent.after("assistantMessage", async (e) => {
            console.log(e.msg);
            return e;
        });
        agent.after("toolResult", async (e) => {
            console.log(e);
            return e;
        });
    }
} satisfies Plugin;
