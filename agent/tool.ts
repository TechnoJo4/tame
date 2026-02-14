import type { TSchema, Static } from "@sinclair/typebox";
import type * as pi from "@mariozechner/pi-ai";
import type { Agent } from "./agent.ts";
import type { Harness } from "./harness.ts";
import { importAllInDirFlat, pathJoin } from "./loader.ts";

// Re-export for convenience
export { Type } from "@sinclair/typebox";

export interface Tool<TParameters extends TSchema> {
    /** Definition of the tool */
    def: pi.Tool<TParameters>;
    /** Implementation of the tool. This must return a string or object compatible with `JSON.stringify`. */
    run: (args: Static<TParameters>, agent: Agent, harness: Harness) => Promise<unknown> | unknown;
    /** Determines whether the tool should be accessible to an agent */
    see: ((agent: Agent) => boolean) | boolean;
};

export type AnyTool = Tool<TSchema>;

/** Helper to let typescript infer the schema type */
export const tool = <T extends TSchema>(tool: Tool<T>): Tool<T> => tool;

export const loadBaseTools = async () => await importAllInDirFlat(pathJoin(import.meta.dirname!, "tool")) as AnyTool[];
