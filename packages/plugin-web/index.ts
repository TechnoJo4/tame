import type { Plugin, IHarness } from "@tame/sdk";
import { Type } from "typebox";
import { call } from "@tame/rpc-sdk";
import { resolve } from "@std/path";
import { serve } from "./serve.ts";
import type { RPCPlugin } from "@tame/plugin-rpc/index";

export interface ComponentDef {
	tag: string;
	src: string; // absolute filesystem path, .ts or .js
}

export interface Placement {
	location: string;
	tag: string;
	props?: Record<string, unknown>;
}

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
}

export class WebPlugin implements Plugin {
	id = "web" as const;

	#components = new Map<string, RegistryEntry>();
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
	register(pluginId: string, components: ComponentDef[], placements: Placement[]): void {
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
			this.#transpile(pluginId, tsFiles);
		}

		this.#placements.push(...placements);
	}

	/** Transpile .ts component files to .js using esbuild. No bundling — just
	 *  strip types and convert to ESM. Output goes to .build/plugins/<id>/. */
	#transpile(pluginId: string, files: { src: string; tag: string }[]): void {
		const outDir = `${this.#buildDir}/plugins/${pluginId}`;
		try { Deno.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }

		const args = [
			...files.map((f) => f.src),
			`--outdir=${outDir}`,
			"--format=esm",
		];

		const proc = new Deno.Command("esbuild", { args, stdout: "null", stderr: "null" });
		const { code } = proc.outputSync();
		if (code !== 0) {
			console.warn(`plugin-web: esbuild failed for plugin ${pluginId}, skipping transpile`);
			return;
		}

		for (const { src, tag } of files) {
			const basename = src.split("/").pop()!.replace(/\.ts$/, ".js");
			const outPath = `${outDir}/${basename}`;
			const url = `/static/plugins/${pluginId}/${basename}`;
			this.#components.set(tag, { src: outPath, url });
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
				}),
				call: async (): Promise<Registry> => {
					const components: Record<string, { src: string }> = {};
					for (const [tag, entry] of this.#components) {
						components[tag] = { src: entry.url };
					}
					return { components, placements: this.#placements };
				},
			}),
		});

		serve(this.#config, this.#components, rpc);
	}
}
