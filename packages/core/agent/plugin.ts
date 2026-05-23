import type { Agent } from "./agent.ts";
import type { Harness } from "./harness.ts";

export interface Plugin {
	id: string;
	enabled?: true;
	init?: (harness: Harness) => void;
	newAgent?: (agent: Agent) => void;
};
