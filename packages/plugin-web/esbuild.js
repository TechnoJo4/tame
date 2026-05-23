// Build script for plugin-web.
// Vendors lit from npm, bundles shell.ts → shell.js.
// Plugin components are NOT bundled — served as raw ES modules.

const dir = import.meta.dirname;
if (!dir) throw new Error("no dirname");

const staticDir = `${dir}/static`;
const buildDir = `${dir}/.build`;

// ---- vendor lit ----

try { Deno.mkdirSync(buildDir); } catch { /* exists */ }

Deno.writeTextFileSync(`${buildDir}/package.json`, JSON.stringify({
	dependencies: { lit: "3.3.3" },
}));

console.log("installing lit@3.3.3...");
await new Deno.Command("npm", {
	args: ["install", "--prefix", buildDir],
	cwd: dir, stdout: "inherit", stderr: "inherit",
}).output();

console.log("bundling lit...");
const litResult = await new Deno.Command("esbuild", {
	args: [
		`${buildDir}/node_modules/lit/index.js`,
		"--bundle", "--minify", "--format=esm",
		`--outfile=${staticDir}/lit.js`,
	],
	cwd: dir, stdout: "inherit", stderr: "inherit",
}).output();
if (litResult.code !== 0) Deno.exit(1);
console.log("  → static/lit.js");

// ---- bundle shell ----

console.log("bundling shell...");
const shellResult = await new Deno.Command("esbuild", {
	args: [
		`${dir}/static/shell.ts`,
		"--bundle", "--minify", "--format=esm",
		`--outfile=${staticDir}/shell.js`,
		"--external:lit",
	],
	cwd: dir, stdout: "inherit", stderr: "inherit",
}).output();
if (shellResult.code !== 0) Deno.exit(1);

console.log("  → static/shell.js");
console.log("build done.");
