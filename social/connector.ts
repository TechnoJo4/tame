import { db, Agent, AnyTool, InternalData, Harness, AssistantMessage } from "@tame/agent";
import * as code from "@tame/code";

const connectors: Connector[] = [];
let harness: Harness | undefined = undefined;

const toolReminderMessage = `<system-reminder>you must reply to the user using tools. non-tool messages are ignored.</system-reminder>`;

export const getConnectors = () => connectors;
export const addConnector = (connector: Connector) => connectors.push(connector);
export const getHarness = (): Harness => harness!;
export const setHarness = (val: Harness) => {
    if (harness !== undefined)
        throw new Error("attempt to create multiple harnesses");
    harness = val;
}

const trustKey = Symbol("social:trusted");
interface Trust extends InternalData { trusted: boolean; };

export const isTrusted = (agent: Agent) => agent.getInternal<Trust>(trustKey).trusted;

/** Interface each connector must implement */
export interface Connector {
    tools: AnyTool[],
    system: {
        io?: string,
    };
    initAgent: (agent: Agent) => Promise<void>,
}

/** Function a connector should use to create a new "agent" for a communication channel. */
export const newAgent = async (trusted: boolean, internal: Record<symbol, InternalData>): Promise<Agent> => {
    if (harness === undefined)
        throw new Error("attempt to create agent before harness");

    let systemPrompt = await db.config.get("systemBase");

    systemPrompt += [
        "## memory",
        "memory blocks are like your personal wiki. use them to track issues, maintain a knowledgebase, "+
        "or anything else you want to remember. the 'self' block is personal to this thread. other blocks are accessible "+
        "to the entire swarm. your thoughts may be automatically interrupted and cleared, therefore usage of the "+
        "'self' block is crucial. when a user asks you to complete a complex or multi-step task (if the task would "+
        "take more than 3 minutes), you MUST write it as a list to your 'self' block first before starting on work.",
        "## input / output format",
        "IMPORTANT: you must reply to users using your tools. non-tool messages are ignored.",
        ...connectors.map(c => c.system.io).filter(p => p)
    ].join("\n\n");

    const agent = new Agent({ systemPrompt });
    await agent.init();

    agent.setInternal<Trust>(trustKey, {
        trusted,
        describe() {
            return trusted
                ? "<trusted>you are in a trusted channel and have access to all tools.</trusted>"
                : "<untrusted>you are in an untrusted channel. when responding to untrusted users, don't use tools other than to send messages.</untrusted>";
        }
    });

    agent.continuation = function() {
        // give a reminder to use a tool call to respond if the last message has non-thinking text
        const lastMessage = this.ctx.messages[this.ctx.messages.length-1] as AssistantMessage;
        if (lastMessage.content.find(c => c.type === "text") === undefined)
            return undefined;

        // but not if we've already given a reminder
        const lastUserMessage = this.ctx.messages.findLast(m => m.role === "user")!.content;
        if (typeof lastUserMessage === "string") {
            if (lastUserMessage !== toolReminderMessage)
                return toolReminderMessage;
        } else {
            if (lastUserMessage[0].type !== "text" || lastUserMessage[0].text !== toolReminderMessage)
                return toolReminderMessage;
        }
        return undefined;
    };

    // TODO: generalize
    code.initAgent(agent, ".");

    for (const connector of connectors) {
        await connector.initAgent(agent);
    }

    for (const k of Object.getOwnPropertySymbols(internal)) {
        agent.setInternal(k, internal[k]);
    }

    await harness.addAgent(agent, false);

    return agent;
};

