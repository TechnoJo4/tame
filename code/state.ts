import type { Agent, InternalData } from "@tame/agent";

export const key = Symbol("code");

export class AgentState implements InternalData {
    cwd: string;

    constructor(workingDirectory: string) {
        this.cwd = workingDirectory;
    }

    describe() {
        return `<cwd>${this.cwd}</cwd>`;
    }
}

export const see = (agent: Agent) => agent.hasInternal(key);

export const state = (agent: Agent) => agent.getInternal<AgentState>(key);
