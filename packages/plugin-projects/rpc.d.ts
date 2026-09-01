import type { Static } from "typebox";
import type { rpcSchema } from "./rpc-schema.ts";

declare module "@tame/rpc-client" {
	interface RPCRegistry {
		"projects": {
			newAgent: {
				input: Static<(typeof rpcSchema)["newAgent"]["input"]>;
				output: Static<(typeof rpcSchema)["newAgent"]["output"]>;
			};
			listSessions: {
				input: Static<(typeof rpcSchema)["listSessions"]["input"]>;
				output: Static<(typeof rpcSchema)["listSessions"]["output"]>;
			};
			loadSession: {
				input: Static<(typeof rpcSchema)["loadSession"]["input"]>;
				output: Static<(typeof rpcSchema)["loadSession"]["output"]>;
			};
		};
	}
}
