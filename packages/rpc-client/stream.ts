import { messagesSchema, type RPCMessage, type Stream } from "@tame/rpc-sdk";
import { Compile } from "typebox/compile";
import { assertSchema } from "@tame/sdk/util/validate";

const rpcMsgValidator = Compile(messagesSchema.rpcMessage);

/** Wrap a WebSocket in a Stream adapter. Validates incoming messages
 *  against rpcMsgSchema; malformed messages are silently dropped. */
export function wsToStream(socket: WebSocket): Stream {
	const readable = new ReadableStream<RPCMessage>({
		start(controller) {
			socket.addEventListener("message", (event) => {
				try {
					const data = JSON.parse(event.data as string);
					const msg = assertSchema(data, messagesSchema.rpcMessage, "invalid RPC message:", rpcMsgValidator);
					controller.enqueue(msg);
				} catch {
					// skip malformed messages
				}
			});
			socket.addEventListener("close", () => {
				try { controller.close(); } catch { /* already closed */ }
			});
			socket.addEventListener("error", () => {
				controller.error(new Error("WebSocket error"));
			});
		},
		cancel() {
			try { socket.close(); } catch { /* already closed */ }
		},
	});

	const writable = new WritableStream<RPCMessage>({
		write(msg) {
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify(msg));
		},
		close() {
			try { socket.close(); } catch { /* already closed */ }
		},
	});

	return { readable, writable };
}
