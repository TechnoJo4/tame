import {basename, join} from "@std/path";
import {rollup} from "rollup";

import {basePlugins, minPlugins, terserPlugin} from "./build-config.ts";

export interface BuildContext {
	rootDir: string;
	packageDir: string;
	staticDir: string;
	buildDir: string;
}

export interface ComponentInput {
	src: string;
	tag: string;
}

export interface BuiltComponent {
	src: string;
	tag: string;
	url: string;
}

interface BundleOptions {
	externals?: (string|RegExp)[];
	inlineDynamicImports?: boolean;
	minifyInput?: boolean;
	minifyOutput?: boolean;
	sourceMaps?: boolean;
}

const vendorEntries: Record<string, string> = {
	lit:
	    `export * from "lit";\nexport * from "lit/decorators.js";\nexport * from "lit/directive.js";\nexport * from "lit/async-directive.js";\n`,
	typebox: `export * from "typebox";\nexport { default } from "typebox";\n` +
	             `export { Compile, Code, Validator } from "typebox/compile";\n` +
	             `export { default as compileDefault } from "typebox/compile";\n`,
	"tame-rpc-client": `export { RPCClient } from "@tame/rpc-client";\n` +
	                       `export { wsToStream } from "@tame/rpc-client/stream";\n`,
	"lit-context":
	    `export { createContext, ContextProvider, ContextConsumer, ContextEvent, provide, consume } from "@lit/context";\n`,
	"web-sdk":
	    `export { agentIdContext, rpcClientContext, registryContext, settingsStoreContext, settingsPluginIdContext } from "@tame/web-sdk";\n` +
	        `export { setting, settingBool, settingWhen } from "@tame/web-sdk/setting-directives";\n`,
};

const shellExternals = [
	"lit",
	"lit/decorators.js",
	"lit/directive.js",
	"lit/async-directive.js",
	"@lit/context",
	/^@tame\/rpc-client/,
	/^@tame\/web-sdk/,
	"typebox",
	"typebox/compile",
];

const componentExternals = [
	/^lit/,
	/^@lit\//,
	/^@tame\/web-sdk/,
	/^typebox/,
];

function ensureDir(path: string): void { Deno.mkdirSync(path, { recursive: true }); }

async function bundle(context: BuildContext, input: string, output: string,
                      options: BundleOptions = {}): Promise<void> {
	const externals = options.externals ?? [];
	const build = await rollup({
		input,
		external: externals,
		plugins: options.minifyInput ? minPlugins(context.rootDir) : basePlugins(context.rootDir),
	});
	try {
		await build.write({
			file: output,
			format: "esm",
			inlineDynamicImports: options.inlineDynamicImports ?? false,
			plugins: options.minifyOutput ? [terserPlugin] : [],
			sourcemap: options.sourceMaps ?? false,
		});
	} finally { await build.close(); }
}

function vendorOptions(name: string): BundleOptions {
	switch (name) {
	case "lit":
	case "typebox":
		return { minifyInput: true };
	case "tame-rpc-client":
		return {
			externals: ["typebox", "typebox/compile"],
			minifyOutput: true,
		};
	case "lit-context":
		return { externals: ["lit"] };
	case "web-sdk":
		return { externals: ["lit", "@lit/context"], minifyOutput: true };
	default:
		throw new Error(`unknown plugin-web vendor bundle: ${name}`);
	}
}

async function writeVendorEntries(context: BuildContext): Promise<string[]> {
	ensureDir(context.buildDir);
	const names = Object.keys(vendorEntries);
	for (const name of names) {
		await Deno.writeTextFile(join(context.buildDir, `${name}.entry.ts`), vendorEntries[name]);
	}
	return names;
}

function removeVendorEntries(context: BuildContext, names: string[]): void {
	for (const name of names) {
		try {
			Deno.removeSync(join(context.buildDir, `${name}.entry.ts`));
		} catch {
			// best-effort cleanup after a failed build
		}
	}
}

export async function buildVendorBundles(context: BuildContext, sourceMaps: boolean): Promise<void> {
	const names = await writeVendorEntries(context);
	try {
		for (const name of names) {
			await bundle(context, join(context.buildDir, `${name}.entry.ts`), join(context.staticDir, `${name}.js`),
					     {...vendorOptions(name), sourceMaps });
		}
	} finally { removeVendorEntries(context, names); }
}

async function buildShellBundle(context: BuildContext, sourceMaps: boolean): Promise<void> {
	await bundle(context, join(context.packageDir, "web", "shell.ts"), join(context.staticDir, "shell.js"), {
		externals: shellExternals,
		inlineDynamicImports: true,
		minifyOutput: true,
		sourceMaps,
	});
}

function vendorBundlesExist(context: BuildContext): boolean {
	return Object.keys(vendorEntries).every((name) => {
		try {
			Deno.statSync(join(context.staticDir, `${name}.js`));
			return true;
		} catch { return false; }
	});
}

export async function buildShell(context: BuildContext, sourceMaps: boolean): Promise<void> {
	if (!vendorBundlesExist(context)) await buildVendorBundles(context, sourceMaps);
	await buildShellBundle(context, sourceMaps);
}

export async function buildAll(context: BuildContext, sourceMaps: boolean): Promise<void> {
	await buildVendorBundles(context, sourceMaps);
	await buildShellBundle(context, sourceMaps);
}

export async function transpileComponents(context: BuildContext, pluginId: string, files: ComponentInput[],
                                          sourceMaps: boolean): Promise<BuiltComponent[]> {
	const outDir = join(context.buildDir, "plugins", pluginId);
	ensureDir(outDir);
	const result: BuiltComponent[] = [];

	for (const { src, tag } of files) {
		const outName = basename(src).replace(/\.ts$/, ".js");
		const output = join(outDir, outName);
		try {
			await bundle(context, src, output, {
				externals: componentExternals,
				minifyOutput: true,
				sourceMaps,
			});
			result.push({
				src: output,
				tag,
				url: `/static/plugins/${pluginId}/${outName}`,
			});
		} catch (e) { console.warn(`plugin-web: rollup failed for ${tag} (${src}):`, e); }
	}

	return result;
}

export function copyStylesheet(context: BuildContext, pluginId: string, css: string): string {
	const outDir = join(context.buildDir, "plugins", pluginId);
	ensureDir(outDir);
	const name = basename(css);
	try {
		Deno.copyFileSync(css, join(outDir, name));
	} catch {
		// preserve the existing registration behavior for missing optional css
	}
	return `/static/plugins/${pluginId}/${name}`;
}
