import { Type, Static } from "typebox";
import { Compile } from "typebox/compile";
import { Plugin } from "../../agent/plugin.ts";
import type { Harness } from "../../agent/harness.ts";
import { RPCPlugin, RPCMessage, Stream, schema } from "../rpc/index.ts";
import { assertSchema } from "../../util/validate.ts";

export const configSchema = Type.Object({
	listen: Type.Object({
		hostname: Type.String(),
		port: Type.Number(),
	}),
});

export type Config = Static<typeof configSchema>;

const rpcMsgValidator = Compile(schema.rpcMessage);

/** Wrap a WebSocket in a Stream adapter. Validates incoming messages
 * are RPCMessages; invalid messages are silently dropped. */
export function wsToStream(socket: WebSocket): Stream {
	const readable = new ReadableStream<RPCMessage>({
		start(controller) {
			socket.addEventListener("message", (event) => {
				try {
					const data = JSON.parse(event.data);
					const msg = assertSchema(data, schema.rpcMessage, "invalid RPC message:", rpcMsgValidator);
					controller.enqueue(msg);
				} catch {
					// skip malformed messages
				}
			});
			socket.addEventListener("close", () => {
				controller.close();
			});
			socket.addEventListener("error", () => {
				controller.error(new Error("WebSocket error"));
			});
		},
		cancel() {
			socket.close();
		},
	});

	const writable = new WritableStream<RPCMessage>({
		write(msg) {
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify(msg));
		},
		close() {
			socket.close();
		},
	});

	return { readable, writable };
}

export class RPCWSPlugin implements Plugin {
	id = "rpc-ws" as const;

	#config: Config;

	constructor(config: Config) {
		this.#config = config;
	}

	init(harness: Harness) {
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
