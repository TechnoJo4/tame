import type { TSchema, Static } from "@sinclair/typebox";

import type { Agent } from "./agent.ts";

export { Type } from "@sinclair/typebox";
export { StringEnum } from "../util/string-enum.ts";

export interface Tool<TArgs extends TSchema> {
    /** Name for the tool */
    name: string;
    /** Description of the tool */
    desc: string;
    /** Schema for the tool's parameters */
    args: TArgs;
    /** Implementation of the tool. This must return a string or object compatible with `JSON.stringify`. */
    exec: (args: Static<TArgs>, agent: Agent) => Promise<unknown> | unknown;
};

export type AnyTool = Tool<TSchema>;

/** Helper to let typescript infer the schema type */
export const tool = <T extends TSchema>(tool: Tool<T>): Tool<T> => tool;
