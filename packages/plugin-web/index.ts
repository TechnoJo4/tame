import {basename, resolve} from "@std/path";
import type {RPCPlugin} from "@tame/plugin-rpc/index";
import {call} from "@tame/rpc-sdk";
import {type IAgent, type IHarness, type Plugin, tameMsgMeta} from "@tame/sdk";
import type {ComponentDef, Placement} from "@tame/web-sdk/placement";
import {Type} from "typebox";

import {buildShell, type ComponentInput, copyStylesheet, transpileComponents} from "./build.ts";
import {assistantBlocksToItems, contextToItems, paginateItems} from "./items.ts";
import {serve} from "./serve.ts";

export type {ComponentDef, Placement} from "@tame/web-sdk/placement";

export interface WebConfig {
	listen: { hostname: string; port: number };
	staticDir: string;
	buildShell: boolean;
	sourceMaps: boolean;
}

export const configSchema = Type.Object({
	listen: Type.Optional(Type.Object({
		hostname: Type.Optional(Type.String()),
		port: Type.Optional(Type.Number()),
	})),
	staticDir: Type.Optional(Type.String()),
	buildShell: Type.Optional(Type.Boolean()),
	sourceMaps: Type.Optional(Type.Boolean()),
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
	#harness: IHarness|undefined;
	#rpc: RPCPlugin|undefined;
	#config: WebConfig;
	#packageDir: string;
	#buildDir: string;
	#rootDir: string;

	constructor(config: WebConfig) {
		this.#config = config;
		this.#packageDir = resolve(import.meta.dirname!);
		this.#buildDir = resolve(config.staticDir, "..", ".build");
		this.#rootDir = resolve(config.staticDir, "..", "..", "..");
	}

	/** Resolve a component path relative to the calling plugin's directory. */
	resolve(dirname: string, relative: string): string { return resolve(dirname, relative); }

	/** Register components and placements for a plugin. Called during init(). */
	async register(pluginId: string, components: ComponentDef[], placements: Placement[], css?: string): Promise<void> {
		const tsFiles: ComponentInput[] = [];

		for (const c of components) {
			if (c.src.endsWith(".ts")) {
				tsFiles.push({ src: c.src, tag: c.tag });
			} else {
				const url = `/static/plugins/${pluginId}/${basename(c.src)}`;
				this.#components.set(c.tag, { src: c.src, url });
			}
		}

		if (tsFiles.length > 0) {
			const built = await transpileComponents(this.#buildContext(), pluginId, tsFiles, this.#config.sourceMaps);
			for (const component of built) {
				this.#components.set(component.tag, {
					src: component.src,
					url: component.url,
				});
			}
		}

		// copy CSS file to build output so it can be served
		if (css) { this.#stylesheets.set(pluginId, copyStylesheet(this.#buildContext(), pluginId, css)); }

		this.#placements.push(...placements);
	}

	#buildContext() {
		return {
			rootDir: this.#rootDir,
			packageDir: this.#packageDir,
			staticDir: this.#config.staticDir,
			buildDir: this.#buildDir,
		};
	}

	async #buildShell(): Promise<void> {
		try {
			await buildShell(this.#buildContext(), this.#config.sourceMaps);
		} catch (e) { console.warn("plugin-web: shell rebuild failed, using existing shell.js:", e); }
	}

	async init(harness: IHarness) {
		this.#harness = harness;

		if (this.#config.buildShell) { await this.#buildShell(); }

		const rpc = harness.getPlugin<RPCPlugin>("rpc");
		if (!rpc) throw new Error("plugin-web requires the rpc plugin");
		this.#rpc = rpc;

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
				call: async(): Promise<Registry> => {
			        const components: Record<string, { src: string }> = {};
			        for (const [tag, entry] of this.#components) { components[tag] = { src: entry.url }; }
			        const stylesheets: Record<string, string> = {};
			        for (const [pluginId, url] of this.#stylesheets) { stylesheets[pluginId] = url; }
			        return { components, placements: this.#placements, stylesheets };
				},
			}),

			getItems: call({
				input: Type.Object({
					id: Type.String(),
					offset: Type.Number(),
					limit: Type.Number(),
				}),
				output: Type.Object({
					items: Type.Array(Type.Object({}, { additionalProperties: true })),
					total: Type.Number(),
				}),
				call: async ({ id, offset, limit }) => {
			        const agent = harness.getAgent(id);
			        if (!agent) throw new Error(`agent ${id} not found`);
			        const all = contextToItems(agent);
			        return {
				        items: paginateItems(all, offset, limit) as unknown as Record<string, unknown>[],
				        total: all.length,
			        };
				},
			}),
		});

		// register web's own settings component at the settings modal placement
		const dir = import.meta.dirname!;
		await this.register("web",
		                    [{ tag: "tame-web-settings", src: this.resolve(dir, "./web/components/web-settings.ts") }],
		                    [{ location: "modal:settings", tag: "tame-web-settings", props: { pluginId: "web" } }]);

		serve(this.#config, this.#components, this.#stylesheets, rpc);
	}

	newAgent(agent: IAgent) {
		const rpc = this.#rpc;
		if (!rpc) return;

		const emit = (event: string, data: Record<string, unknown>) => {
			rpc.emit({
				type: "event",
				plugin: "web",
				agent_id: agent.id,
				event,
				data,
			});
		};

		agent.after("userMessage", async (e) => {
			const content =
			    e.msg.content.filter((c) => c.type === "text").map((c) => ({ type: "text" as const, text: c.text }));
			if (content.length === 0) return e;
			emit("userMessage", {
				item: {
					type: "message",
					role: e.msg[tameMsgMeta]?.automated ? "tame" : "user",
					content,
					key: `live-user-${Date.now()}`,
				},
			});
			return e;
		});

		agent.after("assistantMessage", async (e) => {
			const items = assistantBlocksToItems(e.msg.content, agent, e.msg[tameMsgMeta]?.automated === true);
			if (items.length === 0) return e;
			emit("assistantMessage", { items });
			return e;
		});

		agent.after("toolResult", async (e) => {
			emit("toolResult", {
				toolUseId: e.toolUse,
				result: e.result,
				isError: e.error,
			});
			return e;
		});

		agent.after("idle", async (e) => {
			emit("idle", { stopReason: e.stopReason });
			return e;
		});
	}
}
