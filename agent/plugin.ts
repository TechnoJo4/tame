import { Agent } from "./agent.ts";

export interface Plugin {
    loaded?: true;
    init?: () => void;
    newAgent?: (agent: Agent) => void;
};
