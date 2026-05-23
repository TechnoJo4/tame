import type { RPCMessage } from "./messages.ts";

export type Stream = {
	writable: WritableStream<RPCMessage>;
	readable: ReadableStream<RPCMessage>;
};
