import { Type, type Static } from "typebox";
import type { Plugin, IHarness } from "@tame/sdk";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import { wsToStream } from "@tame/rpc-client/stream";

export const configSchema = Type.Object({
	listen: Type.Object({
		hostname: Type.String(),
		port: Type.Number(),
	}),
});

export type Config = Static<typeof configSchema>;

export class RPCWSPlugin implements Plugin {
	id = "rpc-ws" as const;

	#config: Config;

	constructor(config: Config) {
		this.#config = config;
	}

	init(harness: IHarness) {
		const rpc = harness.getPlugin<RPCPlugin>("rpc");
		if (!rpc) throw new Error("rpc-ws requires the rpc plugin");

		Deno.serve({
			hostname: this.#config.listen.hostname,
			port: this.#config.listen.port,
		}, (request) => {
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
				return new Response("expected websocket", { status: 400 });
			}
			const { socket, response } = Deno.upgradeWebSocket(request);
			const stream = wsToStream(socket);
			rpc.connect(stream);
			return response;
		});
	}
}
