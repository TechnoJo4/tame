import { readTameConfig } from "../../config/index.ts";
import { configSchema, RPCWSPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new RPCWSPlugin(readTameConfig("rpc-ws.json", configSchema));
