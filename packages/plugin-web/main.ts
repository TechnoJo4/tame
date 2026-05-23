import { readTameConfig } from "@tame/sdk";
import { configSchema, WebPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

const config = readTameConfig("web.json", configSchema);
export default new WebPlugin(config);
