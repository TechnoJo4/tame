import { Type } from "typebox";
import { rpcMethod } from "@tame/rpc-sdk";

export const rpcSchema = {
	newAgent: rpcMethod({
		input: Type.Object({ project: Type.String() }),
		output: Type.Object({ id: Type.String() }),
	}),
	listSessions: rpcMethod({
		input: Type.Object({}),
		output: Type.Object({
			sessions: Type.Array(Type.Object({
				id: Type.String(),
				title: Type.Optional(Type.String()),
				lastMessageAt: Type.Optional(Type.Number()),
				project: Type.Optional(Type.String()),
			})),
		}),
	}),
	loadSession: rpcMethod({
		input: Type.Object({ id: Type.String() }),
		output: Type.Object({ id: Type.String() }),
	}),
};
