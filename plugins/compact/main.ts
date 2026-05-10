import { readTameConfig } from "../../config/index.ts";
import { configSchema, CompactPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

export default new CompactPlugin(readTameConfig("compact.json", configSchema));
