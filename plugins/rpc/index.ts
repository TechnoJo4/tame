import { Type, Static, TSchema } from "typebox";
import { Compile, Validator } from "typebox/compile";
import { StringEnum } from "../../util/string-enum.ts";
import { assertSchema } from "../../util/validate.ts";
import type { Agent } from "../../agent/agent.ts";
import type { Plugin } from "../../agent/plugin.ts";
import type { Emitter } from "../../util/emitter.ts";

const eventSchema = Type.Object({
	type: Type.Literal("event"),
	agent_id: Type.Optional(Type.String({ description: "The ID of the agent. Required for most events." })),
	plugin: Type.Optional(Type.String({ description: "The plugin this event is from. If undefined, it is a non-plugin event." })),
	event: Type.String({ description: "The event type name." }),
	data: Type.Object({}, { additionalProperties: true, description: "The event data." })
});

export type EventMessage = Static<typeof eventSchema>;

const subscriptionSchema = Type.Object({
	type: StringEnum(["subscribe", "unsubscribe"] as const),
	agent_id: Type.Optional(Type.String({ description: "The agent ID to subscribe to events for. If undefined, all agents." })),
	plugin: Type.Optional(Type.String({ description: "The plugin to subscribe to events for. If undefined, base tame non-plugin events." })),
	event: Type.Optional(Type.String({ description: "The events to subscribe to. If undefined, all events are subscribed to." }))
});

export type SubscriptionMessage = Static<typeof subscriptionSchema>;

const pluginCallSchema = Type.Object({
	type: Type.Literal("call"),
	id: Type.String({ description: "An ID to return in the response." }),
	plugin: Type.String({ description: "The plugin to call." }),
	call: Type.String({ description: "The name of the function to call." }),
	args: Type.Object({}, { additionalProperties: true })
});

export type PluginCallMessage = Static<typeof pluginCallSchema>;

const pluginCallResultSchema = Type.Object({
	type: Type.Literal("result"),
	id: Type.String({ description: "The ID included in the call." }),
	error: Type.Optional(Type.String()),
	result: Type.Optional(Type.Object({}, { additionalProperties: true }))
});

export type PluginCallResultMessage = Static<typeof pluginCallResultSchema>;

const rpcMsgSchema = Type.Union([ eventSchema, subscriptionSchema, pluginCallSchema, pluginCallResultSchema ]);

export type RPCMessage = Static<typeof rpcMsgSchema>;

export const schema = {
	agentEvent: eventSchema,
	subscriptionMessage: subscriptionSchema,
	rpcMessage: rpcMsgSchema,
	pluginCallMessage: pluginCallSchema,
	pluginCallResultMessage: pluginCallResultSchema
};

export interface CallDescription<I extends TSchema, O extends TSchema> {
	input: I;
	output: O;
	call: (args: Static<I>) => Promise<Static<O>>;
};

export type Stream = {
	writable: WritableStream<RPCMessage>;
	readable: ReadableStream<RPCMessage>;
};

interface Connection {
	stream: Stream;
	writer: WritableStreamDefaultWriter<RPCMessage>;
	subscriptions: SubscriptionMessage[];
}

const rpcMsgValidator = Compile(rpcMsgSchema);

export class RPCPlugin implements Plugin {
	id = "rpc" as const;

	#connections = new Set<Connection>();
	#rpc = new Map<string, Map<string, CallDescription<any, any>>>();
	#validators = new Map<CallDescription<any, any>, { input: Validator<any>; output: Validator<any> }>();

	/** Listen to an emitter to automatically send events to subscribers. */
	hookEmitter<T>(emitter: Emitter<T>, translate: (event: keyof T, data: T[typeof event]) => EventMessage) {
		emitter.listen((event, data) => this.emit(translate(event, data)));
	}

	newAgent(agent: Agent) {
		const agent_id = agent.id;
		this.hookEmitter(agent, (event, data) => ({
			type: "event", agent_id, event, data
		}));
	}

