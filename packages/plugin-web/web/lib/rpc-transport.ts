import { RPCClient } from "@tame/rpc-client";
import { wsToStream } from "@tame/rpc-client/stream";
import type { RPCClientLike } from "@tame/web-sdk/rpc-client-context";

/** Connect to the tame WebSocket backend and return an RPC client.
 *  Handles the WebSocket lifecycle — returns null on failure. */
export async function connectRPC(): Promise<RPCClient | null> {
	try {
		const secure = location.protocol.startsWith("https");
		const wsProtocol = secure ? "wss" : "ws";
		const ws = new WebSocket(`${wsProtocol}://${location.host}`);
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve(), { once: true });
			ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
		});
		const stream = wsToStream(ws);
		return new RPCClient(stream);
	} catch {
		return null;
	}
}

/** Re-export for convenience — plugin components can cast to this if they
 *  need the full RPCClient type, but should prefer RPCClientLike. */
export type { RPCClientLike };
