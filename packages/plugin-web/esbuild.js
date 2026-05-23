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

const typeboxDir = `${buildDir}/node_modules/typebox`;

function esbuild(args) {
	return new Deno.Command("esbuild", {
		args, cwd: dir, stdout: "inherit", stderr: "inherit",
	}).output();
}

// ---- bundle lit ----

console.log("bundling lit...");
await esbuild([
	`${buildDir}/node_modules/lit/index.js`,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/lit.js`,
]);
console.log("  → static/lit.js");

// ---- bundle typebox ----

console.log("bundling typebox...");
await esbuild([
	`${typeboxDir}/build/index.mjs`,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/typebox.js`,
]);
console.log("  → static/typebox.js");

console.log("bundling typebox/compile...");
await esbuild([
	`${typeboxDir}/build/compile/index.mjs`,
	"--bundle", "--minify", "--format=esm",
	`--outfile=${staticDir}/typebox-compile.js`,
	"--external:typebox",
]);
console.log("  → static/typebox-compile.js");

// ---- bundle @tame/rpc-client ----

console.log("bundling @tame/rpc-client...");

// create a temporary entry that re-exports both RPCClient and wsToStream
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
]);
console.log("  → static/shell.js");

// ---- cleanup ----
try { Deno.removeSync(bridgePath); } catch { /* */ }
console.log("build done.");
