import { Client } from "discord.js";
import { Agent, InternalData } from "@tame/agent";

export const key = Symbol("social:Discord");

export interface AgentState extends InternalData {
    /** Client */
    client: Client;
    /** Channel this agent is interacting in. */
    channelId: string,
    /** If the channel is in a server, this should be its ID. */
    guildId?: string,
    /** If the channel is a DM, this should be the user's ID. */
    userId?: string,
}

export const see = (agent: Agent) => agent.hasInternal(key);

export const state = (agent: Agent) => agent.getInternal<AgentState>(key);

