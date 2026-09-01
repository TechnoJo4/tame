import {readTameConfig} from "@tame/sdk";

import {configSchema} from "./config.ts";
import {HistoryPlugin} from "./index.ts";

export {configSchema} from "./config.ts";

export default new HistoryPlugin(readTameConfig("history.json", configSchema));
