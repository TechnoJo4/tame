import {readTameConfig} from "@tame/sdk";

import {CompactPlugin, configSchema} from "./index.ts";

export {configSchema} from "./index.ts";

export default new CompactPlugin(readTameConfig("compact.json", configSchema));
