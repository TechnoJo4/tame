import { HistoryPlugin } from "./index.ts";
import { readTameConfig } from "@tame/sdk";
import { configSchema } from "./config.ts";

export { configSchema } from "./config.ts";

export default new HistoryPlugin(readTameConfig("history.json", configSchema));
