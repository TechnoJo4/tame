// Browser-compatible RPC client. Mirrors @tame/rpc-client but with
// zero server dependencies — no typebox, no @tame/sdk, no node: imports.

interface Stream {
	readable: ReadableStream<RPCMessage>;
	writable: WritableStream<RPCMessage>;
}

interface RPCMessage {
	type: string;
	id?: string;
	call?: string;
	plugin?: string;
	args?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: string;
	agent_id?: string;
	event?: string;
	data?: Record<string, unknown>;
}

type EventMessage = RPCMessage & { type: "event" };
type CallMessage = RPCMessage & { type: "call"; id: string };
type CallResultMessage = RPCMessage & { type: "result"; id: string };
type SubscriptionMessage = RPCMessage & { type: "subscribe" | "unsubscribe" };

export interface RPCRegistry {
	"@tame": {
		newAgent: { input: { id?: string; system?: string }; output: { id: string } };
		abort: { input: { id: string }; output: Record<string, never> };
		queueCompletion: { input: { id: string }; output: Record<string, never> };
		viewToolCall: { input: { agent_id: string; tool_use_id: string; view: string }; output: unknown };
	};
}

type SubscriptionCallback = (msg: EventMessage) => void;
type SubscriptionEntry = { filter: Partial<SubscriptionMessage>; callback: SubscriptionCallback };

const nextId = (() => { let n = 0; return () => String(n++); })();

export class RPCClient {
	#writer: WritableStreamDefaultWriter<RPCMessage>;
	#pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
	#subscriptions: SubscriptionEntry[] = [];
	#closed = false;

	constructor(stream: Stream) {
		this.#writer = stream.writable.getWriter();
		this.#readLoop(stream.readable);
	}

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

	newAgent(opts?: { id?: string; system?: string }): Promise<{ id: string }> {
		return this.call("@tame", "newAgent", opts ?? {}) as Promise<{ id: string }>;
	}

	abort(id: string): Promise<void> {
		return this.call("@tame", "abort", { id }) as unknown as Promise<void>;
	}

	queueCompletion(id: string): Promise<void> {
		return this.call("@tame", "queueCompletion", { id }) as unknown as Promise<void>;
	}

	viewToolCall(agent_id: string, tool_use_id: string, view: string): Promise<unknown> {
		return this.call("@tame", "viewToolCall", { agent_id, tool_use_id, view });
	}

	emit(agent_id: string | undefined, event: string, data: Record<string, unknown>, plugin?: string): void {
		const msg: EventMessage = { type: "event", agent_id, event, data, plugin };
		this.#send(msg).catch(() => {});
	}

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
			case "result": this.#handleResult(msg as CallResultMessage); break;
			case "event": this.#handleEvent(msg as EventMessage); break;
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

	#matchesFilter(msg: EventMessage, filter: Partial<SubscriptionMessage>): boolean {
		if (filter.agent_id !== undefined && msg.agent_id !== filter.agent_id) return false;
		if (filter.plugin !== undefined && msg.plugin !== filter.plugin) return false;
		if (filter.event !== undefined && msg.event !== filter.event) return false;
		return true;
	}

	async #send(msg: RPCMessage): Promise<void> {
		await this.#writer.write(msg);
	}
}
