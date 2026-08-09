import { Type } from "typebox";
import { rpcMethod } from "@tame/rpc-sdk";

export const rpcSchema = {
	newAgent: rpcMethod({
		input: Type.Object({ project: Type.String() }),
		output: Type.Object({ id: Type.String() }),
	}),
};
