import { readTameConfig } from "@tame/sdk";
import { configSchema, OpsPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new OpsPlugin(readTameConfig("ops.json", configSchema));
