import { resolve, toFileUrl } from "@std/path";
import { config } from "./config/index.ts";
import * as harness from "./agent/harness.ts";

const dir = import.meta.dirname;
if (dir === undefined) throw new Error("couldn't get import.meta.dirname");

for (const name of config.toolsets) {
    const path = resolve(dir, "toolsets", name, "index.ts");
    const toolset = await import(toFileUrl(path).toString());
    harness.tools.push(...toolset.default);
}

for (const name of config.plugins) {
    const path = resolve(dir, "plugins", name, "index.ts");
    const plugin = await import(toFileUrl(path).toString());
    harness.plugins.push(plugin.default);
}

for (const p of harness.plugins) p.enabled = true;
for (const p of harness.plugins) p.init?.();
