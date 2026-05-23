import type {
	RPCMessage,
	EventMessage,
	CallMessage,
	CallResultMessage,
	SubscriptionMessage,
	Stream,
} from "@tame/rpc-sdk";

/**
 * Registry that plugins augment via codegen to add typed RPC methods.
 * The key is the plugin name (or "@tame" for base routes).
 * Each method must have `input` and `output` shape for the conditional
 * types in call() to resolve.
 */
export interface RPCRegistry {
	"@tame": {
		newAgent: {
			input: { id?: string; system?: string };
			output: { id: string };
		};
		abort: {
			input: { id: string };
			output: Record<string, never>;
		};
		queueCompletion: {
			input: { id: string };
			output: Record<string, never>;
		};
		viewToolCall: {
			input: { agent_id: string; tool_use_id: string; view: string };
			output: unknown;
		};
	};
}

type SubscriptionCallback = (msg: EventMessage) => void;

interface SubscriptionEntry {
	filter: Omit<SubscriptionMessage, "type">;
	callback: SubscriptionCallback;
}

const nextId = (() => {
	let n = 0;
	return () => String(n++);
})();

export class RPCClient {
	#writer: WritableStreamDefaultWriter<RPCMessage>;
	#pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
	#subscriptions: SubscriptionEntry[] = [];
	#closed = false;

	constructor(stream: Stream) {
		this.#writer = stream.writable.getWriter();
		this.#readLoop(stream.readable);
	}

	/** Call an RPC method. Returns a promise that resolves with the result.
	 *  Without codegen, use string literals and `unknown` types.
	 *  With codegen, the RPCRegistry overload provides typed args/return. */
	call<P extends keyof RPCRegistry, M extends string & keyof RPCRegistry[P]>(
		plugin: P,
		method: M,
		args: RPCRegistry[P][M] extends { input: infer I } ? I : never,
	): Promise<RPCRegistry[P][M] extends { output: infer O } ? O : never>;
	call(plugin: string, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	call(plugin: string, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const id = nextId();
		const wirePlugin = plugin === "@tame" ? undefined : plugin;
		const msg: CallMessage = { type: "call", id, plugin: wirePlugin, call: method, args };

		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#send(msg).catch(reject);
		});
	}

	// ---- base route conveniences ----

	/** Create a new agent. */
	newAgent(opts?: { id?: string; system?: string }): Promise<{ id: string }> {
		return this.call("@tame", "newAgent", opts ?? {}) as Promise<{ id: string }>;
	}

	/** Abort an agent. */
	abort(id: string): Promise<void> {
		return this.call("@tame", "abort", { id }) as unknown as Promise<void>;
	}

	/** Queue a completion on an agent. */
	queueCompletion(id: string): Promise<void> {
		return this.call("@tame", "queueCompletion", { id }) as unknown as Promise<void>;
	}

	/** Resolve a tool call view. Returns the view result (tag + props, or undefined). */
	viewToolCall(agent_id: string, tool_use_id: string, view: string): Promise<unknown> {
		return this.call("@tame", "viewToolCall", { agent_id, tool_use_id, view });
	}

	// ---- subscriptions ----

	/** Subscribe to events matching the filter. Returns an unsubscribe function.
	 *  The server does coarse filtering; the client routes to matching callbacks. */
	subscribe(
		filter: { agent_id?: string; plugin?: string; event?: string },
		callback: SubscriptionCallback,
	): () => void {
		const entry: SubscriptionEntry = { filter: { ...filter }, callback };
		this.#subscriptions.push(entry);

		const msg: SubscriptionMessage = { type: "subscribe", ...filter };
		this.#send(msg).catch(() => {});

		return () => {
			const idx = this.#subscriptions.indexOf(entry);
			if (idx !== -1) this.#subscriptions.splice(idx, 1);

			const unsub: SubscriptionMessage = { type: "unsubscribe", ...filter };
			this.#send(unsub).catch(() => {});
		};
	}

	close() {
		this.#closed = true;
		try { this.#writer.close(); } catch { /* already closed */ }
		for (const { reject } of this.#pending.values()) {
			reject(new Error("RPC client closed"));
		}
		this.#pending.clear();
		this.#subscriptions = [];
	}

	async #readLoop(readable: ReadableStream<RPCMessage>) {
		try {
			const reader = readable.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				this.#dispatch(value);
			}
		} catch {
			// stream errored
		} finally {
			if (!this.#closed) this.close();
		}
	}

	#dispatch(msg: RPCMessage) {
		switch (msg.type) {
			case "result":
				this.#handleResult(msg);
				break;
			case "event":
				this.#handleEvent(msg);
				break;
			// client doesn't handle incoming calls or subscriptions
		}
	}

	#handleResult(msg: CallResultMessage) {
		const pending = this.#pending.get(msg.id);
		if (!pending) return;
		this.#pending.delete(msg.id);

		if (msg.error) {
			pending.reject(new Error(msg.error));
		} else {
			pending.resolve((msg.result ?? {}) as Record<string, unknown>);
		}
	}

	#handleEvent(msg: EventMessage) {
		for (const sub of this.#subscriptions) {
			if (this.#matchesFilter(msg, sub.filter)) {
				try { sub.callback(msg); } catch { /* don't let one callback break others */ }
			}
		}
	}

	#matchesFilter(msg: EventMessage, filter: SubscriptionEntry["filter"]): boolean {
		if (filter.agent_id !== undefined && msg.agent_id !== filter.agent_id) return false;
		if (filter.plugin !== undefined && msg.plugin !== filter.plugin) return false;
		if (filter.event !== undefined && msg.event !== filter.event) return false;
		return true;
	}

	async #send(msg: RPCMessage): Promise<void> {
		await this.#writer.write(msg);
	}
}
