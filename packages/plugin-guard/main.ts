import { readTameConfig } from "@tame/sdk";
import { configSchema, GuardPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new GuardPlugin(readTameConfig("guard.json", configSchema));
