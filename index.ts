import { resolve, toFileUrl } from "@std/path";
import { config } from "./config/index.ts";
import { Harness } from "./agent/harness.ts";

const dir = import.meta.dirname;
if (dir === undefined) throw new Error("couldn't get import.meta.dirname");

const harness = new Harness();

for (const name of config.toolsets) {
    const path = resolve(dir, "toolsets", name, "index.ts");
    const toolset = await import(toFileUrl(path).toString());
    harness.addTools(...toolset.default);
}

const plugins = [];
for (const name of config.plugins) {
    const path = resolve(dir, "plugins", name, "main.ts");
    const plugin = await import(toFileUrl(path).toString());
    plugins.push(plugin.default);
}
harness.addPlugins(...plugins);
