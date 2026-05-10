import { readTameConfig } from "../../config/index.ts";
import { configSchema, AssistedByPlugin } from "./index.ts";

export default new AssistedByPlugin(readTameConfig("assisted-by.json", configSchema));
