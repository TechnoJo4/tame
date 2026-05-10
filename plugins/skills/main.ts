import { readTameConfig } from "../../config/index.ts";
import { configSchema, SkillsPlugin } from "./index.ts";

export default new SkillsPlugin(readTameConfig("skills.json", configSchema));
