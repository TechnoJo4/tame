import { readTameConfig } from "@tame/sdk";
import { configSchema, SubagentsPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new SubagentsPlugin(readTameConfig("subagents.json", configSchema));
