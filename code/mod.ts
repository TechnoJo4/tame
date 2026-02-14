import { importAllInDirFlat, pathResolve, type Agent, type AnyTool } from "@tame/agent";
import { key, AgentState } from "./state.ts";

export const tools = await importAllInDirFlat(pathResolve(import.meta.dirname!, "tool")) as AnyTool[];

export const initAgent = (agent: Agent, cwd: string) => {
    agent.setInternal(key, new AgentState(pathResolve(cwd)));
};
