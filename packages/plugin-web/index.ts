import type { Plugin, IHarness, IAgent } from "@tame/sdk";
import { Type } from "typebox";
import { call } from "@tame/rpc-sdk";
import { resolve } from "@std/path";
import { serve } from "./serve.ts";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import type { ComponentDef, Placement } from "@tame/web-sdk/placement";
import { basePlugins, terserPlugin } from "./build-config.ts";
import { contextToItems, assistantBlocksToItems, paginateItems } from "./items.ts";

export type { ComponentDef, Placement } from "@tame/web-sdk/placement";

export interface WebConfig {
	listen: { hostname: string; port: number };
	staticDir: string;
	buildShell: boolean;
}

export const configSchema = Type.Object({
	listen: Type.Optional(Type.Object({
		hostname: Type.Optional(Type.String()),
		port: Type.Optional(Type.Number()),
	})),
	staticDir: Type.Optional(Type.String()),
	buildShell: Type.Optional(Type.Boolean()),
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
	#rpc: RPCPlugin | undefined;
	#config: WebConfig;
	#buildDir: string;
	#rootDir: string;

	constructor(config: WebConfig) {
		this.#config = config;
		this.#buildDir = `${config.staticDir}/../.build`;
		this.#rootDir = resolve(config.staticDir, "../..");
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

	async #transpile(pluginId: string, files: { src: string; tag: string }[]): Promise<void> {
		const outDir = `${this.#buildDir}/plugins/${pluginId}`;
		try { Deno.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }

		const { rollup } = await import("rollup");

		for (const { src, tag } of files) {
			try {
				const build = await rollup({
					input: src,
					external: [/^lit/, /^@lit\//, /^@tame\/web-sdk/, /^typebox/, /^@tame\/agent-context/],
					plugins: basePlugins(this.#rootDir),
				});
				const basename = src.split("/").pop()!.replace(/\.ts$/, ".js");
				await build.write({
					file: `${outDir}/${basename}`,
					format: "esm",
					plugins: [terserPlugin],
				});
				await build.close();
				const url = `/static/plugins/${pluginId}/${basename}`;
				this.#components.set(tag, { src: `${outDir}/${basename}`, url });
			} catch (e) {
				console.warn(`plugin-web: rollup failed for ${tag} (${src}):`, e);
			}
		}
	}

	async #buildShell(): Promise<void> {
		const staticDir = this.#config.staticDir;
		const shellTs = `${staticDir}/shell.ts`;
		const shellJs = `${staticDir}/shell.js`;
		const litJs = `${staticDir}/lit.js`;
		const litContextJs = `${staticDir}/lit-context.js`;
		const agentContextJs = `${staticDir}/agent-context.js`;

		try {
			const { rollup } = await import("rollup");

			// if vendor bundles are missing (fresh clone), do a full build
			try { Deno.statSync(litJs); Deno.statSync(litContextJs); Deno.statSync(agentContextJs); } catch {
				await this.#buildVendorBundles(rollup, staticDir);
			}

			const build = await rollup({
				input: shellTs,
				external: ["lit", "lit/decorators.js", "lit/directive.js", "lit/async-directive.js", "@lit/context", "@tame/rpc-client", "@tame/agent-context", "typebox", "typebox/compile"],
				plugins: basePlugins(this.#rootDir),
			});
			await build.write({
				file: shellJs,
				format: "esm",
				plugins: [terserPlugin],
			});
			await build.close();
		} catch (e) {
			console.warn("plugin-web: shell rebuild failed, using existing shell.js:", e);
		}
	}

	async #buildVendorBundles(rollup: any, staticDir: string): Promise<void> {
		// write entry files, bundle, then clean up. mirrors build.js.
		const entry = (name: string, content: string) => {
			Deno.writeTextFileSync(`${this.#buildDir}/${name}.entry.ts`, content);
		};
		entry("lit", `export * from "lit";\nexport * from "lit/decorators.js";\nexport * from "lit/directive.js";\nexport * from "lit/async-directive.js";\n`);
		entry("typebox",
			`export * from "typebox";\nexport { default } from "typebox";\n` +
			`export { Compile, Code, Validator } from "typebox/compile";\n` +
			`export { default as compileDefault } from "typebox/compile";\n`);
		entry("tame-rpc-client",
			`export { RPCClient } from "@tame/rpc-client";\n` +
			`export { wsToStream } from "@tame/rpc-client/stream";\n`);
		entry("lit-context", `export { createContext, ContextProvider, ContextConsumer, ContextEvent, provide, consume } from "@lit/context";\n`);
		entry("agent-context", `export { agentIdContext } from "${staticDir}/lib/agent-context.ts";\n`);

		const bundle = async (name: string, externals: string[] = [], noMinify = false) => {
			const b = await rollup({
				input: `${this.#buildDir}/${name}.entry.ts`,
				external: externals,
				plugins: basePlugins(this.#rootDir),
			});
			await b.write({
				file: `${staticDir}/${name}.js`,
				format: "esm",
				plugins: (externals.length === 0 || noMinify) ? [] : [terserPlugin],
			});
			await b.close();
		};

		await bundle("lit");
		await bundle("typebox");
		await bundle("tame-rpc-client", ["typebox", "typebox/compile"]);
		await bundle("lit-context", ["lit"], true);
		await bundle("agent-context", ["lit", "@lit/context"]);

		// cleanup entry files
		for (const name of ["lit", "typebox", "tame-rpc-client", "lit-context", "agent-context"]) {
			try { Deno.removeSync(`${this.#buildDir}/${name}.entry.ts`); } catch { /* */ }
		}
	}

	async init(harness: IHarness) {
		this.#harness = harness;

		if (this.#config.buildShell) {
			await this.#buildShell();
		}

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
		await this.register("web", [
			{ tag: "tame-web-settings", src: this.resolve(dir, "./static/components/web-settings.ts") },
		], [
			{ location: "modal:settings", tag: "tame-web-settings", props: { pluginId: "web" } },
		]);

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
			const content = e.msg.content
				.filter((c) => c.type === "text")
				.map((c) => ({ type: "text" as const, text: c.text }));
			if (content.length === 0) return e;
			emit("userMessage", {
				item: {
					type: "message",
					role: "user",
					content,
					key: `live-user-${Date.now()}`,
				},
			});
			return e;
		});

		agent.after("assistantMessage", async (e) => {
			const items = assistantBlocksToItems(e.msg.content, agent);
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
