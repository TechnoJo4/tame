import { readTameConfig } from "../../config/index.ts";
import { configSchema, OpsPlugin } from "./index.ts";

export default new OpsPlugin(readTameConfig("ops.json", configSchema));
