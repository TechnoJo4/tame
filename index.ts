import { resolve, toFileUrl } from "@std/path";
import { config } from "./config/index.ts";
import * as harness from "./agent/harness.ts";

const dir = import.meta.dirname;
if (dir === undefined) throw new Error("couldn't get import.meta.dirname");

for (const name of config.toolsets) {
    const path = resolve(dir, "toolsets", name);
    const toolset = await import(toFileUrl(path).toString());
    harness.plugins.push(...toolset.default);
}

for (const name of config.plugins) {
    const path = resolve(dir, "plugins", name);
    const plugin = await import(toFileUrl(path).toString());
    harness.plugins.push(plugin.default);
}

for (const p of harness.plugins) {
    await p.init?.();
}

// debug: remove once there's a first interface
const agent = harness.newAgent();
while (true) {
    const text = prompt();
    if (!text) break;
    agent.do("userMessage", {
        msg: {
            role: "user",
            content: [ { type: "text", text } ]
        }
    });
}
