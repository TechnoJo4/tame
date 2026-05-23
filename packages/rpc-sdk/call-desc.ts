import type { TSchema, Static } from "typebox";
import { Type } from "typebox";

export interface CallDescription<I extends TSchema, O extends TSchema> {
	input: I;
	output: O;
	call: (args: Static<I>) => Promise<Static<O>>;
}

export const call = <I extends TSchema, O extends TSchema>(c: CallDescription<I, O>): CallDescription<I, O> => c;

/** Capture input/output typebox schemas for codegen. Use {@link call} for
 *  full call descriptions that include the implementation. */
export const rpcMethod = <I extends TSchema, O extends TSchema>(s: { input: I; output: O }) => s;

export const baseRouteSchemas = {
	newAgent: {
		input: Type.Object({
			id: Type.Optional(Type.String()),
			system: Type.Optional(Type.String()),
		}),
		output: Type.Object({
			id: Type.String()
		})
	},
	abort: {
		input: Type.Object({
			id: Type.String({ description: "The agent ID to abort." }),
		}),
		output: Type.Object({}, { additionalProperties: false }),
	},
	queueCompletion: {
		input: Type.Object({
			id: Type.String({ description: "The agent ID to queue a completion for." }),
		}),
		output: Type.Object({}, { additionalProperties: false }),
	},
	viewToolCall: {
		input: Type.Object({
			agent_id: Type.String({ description: "The agent ID." }),
			tool_use_id: Type.String({ description: "The tool_use block ID to resolve a view for." }),
			view: Type.String({ description: "The view name." }),
		}),
		output: Type.Any(),
	},
};
