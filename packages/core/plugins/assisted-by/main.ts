import { readTameConfig } from "@tame/sdk";
import { configSchema, AssistedByPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new AssistedByPlugin(readTameConfig("assisted-by.json", configSchema));
