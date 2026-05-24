// Build script for plugin-web.
// Bundles shell + vendor libs using rollup + swc.
// Plugin components are transpiled separately at server start (see index.ts).

import { writeFileSync, rmSync } from "node:fs";
import { rollup } from "rollup";
import { basePlugins, minPlugins, terserPlugin } from "./build-config.ts";

const dir = import.meta.dirname;
if (!dir) throw new Error("no dirname");

const staticDir = `${dir}/static`;
const buildDir = `${dir}/.build`;
const rootDir = `${dir}/../..`;

try { Deno.mkdirSync(buildDir); } catch { /* */ }

async function bundle(input, outfile, opts = {}) {
	const externals = opts.externals ?? [];
	const noMinify = opts.noMinify ?? false;
	const plugins = noMinify
		? basePlugins(rootDir)
		: externals.length === 0 ? minPlugins(rootDir) : basePlugins(rootDir);
	const b = await rollup({ input, external: externals, plugins });
	const outputPlugins = noMinify ? [] : externals.length === 0 ? [] : [terserPlugin];
	await b.write({ file: outfile, format: "esm", plugins: outputPlugins });
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
writeFileSync(`${buildDir}/lit-context.entry.ts`, `export { createContext, ContextProvider, ContextConsumer, provide, consume } from "@lit/context";\n`);

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
await bundle(`${dir}/static/shell.ts`, `${staticDir}/shell.js`, {
	externals: ["lit", "lit/decorators.js", "lit/directive.js", "lit/async-directive.js", "@lit/context", "@tame/rpc-client", "typebox", "typebox/compile"],
});
console.log("  → static/shell.js");

// ---- cleanup ----
rmSync(`${buildDir}/lit.entry.ts`);
rmSync(`${buildDir}/typebox.entry.ts`);
rmSync(`${buildDir}/tame-rpc-client.entry.ts`);
rmSync(`${buildDir}/lit-context.entry.ts`);

console.log("build done.");
