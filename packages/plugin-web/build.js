// Build script for plugin-web.
// Bundles shell + vendor libs using rollup + swc.
// Plugin components are transpiled separately at server start (see index.ts).

import { resolve } from "@std/path";
import { writeFileSync, rmSync } from "node:fs";
import { rollup } from "rollup";
import { basePlugins, minPlugins, terserPlugin } from "./build-config.ts";

const dir = import.meta.dirname;
if (!dir) throw new Error("no dirname");

const staticDir = resolve(dir, "static");
const buildDir = resolve(dir, ".build");
const rootDir = resolve(dir, "..", "..");

try { Deno.mkdirSync(buildDir); } catch { /* */ }

async function bundle(input, outfile, opts = {}) {
	const externals = opts.externals ?? [];
	const noMinify = opts.noMinify ?? false;
	const inlineDynamicImports = opts.inlineDynamicImports ?? false;
	const plugins = noMinify
		? basePlugins(rootDir)
		: externals.length === 0 ? minPlugins(rootDir) : basePlugins(rootDir);
	const b = await rollup({ input, external: externals, plugins });
	const outputPlugins = noMinify ? [] : externals.length === 0 ? [] : [terserPlugin];
	await b.write({ file: outfile, format: "esm", inlineDynamicImports, plugins: outputPlugins });
	await b.close();
}

// ---- entry files ----

writeFileSync(`${buildDir}/lit.entry.ts`, `export * from "lit";\nexport * from "lit/decorators.js";\nexport * from "lit/directive.js";\nexport * from "lit/async-directive.js";\n`);
writeFileSync(`${buildDir}/typebox.entry.ts`,
	`export * from "typebox";\nexport { default } from "typebox";\n` +
	`export { Compile, Code, Validator } from "typebox/compile";\n` +
	`export { default as compileDefault } from "typebox/compile";\n`);
writeFileSync(`${buildDir}/tame-rpc-client.entry.ts`,
	`export { RPCClient } from "@tame/rpc-client";\n` +
	`export { wsToStream } from "@tame/rpc-client/stream";\n`);
writeFileSync(`${buildDir}/lit-context.entry.ts`, `export { createContext, ContextProvider, ContextConsumer, ContextEvent, provide, consume } from "@lit/context";\n`);
writeFileSync(`${buildDir}/web-sdk.entry.ts`, `export { agentIdContext } from "@tame/web-sdk";\n`);

// ---- bundle ----

console.log("bundling...");
await bundle(`${buildDir}/lit.entry.ts`, `${staticDir}/lit.js`);
console.log("  → static/lit.js");
await bundle(`${buildDir}/typebox.entry.ts`, `${staticDir}/typebox.js`);
console.log("  → static/typebox.js");
await bundle(`${buildDir}/tame-rpc-client.entry.ts`, `${staticDir}/tame-rpc-client.js`, {
	externals: ["typebox", "typebox/compile"],
});
console.log("  → static/tame-rpc-client.js");
await bundle(`${buildDir}/lit-context.entry.ts`, `${staticDir}/lit-context.js`, {
	externals: ["lit"],
	noMinify: true,
});
console.log("  → static/lit-context.js");
await bundle(`${buildDir}/web-sdk.entry.ts`, `${staticDir}/web-sdk.js`, {
	externals: ["lit", "@lit/context"],
});
console.log("  → static/web-sdk.js");
await bundle(`${dir}/web/shell.ts`, `${staticDir}/shell.js`, {
	externals: ["lit", "lit/decorators.js", "lit/directive.js", "lit/async-directive.js", "@lit/context", "@tame/rpc-client", "@tame/web-sdk", "typebox", "typebox/compile"],
	inlineDynamicImports: true,
});
console.log("  → static/shell.js");

// ---- cleanup ----
rmSync(`${buildDir}/lit.entry.ts`);
rmSync(`${buildDir}/typebox.entry.ts`);
rmSync(`${buildDir}/tame-rpc-client.entry.ts`);
rmSync(`${buildDir}/lit-context.entry.ts`);
rmSync(`${buildDir}/web-sdk.entry.ts`);

console.log("build done.");
