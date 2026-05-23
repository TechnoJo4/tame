import { readTameConfig } from "@tame/sdk";
import { configSchema, RPCWSPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new RPCWSPlugin(readTameConfig("rpc-ws.json", configSchema));
