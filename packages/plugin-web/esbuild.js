// Build script for plugin-web.
// Vendors lit + typebox from npm, bundles @tame/rpc-client from monorepo.
// Plugin components are NOT bundled — served as raw ES modules.

const dir = import.meta.dirname;
if (!dir) throw new Error("no dirname");

const staticDir = `${dir}/static`;
const buildDir = `${dir}/.build`;
const rootDir = `${dir}/../..`; // tame repo root

// ---- install npm deps ----

try { Deno.mkdirSync(buildDir); } catch { /* exists */ }

Deno.writeTextFileSync(`${buildDir}/package.json`, JSON.stringify({
	dependencies: {
		lit: "3.3.3",
		typebox: "1.1.38",
	},
}));

console.log("installing npm deps...");
await new Deno.Command("npm", {
	args: ["install", "--prefix", buildDir],
	cwd: dir, stdout: "inherit", stderr: "inherit",
}).output();

// ---- symlink @tame packages so esbuild can resolve bare specifiers ----
// esbuild resolves from the real (post-symlink) directory, so it walks up
// from packages/rpc-sdk/ looking for node_modules. we place a bridge symlink
// at packages/node_modules so typebox is reachable from any package.

const tameNodeModules = `${buildDir}/node_modules/@tame`;
try { Deno.mkdirSync(tameNodeModules, { recursive: true }); } catch { /* */ }

const symlink = (name, target) => {
	const linkPath = `${tameNodeModules}/${name}`;
	try { Deno.removeSync(linkPath); } catch { /* */ }
	Deno.symlinkSync(target, linkPath, "dir");
};

symlink("rpc-client", `${rootDir}/packages/rpc-client`);
symlink("rpc-sdk", `${rootDir}/packages/rpc-sdk`);
symlink("sdk", `${rootDir}/packages/sdk`);

// bridge: packages/node_modules → .build/node_modules (so @tame/* can resolve typebox)
const bridgePath = `${rootDir}/packages/node_modules`;
try { Deno.removeSync(bridgePath); } catch { /* */ }
Deno.symlinkSync(buildDir + "/node_modules", bridgePath, "dir");

// ---- helper ----

function esbuild(args) {
	return new Deno.Command("esbuild", {
		args, cwd: dir, stdout: "inherit", stderr: "inherit",
	}).output();
}

const typeboxDir = `${buildDir}/node_modules/typebox`;

// ---- bundle lit (with decorators) ----

console.log("bundling lit...");

const litEntry = `${buildDir}/lit.entry.ts`;
Deno.writeTextFileSync(litEntry, [
	`export * from "lit";`,
	`export * from "lit/decorators.js";`,
	``,
].join("\n"));

await esbuild([
	litEntry,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/lit.js`,
]);
Deno.removeSync(litEntry);
console.log("  → static/lit.js");

// ---- bundle typebox (main + compile in ONE file, shared internals) ----
// if Compile lives in a separate bundle it gets its own copy of typebox
// internals, and schemas built by Type from the main bundle won't validate
// against validators from the compile bundle. bundling together fixes this.

console.log("bundling typebox + typebox/compile...");

// create a temp entry that re-exports both
const typeboxEntry = `${buildDir}/typebox-combined.entry.ts`;
Deno.writeTextFileSync(typeboxEntry, [
	`export * from "typebox";`,
	`export { default } from "typebox";`,
	`export { Compile, Code, Validator } from "typebox/compile";`,
	`export { default as compileDefault } from "typebox/compile";`,
	``,
].join("\n"));

await esbuild([
	typeboxEntry,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/typebox.js`,
]);
Deno.removeSync(typeboxEntry);
console.log("  → static/typebox.js (combined)");

// ---- bundle @tame/rpc-client ----

console.log("bundling @tame/rpc-client...");

const entryFile = `${buildDir}/tame-rpc-client.entry.ts`;
Deno.writeTextFileSync(entryFile, [
	`export { RPCClient } from "@tame/rpc-client";`,
	`export { wsToStream } from "@tame/rpc-client/stream";`,
	``,
].join("\n"));

try {
	const result = await esbuild([
		entryFile,
		"--bundle", "--minify", "--format=esm",
		`--outfile=${staticDir}/tame-rpc-client.js`,
		"--external:typebox",
		"--external:typebox/compile",
	]);
	if (result.code !== 0) Deno.exit(1);
} finally {
	Deno.removeSync(entryFile);
}
console.log("  → static/tame-rpc-client.js");

// ---- bundle shell ----

console.log("bundling shell...");
await esbuild([
	`${dir}/static/shell.ts`,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/shell.js`,
	"--external:lit",
	"--external:@tame/rpc-client",
	"--external:typebox",
	"--external:typebox/compile",
	"--supported:decorators=true",
]);
console.log("  → static/shell.js");

// ---- cleanup ----
try { Deno.removeSync(bridgePath); } catch { /* */ }
console.log("build done.");
