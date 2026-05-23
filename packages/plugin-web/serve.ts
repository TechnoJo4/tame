import { wsToStream } from "@tame/rpc-client/stream";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import type { WebConfig } from "./index.ts";

interface RegistryEntry {
	src: string; // filesystem path
	url: string; // served URL
}

export function serve(
	config: WebConfig,
	components: Map<string, RegistryEntry>,
	stylesheets: Map<string, string>,
	rpc: RPCPlugin,
): void {
	Deno.serve({ hostname: config.listen.hostname, port: config.listen.port }, (request) => {
		const url = new URL(request.url);

		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const { socket, response } = Deno.upgradeWebSocket(request);
			const stream = wsToStream(socket);
			rpc.connect(stream);
			return response;
		}

		if (url.pathname.startsWith("/static/")) {
			return serveStatic(url.pathname, config.staticDir, components, stylesheets);
		}

		// SPA fallback — serve index.html for all other paths
		return serveStatic("/static/index.html", config.staticDir, components, stylesheets);
	});
}

function serveStatic(
	pathname: string,
	staticDir: string,
	components: Map<string, RegistryEntry>,
	stylesheets: Map<string, string>,
): Response {
	// Check registered plugin components first
	for (const [, entry] of components) {
		if (pathname === entry.url) {
			return serveFile(entry.src, "application/javascript");
		}
	}

	// Check registered stylesheets
	for (const [, url] of stylesheets) {
		if (pathname === url) {
			// stylesheet paths are under .build/plugins/<id>/<file>.css
			const filePath = url.replace(/^\/static\//, `${staticDir}/../.build/`);
			return serveFile(filePath, "text/css");
		}
	}

	// Fall back to the static directory
	const relative = pathname.replace(/^\/static\//, "");
	const filePath = `${staticDir}/${relative}`;
	return serveFile(filePath);
}

function serveFile(path: string, contentType?: string): Response {
	try {
		const content = Deno.readTextFileSync(path);
		const type = contentType ?? contentTypeFromExt(path);
		return new Response(content, { headers: { "content-type": type } });
	} catch {
		return new Response("not found", { status: 404 });
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
