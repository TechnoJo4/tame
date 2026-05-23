// Browser WebSocket → Stream adapter. No server dependencies.

interface RPCMessage {
	type: string;
	[id: string]: unknown;
}

interface Stream {
	readable: ReadableStream<RPCMessage>;
	writable: WritableStream<RPCMessage>;
}

export function wsToStream(socket: WebSocket): Stream {
	const readable = new ReadableStream<RPCMessage>({
		start(controller) {
			socket.addEventListener("message", (event) => {
				try {
					const msg = JSON.parse(event.data as string) as RPCMessage;
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

	// Buffer writes until the socket opens, then flush.
	const pending: RPCMessage[] = [];
	let open = socket.readyState === WebSocket.OPEN;

	socket.addEventListener("open", () => {
		open = true;
		for (const msg of pending) socket.send(JSON.stringify(msg));
		pending.length = 0;
	});

	const writable = new WritableStream<RPCMessage>({
		write(msg) {
			if (open) {
				socket.send(JSON.stringify(msg));
			} else {
				pending.push(msg);
			}
		},
		close() {
			try { socket.close(); } catch { /* already closed */ }
		},
	});

	return { readable, writable };
}
