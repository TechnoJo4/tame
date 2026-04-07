import type { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import { InputMessage } from "../../llm/types.ts";

export default {
    newAgent(agent: Agent) {
        const setCaching = (m: InputMessage): InputMessage => ({
            ...m,
            content: m.content.map((c, i) =>
                i === m.content.length - 1
                    ? ({ ...c, cache_control: { type: "ephemeral", ttl: "5m" } })
                    : c)
        });

        agent.before("completion", async (e) => {
            const last = e.req.messages.length - 1;
            const u1 = e.req.messages.findLastIndex(m => m.role === "user");

            if (last !== -1 && last !== u1)
                e.req.messages[last] = setCaching(e.req.messages[last]);

            if (u1 !== -1) {
                e.req.messages[u1] = setCaching(e.req.messages[u1]);
                const u2 = e.req.messages.slice(0, u1).findLastIndex(m => m.role === "user");
                if (u2 !== -1) {
                    e.req.messages[u2] = setCaching(e.req.messages[u2]);
                    const u3 = e.req.messages.slice(0, u2).findLastIndex(m => m.role === "user");
                    if (u3 !== -1) {
                        e.req.messages[u3] = setCaching(e.req.messages[u3]);
                    }
                }
            }

            return e;
        });
    }
} as Plugin;
