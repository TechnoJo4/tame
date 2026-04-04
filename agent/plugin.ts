import { Agent } from "./agent.ts";

export interface Plugin {
    newAgent?: (agent: Agent) => void;
    init?: () => void;
};
