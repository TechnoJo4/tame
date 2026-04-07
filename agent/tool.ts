import type { Static, TSchema } from "@sinclair/typebox";
export { Type } from "@sinclair/typebox";
export { StringEnum } from "../util/string-enum.ts";
import type { Agent } from "./agent.ts";
import { ToolResult, ToolUse } from "../llm/types.ts";

export interface Tool<TArgs extends TSchema> {
    /** Name for the tool */
    name: string;
    /** Description of the tool */
    desc: string;
    /** Schema for the tool's parameters */
    args: TArgs;
    /** Implementation of the tool. This must return a string or object compatible with `JSON.stringify`. */
    exec: (args: Static<TArgs>, agent: Agent) => Promise<unknown> | unknown;
    /** View functions. */
    view?: Record<string, (args: Static<TArgs>, result?: ToolResult) => unknown>;
};

export interface AnyTool {
    name: string;
    desc: string;
    args: TSchema;
    exec: (args: never, agent: Agent) => Promise<unknown> | unknown;
    view?: Record<string, (args: never, result?: ToolResult) => unknown>;
};

/** Helper to let typescript infer the schema type */
export const tool = <T extends TSchema>(tool: Tool<T>): Tool<T> => tool;
