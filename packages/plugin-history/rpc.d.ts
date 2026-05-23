import type { Static } from "typebox";
import type { rpcSchema } from "./rpc-schema.ts";

declare module "@tame/rpc-client" {
	interface RPCRegistry {
		"history": {
			list: {
				input: Static<(typeof rpcSchema)["list"]["input"]>;
				output: Static<(typeof rpcSchema)["list"]["output"]>;
			};
			load: {
				input: Static<(typeof rpcSchema)["load"]["input"]>;
				output: Static<(typeof rpcSchema)["load"]["output"]>;
			};
		};
	}
}
