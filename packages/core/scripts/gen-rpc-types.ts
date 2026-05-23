import { resolve, toFileUrl } from "@std/path";
import { readdir } from "node:fs/promises";

const dir = import.meta.dirname;
if (!dir) throw new Error("couldn't get import.meta.dirname");

const packagesDir = resolve(dir, "..", "..");
const referenceDirective = '/// <reference path="./rpc.d.ts" />';

const pluginNames: string[] = [];
for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
	if (entry.isDirectory() && entry.name.startsWith("plugin-")) {
		pluginNames.push(entry.name.replace("plugin-", ""));
	}
}
pluginNames.sort();

let count = 0;

for (const name of pluginNames) {
	const pluginDir = resolve(packagesDir, `plugin-${name}`);
	const schemaPath = resolve(pluginDir, "rpc-schema.ts");
	const indexPath = resolve(pluginDir, "index.ts");

	let mod;
	try {
		mod = await import(toFileUrl(schemaPath).toString());
	} catch {
		console.log(`gen-rpc-types: ${name}: no rpc-schema.ts, skipping`);
		continue;
	}

	if (!mod.rpcSchema) {
		console.log(`gen-rpc-types: ${name}: no rpcSchema export, skipping`);
		continue;
	}

	const schema = mod.rpcSchema;
	const methods = Object.keys(schema);

	// generate rpc.d.ts
	let out = `import type { Static } from "typebox";\n`;
	out += `import type { rpcSchema } from "./rpc-schema.ts";\n\n`;
	out += `declare module "@tame/rpc-client" {\n`;
	out += `\tinterface RPCRegistry {\n`;
	out += `\t\t${JSON.stringify(name)}: {\n`;

	for (const method of methods) {
		out += `\t\t\t${method}: {\n`;
		out += `\t\t\t\tinput: Static<(typeof rpcSchema)["${method}"]["input"]>;\n`;
		out += `\t\t\t\toutput: Static<(typeof rpcSchema)["${method}"]["output"]>;\n`;
		out += `\t\t\t};\n`;
	}

	out += `\t\t};\n`;
	out += `\t}\n`;
	out += `}\n`;

	const outPath = resolve(pluginDir, "rpc.d.ts");
	await Deno.writeTextFile(outPath, out);
	console.log(`gen-rpc-types: wrote plugin-${name}/rpc.d.ts (${methods.length} methods)`);

	// ensure index.ts has the reference directive
	const indexSrc = await Deno.readTextFile(indexPath);
	if (!indexSrc.includes(referenceDirective)) {
		await Deno.writeTextFile(indexPath, `${referenceDirective}\n${indexSrc}`);
		console.log(`gen-rpc-types: ${name}: added reference directive to index.ts`);
	}

	count++;
}

console.log(`gen-rpc-types: done (${count} plugins)`);
