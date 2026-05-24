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
	const plugins = externals.length === 0 ? minPlugins(rootDir) : basePlugins(rootDir);
	const b = await rollup({ input, external: externals, plugins });
	// terser in output for bundles that don't inline it (externals present → shared deps, min at output)
	await b.write({ file: outfile, format: "esm", plugins: externals.length === 0 ? [] : [terserPlugin] });
	await b.close();
}

// ---- entry files ----

writeFileSync(`${buildDir}/lit.entry.ts`, `export * from "lit";\nexport * from "lit/decorators.js";\n`);
writeFileSync(`${buildDir}/typebox.entry.ts`,
	`export * from "typebox";\nexport { default } from "typebox";\n` +
	`export { Compile, Code, Validator } from "typebox/compile";\n` +
	`export { default as compileDefault } from "typebox/compile";\n`);
writeFileSync(`${buildDir}/tame-rpc-client.entry.ts`,
	`export { RPCClient } from "@tame/rpc-client";\n` +
	`export { wsToStream } from "@tame/rpc-client/stream";\n`);

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
await bundle(`${dir}/static/shell.ts`, `${staticDir}/shell.js`, {
	externals: ["lit", "lit/decorators.js", "@tame/rpc-client", "typebox", "typebox/compile"],
});
console.log("  → static/shell.js");

// ---- cleanup ----
rmSync(`${buildDir}/lit.entry.ts`);
rmSync(`${buildDir}/typebox.entry.ts`);
rmSync(`${buildDir}/tame-rpc-client.entry.ts`);

console.log("build done.");
