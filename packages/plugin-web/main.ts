import { readTameConfig } from "@tame/sdk";
import { configSchema, type WebConfig, WebPlugin } from "./index.ts";

export { configSchema } from "./index.ts";

const raw = readTameConfig("web.json", configSchema);
const dir = import.meta.dirname!;

const config: WebConfig = {
	listen: {
		hostname: raw.listen?.hostname ?? "127.0.0.1",
		port: raw.listen?.port ?? 6780,
	},
	staticDir: raw.staticDir ?? `${dir}/static`,
	buildShell: raw.buildShell ?? true,
};

export default new WebPlugin(config);
