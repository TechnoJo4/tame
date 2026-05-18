import { Type, Static, TSchema } from "typebox";
import { Compile, Validator } from "typebox/compile";
import { StringEnum } from "../../util/string-enum.ts";
import { assertSchema } from "../../util/validate.ts";
import type { Agent } from "../../agent/agent.ts";
import type { Plugin } from "../../agent/plugin.ts";
import type { Emitter } from "../../util/emitter.ts";
import type { Harness } from "../../agent/harness.ts";

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

const callSchema = Type.Object({
	type: Type.Literal("call"),
	id: Type.String({ description: "An ID to return in the response." }),
	plugin: Type.Optional(Type.String({ description: "The plugin to call." })),
	call: Type.String({ description: "The name of the function to call." }),
	args: Type.Object({}, { additionalProperties: true })
});

export type CallMessage = Static<typeof callSchema>;

const callResultSchema = Type.Object({
	type: Type.Literal("result"),
	id: Type.String({ description: "The ID included in the call." }),
	error: Type.Optional(Type.String()),
	result: Type.Optional(Type.Object({}, { additionalProperties: true }))
});

export type CallResultMessage = Static<typeof callResultSchema>;

const rpcMsgSchema = Type.Union([ eventSchema, subscriptionSchema, callSchema, callResultSchema ]);

export type RPCMessage = Static<typeof rpcMsgSchema>;

export const messagesSchema = {
	agentEvent: eventSchema,
	subscriptionMessage: subscriptionSchema,
	callMessage: callSchema,
	callResultMessage: callResultSchema,
	rpcMessage: rpcMsgSchema
};

export interface CallDescription<I extends TSchema, O extends TSchema> {
	input: I;
	output: O;
	call: (args: Static<I>) => Promise<Static<O>>;
};

export const call = <I extends TSchema, O extends TSchema>(c: CallDescription<I, O>): CallDescription<I, O> => c;

export const baseRouteSchemas = {
	newAgent: {
		input: Type.Object({
			id: Type.Optional(Type.String()),
			system: Type.Optional(Type.String()),
		}),
		output: Type.Object({
			id: Type.String()
		})
	}
};

export type Stream = {
	writable: WritableStream<RPCMessage>;
	readable: ReadableStream<RPCMessage>;
};

interface Subscription {
	all_agents: boolean;
	agents: Set<string>;
}

interface Subscriptions {
	all_events: Subscription;
	events: Record<string, Subscription>;
}

interface Connection {
	stream: Stream;
	writer: WritableStreamDefaultWriter<RPCMessage>;
	subscriptions: {
		base: Subscriptions;
		plugins: Record<string, Subscriptions>;
	};
}

const emptySubscription = (): Subscription => ({ all_agents: false, agents: new Set() });
const emptySubscriptions = (): Subscriptions => ({ all_events: emptySubscription(), events: {} });

const rpcMsgValidator = Compile(rpcMsgSchema);

export class RPCPlugin implements Plugin {
	id = "rpc" as const;

	#connections = new Set<Connection>();
	#baseRoutes = new Map<string, CallDescription<any, any>>();
	#rpc = new Map<string, Map<string, CallDescription<any, any>>>();
	#validators = new Map<CallDescription<any, any>, { input: Validator<any>; output: Validator<any> }>();
	#harness?: Harness;

