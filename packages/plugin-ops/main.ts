import { readTameConfig } from "@tame/sdk";
import { configSchema } from "./config.ts";
import { OpsPlugin } from "./index.ts";

export { configSchema } from "./config.ts";

export default new OpsPlugin(readTameConfig("ops.json", configSchema));
