import type { Static, TSchema } from "typebox";
export { Type } from "typebox";
export { StringEnum } from "../util/string-enum.ts";
import type { IAgent } from "./interfaces.ts";
import type { ToolResult } from "../llm/types.ts";

export type ToolExecResult<T> = string | {
	content: string;
	meta?: T
}

export interface Tool<TArgs extends TSchema, TMeta = unknown> {
	/** Name for the tool */
	name: string;
	/** Description of the tool */
	desc: string;
	/** Schema for the tool's parameters */
	args: TArgs;
	/** Implementation of the tool. This must return a string or object compatible with `JSON.stringify`. */
	exec: (args: Static<TArgs>, agent: IAgent) => Promise<ToolExecResult<TMeta>> | ToolExecResult<TMeta>;
	/** View functions. */
	view?: Record<string, (args: Static<TArgs>, result?: ToolResult, meta?: TMeta) => unknown>;
}

export interface AnyTool {
	name: string;
	desc: string;
	args: TSchema;
	exec: (args: never, agent: IAgent) => Promise<unknown> | unknown;
	view?: Record<string, (args: never, result?: ToolResult) => unknown>;
}

/** Helper to let typescript infer the schema type */
export const tool = <T extends TSchema, TMeta>(tool: Tool<T, TMeta>): Tool<T, TMeta> => tool;
