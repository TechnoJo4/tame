import { readTameConfig } from "../../config/index.ts";
import { configSchema, ClaudelikePlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new ClaudelikePlugin(readTameConfig("claudelike.json", configSchema));
