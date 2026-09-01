import {readTameConfig} from "@tame/sdk";

import {configSchema} from "./config.ts";
import {ProjectsPlugin} from "./index.ts";

export {configSchema} from "./config.ts";

export default new ProjectsPlugin(
    readTameConfig("projects.json", configSchema),
);
