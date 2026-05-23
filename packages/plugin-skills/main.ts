import { readTameConfig } from "@tame/sdk";
import { configSchema, SkillsPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new SkillsPlugin(readTameConfig("skills.json", configSchema));
