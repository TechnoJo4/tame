import type { TSchema, Static } from "typebox";
import { Type } from "typebox";

export interface CallDescription<I extends TSchema, O extends TSchema> {
	input: I;
	output: O;
	call: (args: Static<I>) => Promise<Static<O>>;
}

export const call = <I extends TSchema, O extends TSchema>(c: CallDescription<I, O>): CallDescription<I, O> => c;

export const baseRouteSchemas = {
	newAgent: {
		input: Type.Object({
			id: Type.Optional(Type.String()),
			system: Type.Optional(Type.String()),
		}),
		output: Type.Object({
			id: Type.String()
		})
	}
};
