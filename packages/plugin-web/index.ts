import type { Plugin, IHarness } from "@tame/sdk";
import { Type } from "typebox";
import { call } from "@tame/rpc-sdk";
import { resolve } from "@std/path";
import { serve } from "./serve.ts";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import type { ComponentDef, Placement } from "@tame/web-sdk/placement";
import { swcOptions, tameAliasPattern, resolveExtensions } from "./build-config.ts";

export type { ComponentDef, Placement } from "@tame/web-sdk/placement";

export interface WebConfig {
	listen: { hostname: string; port: number };
	staticDir: string;
}

export const configSchema = Type.Object({
	listen: Type.Optional(Type.Object({
		hostname: Type.Optional(Type.String()),
		port: Type.Optional(Type.Number()),
	})),
	staticDir: Type.Optional(Type.String()),
});

interface RegistryEntry {
	src: string; // filesystem path
	url: string; // served URL
}

interface Registry {
	components: Record<string, { src: string }>;
	placements: Placement[];
	stylesheets: Record<string, string>; // pluginId → url
}

export class WebPlugin implements Plugin {
	id = "web" as const;

	#components = new Map<string, RegistryEntry>();
	#stylesheets = new Map<string, string>(); // pluginId → url
	#placements: Placement[] = [];
	#harness: IHarness | undefined;
	#config: WebConfig;
	#buildDir: string;

	constructor(config: WebConfig) {
		this.#config = config;
		this.#buildDir = `${config.staticDir}/../.build`;
	}

	/** Resolve a component path relative to the calling plugin's directory. */
	resolve(dirname: string, relative: string): string {
		return resolve(dirname, relative);
	}

	/** Register components and placements for a plugin. Called during init(). */
	async register(pluginId: string, components: ComponentDef[], placements: Placement[], css?: string): Promise<void> {
		const tsFiles: { src: string; tag: string }[] = [];

		for (const c of components) {
			if (c.src.endsWith(".ts")) {
				tsFiles.push({ src: c.src, tag: c.tag });
			} else {
				const basename = c.src.split("/").pop()!;
				const url = `/static/plugins/${pluginId}/${basename}`;
				this.#components.set(c.tag, { src: c.src, url });
			}
		}

		if (tsFiles.length > 0) {
			await this.#transpile(pluginId, tsFiles);
		}

		// copy CSS file to build output so it can be served
		if (css) {
			const outDir = `${this.#buildDir}/plugins/${pluginId}`;
			try { Deno.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
			const basename = css.split("/").pop()!;
			const outPath = `${outDir}/${basename}`;
			try { Deno.copyFileSync(css, outPath); } catch { /* not found */ }
			this.#stylesheets.set(pluginId, `/static/plugins/${pluginId}/${basename}`);
		}

		this.#placements.push(...placements);
	}

	/** Transpile .ts component files to .js using rollup + swc — same
	 *  config as the main build, so decorators etc. stay consistent.
	 *  Output goes to .build/plugins/<id>/. */
	async #transpile(pluginId: string, files: { src: string; tag: string }[]): Promise<void> {
		const outDir = `${this.#buildDir}/plugins/${pluginId}`;
		try { Deno.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }

		const mod = (p: string) => `${this.#buildDir}/node_modules/${p}`;
		const { rollup } = await import(mod("rollup/dist/es/rollup.js"));
		const swcPlugin = (await import(mod("@rollup/plugin-swc/dist/index.js"))).default;
		const resolvePlugin = (await import(mod("@rollup/plugin-node-resolve/dist/index.js"))).default;
		const aliasPlugin = (await import(mod("@rollup/plugin-alias/dist/index.js"))).default;

		const swc = swcPlugin({ swc: swcOptions });
		const alias = aliasPlugin({
			entries: [
				{ find: tameAliasPattern, replacement: `${this.#buildDir}/../../packages/$1` },
			],
		});

		for (const { src, tag } of files) {
			try {
				const build = await rollup({
					input: src,
					external: [/^lit/, /^@tame\/web-sdk/, /^typebox/],
					plugins: [alias, resolvePlugin({ browser: true, extensions: resolveExtensions }), swc],
				});
				const basename = src.split("/").pop()!.replace(/\.ts$/, ".js");
				await build.write({ file: `${outDir}/${basename}`, format: "esm" });
				await build.close();
				const url = `/static/plugins/${pluginId}/${basename}`;
				this.#components.set(tag, { src: `${outDir}/${basename}`, url });
			} catch (e) {
				console.warn(`plugin-web: rollup failed for ${tag} (${src}):`, e);
			}
		}
	}

	async init(harness: IHarness) {
		this.#harness = harness;

		const rpc = harness.getPlugin<RPCPlugin>("rpc");
		if (!rpc) throw new Error("plugin-web requires the rpc plugin");

		rpc.register("web", {
			getRegistry: call({
				input: Type.Object({}),
				output: Type.Object({
					components: Type.Record(Type.String(), Type.Object({ src: Type.String() })),
					placements: Type.Array(Type.Object({
						location: Type.String(),
						tag: Type.String(),
						props: Type.Optional(Type.Object({}, { additionalProperties: true })),
					})),
					stylesheets: Type.Record(Type.String(), Type.String()),
				}),
				call: async (): Promise<Registry> => {
					const components: Record<string, { src: string }> = {};
					for (const [tag, entry] of this.#components) {
						components[tag] = { src: entry.url };
					}
					const stylesheets: Record<string, string> = {};
					for (const [pluginId, url] of this.#stylesheets) {
						stylesheets[pluginId] = url;
					}
					return { components, placements: this.#placements, stylesheets };
				},
			}),
		});

		serve(this.#config, this.#components, this.#stylesheets, rpc);
	}
}
