import { readTameConfig } from "@tame/sdk";
import { configSchema, SystemLoadPlugin } from "./index.ts";

export { configSchema } from "./index.ts";
export default new SystemLoadPlugin(readTameConfig("system-load.json", configSchema));
