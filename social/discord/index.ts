import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { pathJoin, importAllInDirFlat, type AnyTool, type Agent, type Message } from "@tame/agent";
import { type Connector, getHarness, newAgent } from "../connector.ts";
import { key, AgentState } from "./state.ts";

export const agents = new Map<string, Agent>();

// TODO: config
const trustedUsers = new Set([
    "169175121037099008"
]);

const trustedChannels = new Set([
    "1471666268905017385"
]);

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel
    ]
});

client.once(Events.ClientReady, c => {
    console.log(`discord: ready as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (m) => {
    if (m.author.id === client.user?.id) return;

    console.log(`discord: got message ${m.id} in ${m.channelId}`)
    const trustedAuthor = trustedUsers.has(m.author.id);
    const msg: Message = {
        role: "user",
        content: [
            { type: "text", text: `${m.author.username} (ID ${m.author.id}; ${trustedAuthor ? "trusted" : "untrusted"}) sent message ${m.id}:\n${m.content}` }
        ],
        timestamp: Date.now()
    };

    if (agents.has(m.channelId)) {
        const agent = agents.get(m.channelId)!;
        agent.ctx.messages.push(msg);
        if (agent.promise === undefined)
            getHarness().signal();
    } else {
        const agent = await newAgent(trustedChannels.has(m.channelId) || (trustedAuthor && m.author.dmChannel?.id === m.channelId), {
            [key]: <AgentState>{
                client,
                channelId: m.channelId,
                describe() {
                    return `<discord><channel><id>${this.channelId}</id></channel></discord>`;
                }
            }
        });

        agents.set(m.channelId, agent);
        agent.ctx.messages.push(msg);
        getHarness().signal();
    }
});

client.login(Deno.env.get("DISCORD_TOKEN"));

export default {
    tools: await importAllInDirFlat(pathJoin(import.meta.dirname!, "tool")) as AnyTool[],
    system: {
        io: `### discord

in the unlikely event you want to bring someone who is offline into the conversation, "ping" them.
this means using the <@discord-user-id> syntax. you must use the numerical ids. be careful, this
will notify the mentioned user. you may reference channels using a similar <#channel-id> syntax.`
    },
    initAgent: async () => {}
} satisfies Connector;