	init(harness: Harness) {
		this.#harness = harness;
		this.#baseRoutes.set("newAgent", call({
			...baseRouteSchemas.newAgent,
			call: async ({ id, system }) => {
				const agent = harness.newAgent(undefined, system, id);
				return { id: agent.id };
			}
		}));
	}

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
			if (this.#matches(msg, conn.subscriptions)) {
				conn.writer.write(msg).catch(() => this.#drop(conn));
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
		const conn: Connection = { stream, writer, subscriptions: { base: emptySubscriptions(), plugins: {} } };
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
				this.#subscribe(conn, msg);
				break;
			case "unsubscribe":
				this.#unsubscribe(conn, msg);
				break;
			case "call":
				this.#handleCall(conn, msg);
				break;
			case "event":
				this.#handleEvent(msg);
				break;
		}
	}

	#subscribe(conn: Connection, msg: SubscriptionMessage) {
		const bucket = this.#getOrCreateBucket(conn.subscriptions, msg.plugin);
		const sub = this.#getOrCreateSubscription(bucket, msg.event);
		if (msg.agent_id === undefined) {
			sub.all_agents = true;
		} else {
			sub.agents.add(msg.agent_id);
		}
	}

	#unsubscribe(conn: Connection, msg: SubscriptionMessage) {
        const subs = msg.plugin === undefined
            ? conn.subscriptions.base
            : conn.subscriptions.plugins[msg.plugin];
        if (subs) this.#unsubscribeTarget(msg, subs);
	}

    #unsubscribeTarget(msg: SubscriptionMessage, subs: Subscriptions) {
        if (msg.agent_id === undefined) {
            if (msg.event === undefined) {
                subs.all_events = emptySubscription();
            } else {
                delete subs.events[msg.event];
            }
        } else {
            this.#removeAgent(subs, msg.agent_id, msg.event);
        }
    }

	#removeAgent(subs: Subscriptions, agent_id: string, event?: string) {
		if (event === undefined) {
			subs.all_events.agents.delete(agent_id);
		} else {
			subs.events[event]?.agents?.delete(agent_id);
		}
	}

	#handleEvent(msg: EventMessage) {
		const harness = this.#harness;
		if (!harness) return;
		if (!msg.agent_id) return;
		if (msg.plugin !== undefined) return; // only agent events for now
		const agent = harness.getAgent(msg.agent_id);
		if (!agent) return;
		agent.fire(msg.event as never, msg.data as never);
	}

	#handleCall(conn: Connection, msg: CallMessage) {
		const methods = msg.plugin ? this.#rpc.get(msg.plugin) : this.#baseRoutes;
		const source = msg.plugin ? `plugin "${msg.plugin}"` : "tame";
		if (!methods) {
			this.#write(conn, { type: "result", id: msg.id, error: `${source} has no registered RPC methods` });
			return;
		}
		const method = methods.get(msg.call);
		const call = `method "${msg.call}"`;
		if (!method) {
			this.#write(conn, { type: "result", id: msg.id, error: `no RPC ${call} on ${source}` });
			return;
		}

		const validators = this.#validators.get(method)!;
		let args: unknown;
		try {
			args = assertSchema(msg.args, method.input, `invalid args to ${source} ${call}:`, validators.input);
		} catch (e) {
			this.#write(conn, { type: "result", id: msg.id, error: e instanceof Error ? e.message : String(e) });
			return;
		}

		// fire off call in background so the read loop isn't blocked
		method.call(args).then(result => {
			try {
				const validated = assertSchema(result, method.output, `invalid result from ${source} ${call}:`, validators.output) as object;
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

	#matches(msg: EventMessage, subs: Connection["subscriptions"]): boolean {
		if (msg.agent_id === undefined) return false;
		const bucket = msg.plugin ? subs.plugins[msg.plugin] : subs.base;
		if (!bucket) return false;
		if (this.#subMatchesAgent(bucket.all_events, msg.agent_id)) return true;
		const eventSub = bucket.events[msg.event];
		return eventSub ? this.#subMatchesAgent(eventSub, msg.agent_id) : false;
	}

	#subMatchesAgent(sub: Subscription, agent_id: string): boolean {
		return sub.all_agents || sub.agents.has(agent_id);
	}

	#getOrCreateBucket(subs: Connection["subscriptions"], plugin?: string): Subscriptions {
		if (plugin === undefined) return subs.base;
		if (!subs.plugins[plugin]) subs.plugins[plugin] = emptySubscriptions();
		return subs.plugins[plugin];
	}

	#getOrCreateSubscription(bucket: Subscriptions, event?: string): Subscription {
		if (event === undefined) return bucket.all_events;
		if (!bucket.events[event]) bucket.events[event] = emptySubscription();
		return bucket.events[event];
	}
}
