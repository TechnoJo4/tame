import { Agent } from "./agent.ts";

export interface Plugin {
	enabled?: true;
	init?: () => void;
	newAgent?: (agent: Agent) => void;
};
