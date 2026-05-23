import type { Plugin, IHarness } from "@tame/sdk";
import { Type } from "typebox";
import { call } from "@tame/rpc-sdk";
import { wsToStream } from "@tame/rpc-client/stream";
import type { RPCPlugin } from "@tame/plugin-rpc/index";

export interface ComponentDef {
	tag: string;
	src: string; // absolute filesystem path, mapped to /static/plugins/<plugin>/<basename>
}

export interface Placement {
	location: string;
	tag: string;
	props?: Record<string, unknown>;
}

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
	#staticDir: string;

	constructor(staticDir: string) {
		this.#staticDir = staticDir;
	}

	/** Resolve a component path relative to the calling plugin's directory. */
	resolve(dirname: string, relative: string): string {
		// join dirname + relative, normalizing as we go
		const parts = dirname.split("/");
		for (const seg of relative.split("/")) {
			if (seg === "..") parts.pop();
			else if (seg !== ".") parts.push(seg);
		}
		return parts.join("/");
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

		// TODO: config for hostname/port, read from tame config
		const hostname = "0.0.0.0";
		const port = 8080;

		Deno.serve({ hostname, port }, (request) => {
			const url = new URL(request.url);

			if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				const { socket, response } = Deno.upgradeWebSocket(request);
				const stream = wsToStream(socket);
				rpc.connect(stream);
				return response;
			}

			if (url.pathname.startsWith("/static/")) {
				return this.#serveStatic(url.pathname);
			}

			// SPA fallback — serve index.html for all other paths
			return this.#serveStatic("/static/index.html");
		});
	}

	#serveStatic(pathname: string): Response {
		// Check registered plugin components first
		for (const [, entry] of this.#components) {
			if (pathname === entry.url) {
				return this.#serveFile(entry.src, "application/javascript");
			}
		}

		// Fall back to the static directory
		const relative = pathname.replace(/^\/static\//, "");
		const filePath = `${this.#staticDir}/${relative}`;
		return this.#serveFile(filePath);
	}

	#serveFile(path: string, contentType?: string): Response {
		try {
			const content = Deno.readTextFileSync(path);
			const type = contentType ?? contentTypeFromExt(path);
			return new Response(content, {
				headers: { "content-type": type },
			});
		} catch {
			return new Response("not found", { status: 404 });
		}
	}
}

function contentTypeFromExt(path: string): string {
	const ext = path.split(".").pop();
	switch (ext) {
		case "html": return "text/html";
		case "js":   return "application/javascript";
		case "css":  return "text/css";
		case "json": return "application/json";
		case "svg":  return "image/svg+xml";
		default:     return "application/octet-stream";
	}
}
