import { readTameConfig } from "../../config/index.ts";
import { configSchema, SystemLoadPlugin } from "./index.ts";

export { configSchema } from "./index.ts";
export default new SystemLoadPlugin(readTameConfig("system-load.json", configSchema));
