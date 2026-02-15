import { db } from "@tame/agent";
import { type Connector, getHarness, newAgent } from "../connector.ts";

let Started = false;

const message = await db.config.get("heartbeatMessage");
const interval = parseInt(await db.config.get("heartbeatInterval"));
if (isNaN(interval))
    throw new Error("invalid heartbeat interval");

const agentId = await db.config.get("heartbeatAgent");

export default {
    tools: [],
    system: {},
    initAgent: async () => {
        // Create the heartbeat agent the first time another agent is created
        if (!Started) {
            Started = true;
            const agent = await newAgent(true, {}, {
                id: agentId ? parseInt(agentId) : undefined
            });
            if (!agentId) await db.config.set("heartbeatAgent", agent.id.toString());

            agent.promise = new Promise(() => {});
            agent.continuation = () => {
                agent.promise = new Promise(() => {});
                setTimeout(() => {
                    agent.promise = undefined;
                    agent.ctx.messages.push({
                        role: "user",
                        content: [ { type: "text", text: message } ],
                        timestamp: Date.now()
                    });
                    getHarness().signal();
                }, interval);
                return undefined;
            }
        }
    }
} satisfies Connector;
