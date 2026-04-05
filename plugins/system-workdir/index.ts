import type { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";

export default {
    newAgent(agent: Agent) {
        agent.system += `\nLocal working directory: ${Deno.cwd()}\n`;
    }
} as Plugin;
