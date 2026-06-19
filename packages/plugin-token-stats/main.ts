import { readTameConfig } from "@tame/sdk";
import { configSchema, TokenStatsPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new TokenStatsPlugin(readTameConfig("token-stats.json", configSchema));
