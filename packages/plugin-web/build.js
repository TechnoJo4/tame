// Build script for plugin-web.
// Installs npm deps, then invokes rollup via CLI with a generated config.

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const dir = import.meta.dirname;
if (!dir) throw new Error("no dirname");

const staticDir = `${dir}/static`;
const buildDir = `${dir}/.build`;
const rootDir = `${dir}/../..`;

// ---- install npm deps ----

try { mkdirSync(buildDir); } catch { /* */ }

writeFileSync(`${buildDir}/package.json`, JSON.stringify({
	type: "module",
	dependencies: {
		lit: "3.3.3",
		typebox: "1.1.38",
		rollup: "4.44.0",
		"@rollup/plugin-swc": "0.4.0",
		"@rollup/plugin-node-resolve": "16.0.1",
		"@rollup/plugin-alias": "5.1.1",
		"@rollup/plugin-terser": "0.4.4",
	},
}));

console.log("installing npm deps...");
execSync("npm install --prefix " + buildDir, { cwd: dir, stdio: "inherit" });

// ---- generate rollup config and run ----

const rollupConfig = `
import swc from "@rollup/plugin-swc";
import resolve from "@rollup/plugin-node-resolve";
import alias from "@rollup/plugin-alias";
import terser from "@rollup/plugin-terser";

const swcPlugin = swc({
	swc: {
		jsc: {
			parser: { syntax: "typescript", decorators: true },
			transform: { decoratorVersion: "2021-12" },
			target: "es2022",
			loose: false,
		},
	},
});

const tameAlias = alias({
	entries: [
		{ find: /^@tame\\/(.*)/, replacement: "${rootDir}/packages/$1" },
	],
});

const typeboxDir = "${buildDir}/node_modules/typebox";

export default [
	// ---- lit (with decorators) ----
	{
		input: "${buildDir}/lit.entry.ts",
		output: { file: "${staticDir}/lit.js", format: "esm" },
		plugins: [resolve({ browser: true, extensions: [".ts", ".mjs", ".js"] }), swcPlugin, terser()],
	},
	// ---- typebox (main + compile combined) ----
	{
		input: "${buildDir}/typebox.entry.ts",
		output: { file: "${staticDir}/typebox.js", format: "esm" },
		plugins: [resolve({ browser: true }), swcPlugin, terser()],
	},
	// ---- @tame/rpc-client ----
	{
		input: "${buildDir}/tame-rpc-client.entry.ts",
		output: { file: "${staticDir}/tame-rpc-client.js", format: "esm" },
		external: ["typebox", "typebox/compile"],
		plugins: [tameAlias, resolve({ browser: true, extensions: [".ts", ".mjs", ".js"] }), swcPlugin, terser()],
	},
	// ---- shell ----
	{
		input: "${dir}/static/shell.ts",
		output: { file: "${staticDir}/shell.js", format: "esm" },
		external: ["lit", "lit/decorators.js", "@tame/rpc-client", "typebox", "typebox/compile"],
		plugins: [tameAlias, resolve({ browser: true, extensions: [".ts", ".mjs", ".js"] }), swcPlugin, terser()],
	},
];
`;

writeFileSync(`${buildDir}/rollup.config.mjs`, rollupConfig);

// ---- create entry files ----

writeFileSync(`${buildDir}/lit.entry.ts`, `export * from "lit";\nexport * from "lit/decorators.js";\n`);

writeFileSync(`${buildDir}/typebox.entry.ts`,
	`export * from "typebox";\nexport { default } from "typebox";\n` +
	`export { Compile, Code, Validator } from "typebox/compile";\n` +
	`export { default as compileDefault } from "typebox/compile";\n`);

writeFileSync(`${buildDir}/tame-rpc-client.entry.ts`,
	`export { RPCClient } from "@tame/rpc-client";\n` +
	`export { wsToStream } from "@tame/rpc-client/stream";\n`);

// ---- run rollup ----

console.log("bundling...");
execSync(`${buildDir}/node_modules/.bin/rollup -c ${buildDir}/rollup.config.mjs`, {
	cwd: dir, stdio: "inherit",
});

// ---- cleanup entry files ----
rmSync(`${buildDir}/lit.entry.ts`);
rmSync(`${buildDir}/typebox.entry.ts`);
rmSync(`${buildDir}/tame-rpc-client.entry.ts`);
rmSync(`${buildDir}/rollup.config.mjs`);

console.log("build done.");
