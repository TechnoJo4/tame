import { readTameConfig } from "@tame/sdk";
import { configSchema, ACPPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new ACPPlugin(readTameConfig("acp.json", configSchema));
