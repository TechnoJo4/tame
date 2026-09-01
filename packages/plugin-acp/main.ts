import {readTameConfig} from "@tame/sdk";

import {ACPPlugin, configSchema} from "./index.ts";

export {configSchema} from "./index.ts";

export default new ACPPlugin(readTameConfig("acp.json", configSchema));
