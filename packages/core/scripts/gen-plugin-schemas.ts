import { resolve, toFileUrl } from "@std/path";
import { readdir } from "node:fs/promises";

const dir = import.meta.dirname;
if (!dir) throw new Error("couldn't get import.meta.dirname");

const packagesDir = resolve(dir, "..", "..", "..");
const outDir = resolve(dir, "..", "schemas", "plugins");

await Deno.mkdir(outDir, { recursive: true });

const pluginNames: string[] = [];
for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
	if (entry.isDirectory() && entry.name.startsWith("plugin-")) {
		pluginNames.push(entry.name.replace("plugin-", ""));
	}
}
pluginNames.sort();

let count = 0;
const schemas: Record<string, object> = {};

for (const name of pluginNames) {
	const mainPath = resolve(packagesDir, `plugin-${name}`, "main.ts");
	let mod;
	try {
		mod = await import(toFileUrl(mainPath).toString());
	} catch (e) {
		console.warn(`gen-plugin-schemas: skipping ${name}: could not import main.ts (${e instanceof Error ? e.message : e})`);
		continue;
	}

	if (!mod.configSchema) {
		console.log(`gen-plugin-schemas: ${name}: no configSchema export, skipping`);
		continue;
	}

	const schema = JSON.parse(JSON.stringify(mod.configSchema));
	schema.$schema = "https://json-schema.org/draft/2020-12/schema";

	const outPath = resolve(outDir, `${name}.json`);
	await Deno.writeTextFile(outPath, JSON.stringify(schema, null, "\t") + "\n");

	schemas[name] = schema;
	count++;
	console.log(`gen-plugin-schemas: wrote ${name}.json`);
}

console.log(`gen-plugin-schemas: done`);
