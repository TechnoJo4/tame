import { resolve, toFileUrl } from "@std/path";
import { config } from "./config/index.ts";
import { Harness } from "./agent/harness.ts";
import type { Plugin } from "@tame/sdk";

const harness = new Harness();

async function loadPlugin(name: string): Promise<{ default: unknown }> {
	// direct filesystem path
	if (name.startsWith("./") || name.startsWith("/")) {
		return await import(toFileUrl(resolve(name)).toString());
	}

	// bare specifier (workspace package or npm/jsr) — try as-is first
	if (name.includes("/")) {
		return await import(name);
	}

	// search pluginSources directories
	for (const source of config.pluginSources) {
		try {
			const path = resolve(source, name, "main.ts");
			return await import(toFileUrl(path).toString());
		} catch {
			// not found in this source, try next
		}
	}

	// try @tame/plugin-{name} as bare specifier
	return await import(`@tame/plugin-${name}`);
}

const plugins: unknown[] = [];
for (const name of config.plugins) {
	const mod = await loadPlugin(name);
	plugins.push(mod.default);
}
harness.addPlugins(...plugins as Plugin[]);