	/** Send an event to subscriber connections. */
	emit(msg: EventMessage) {
		for (const conn of this.#connections) {
			for (const sub of conn.subscriptions) {
				if (this.#matches(msg, sub)) {
					conn.writer.write(msg).catch(() => this.#drop(conn));
					break; // only send once per connection even if multiple subs match
				}
			}
		}
	}

	/** Register RPC routes for a plugin. */
	register(plugin: string, rpc: Record<string, CallDescription<any, any>>) {
		if (!this.#rpc.has(plugin))
			this.#rpc.set(plugin, new Map());
		const methods = this.#rpc.get(plugin)!;
		for (const [name, desc] of Object.entries(rpc)) {
			methods.set(name, desc);
			this.#validators.set(desc, {
				input: Compile(desc.input),
				output: Compile(desc.output)
			});
		}
	}

	/** Connect a bidirectional RPC stream. */
	connect(stream: Stream) {
		const writer = stream.writable.getWriter();
		const conn: Connection = { stream, writer, subscriptions: [] };
		this.#connections.add(conn);
		this.#readLoop(conn);
	}

	async #readLoop(conn: Connection) {
		try {
			const reader = conn.stream.readable.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				try {
					const msg = assertSchema(value, rpcMsgSchema, "invalid RPC message:", rpcMsgValidator);
					this.#handle(conn, msg);
				} catch {
					// skip malformed messages
				}
			}
		} catch {
			// stream errored or closed
		} finally {
			this.#drop(conn);
		}
	}

	#handle(conn: Connection, msg: RPCMessage) {
		switch (msg.type) {
			case "subscribe":
				conn.subscriptions.push(msg);
				break;
			case "unsubscribe":
				conn.subscriptions = conn.subscriptions.filter(s =>
					!(s.agent_id === msg.agent_id && s.plugin === msg.plugin && s.event === msg.event)
				);
				break;
			case "call":
				this.#handleCall(conn, msg);
				break;
		}
	}

	#handleCall(conn: Connection, msg: PluginCallMessage) {
		const methods = this.#rpc.get(msg.plugin);
		if (!methods) {
			this.#write(conn, { type: "result", id: msg.id, error: `plugin "${msg.plugin}" has no registered RPC methods` });
			return;
		}
		const method = methods.get(msg.call);
		if (!method) {
			this.#write(conn, { type: "result", id: msg.id, error: `no RPC method "${msg.call}" on plugin "${msg.plugin}"` });
			return;
		}

		const validators = this.#validators.get(method)!;
		let args: unknown;
		try {
			args = assertSchema(msg.args, method.input, `invalid args to ${msg.plugin}.${msg.call}:`, validators.input);
		} catch (e) {
			this.#write(conn, { type: "result", id: msg.id, error: e instanceof Error ? e.message : String(e) });
			return;
		}

		// fire off call in background so the read loop isn't blocked
		method.call(args).then(result => {
			try {
				const validated = assertSchema(result, method.output, `invalid result from ${msg.plugin}.${msg.call}:`, validators.output) as object;
				this.#write(conn, { type: "result", id: msg.id, result: validated });
			} catch (e) {
				this.#write(conn, { type: "result", id: msg.id, error: e instanceof Error ? e.message : String(e) });
			}
		}).catch(e => {
			this.#write(conn, { type: "result", id: msg.id, error: e instanceof Error ? e.message : String(e) });
		});
	}

	async #write(conn: Connection, msg: RPCMessage) {
		try {
			await conn.writer.write(msg);
		} catch {
			this.#drop(conn);
		}
	}

	#drop(conn: Connection) {
		this.#connections.delete(conn);
		try { conn.writer.releaseLock(); } catch { /* already released */ }
	}

	#matches(msg: EventMessage, sub: SubscriptionMessage): boolean {
		if (sub.plugin !== msg.plugin) return false;
		if (sub.agent_id !== undefined && sub.agent_id !== msg.agent_id) return false;
		if (sub.event !== undefined && sub.event !== msg.event) return false;
		return true;
	}
}
