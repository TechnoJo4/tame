import {rpcMethod} from "@tame/rpc-sdk";
import {Type} from "typebox";

export const rpcSchema = {
	list: rpcMethod({
		input: Type.Object({}),
		output: Type.Object({
			sessions: Type.Array(Type.Object({
				id: Type.String(),
				title: Type.Optional(Type.String()),
				lastMessageAt: Type.Optional(Type.Number()),
			})),
		}),
	}),
	load: rpcMethod({
		input: Type.Object({id: Type.String()}),
		output: Type.Object({
			id: Type.String(),
		}),
	}),
};
