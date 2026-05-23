import type { Plugin, IHarness } from "@tame/sdk";
import { Type } from "typebox";
import { call } from "@tame/rpc-sdk";
import { resolve } from "@std/path";
import { serve } from "./serve.ts";
import type { RPCPlugin } from "@tame/plugin-rpc/index";

export interface ComponentDef {
	tag: string;
	src: string; // absolute filesystem path, served as /static/plugins/<plugin>/<basename>
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
	listen: Type.Object({
		hostname: Type.String(),
		port: Type.Number(),
	}),
	staticDir: Type.String(),
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

	constructor(config: WebConfig) {
		this.#config = config;
	}

	/** Resolve a component path relative to the calling plugin's directory. */
	resolve(dirname: string, relative: string): string {
		return resolve(dirname, relative);
	}

	/** Register components and placements for a plugin. Called during init(). */
	register(pluginId: string, components: ComponentDef[], placements: Placement[]): void {
		for (const c of components) {
			const basename = c.src.split("/").pop()!;
			const url = `/static/plugins/${pluginId}/${basename}`;
			this.#components.set(c.tag, { src: c.src, url });
		}
		this.#placements.push(...placements);
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
