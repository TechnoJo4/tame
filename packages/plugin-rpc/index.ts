import { Compile, type Validator } from "typebox/compile";
import { assertSchema, type IAgent, type IHarness, type Plugin, type ToolUse, type ToolResult } from "@tame/sdk";
import {
	type eventSchema,
	rpcMsgSchema,
	call,
	baseRouteSchemas,
	type EventMessage,
	type SubscriptionMessage,
	type CallMessage,
	type RPCMessage,
	type Stream,
	type CallDescription,
} from "@tame/rpc-sdk";

export {
	eventSchema,
	subscriptionSchema,
	callSchema,
	callResultSchema,
	rpcMsgSchema,
	messagesSchema,
	type EventMessage,
	type SubscriptionMessage,
	type CallMessage,
	type CallResultMessage,
	type RPCMessage,
	type Stream,
	type CallDescription,
	call,
	baseRouteSchemas,
} from "@tame/rpc-sdk";

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
	#harness?: IHarness;

	init(harness: IHarness) {
		this.#harness = harness;
		this.#registerOn(this.#baseRoutes, {
			newAgent: call({
				...baseRouteSchemas.newAgent,
				call: async ({ id, system }) => {
					const agent = harness.newAgent(undefined, system, id);
					return { id: agent.id };
				}
			}),
			abort: call({
				...baseRouteSchemas.abort,
				call: async ({ id }) => {
					const agent = harness.getAgent(id);
					if (!agent) throw new Error(`agent ${id} not found`);
					agent.abort();
					return {};
				}
			}),
			queueCompletion: call({
				...baseRouteSchemas.queueCompletion,
				call: async ({ id }) => {
					const agent = harness.getAgent(id);
					if (!agent) throw new Error(`agent ${id} not found`);
					agent.queueCompletion();
					return {};
				}
			}),
			viewToolCall: call({
				...baseRouteSchemas.viewToolCall,
				call: async ({ agent_id, tool_use_id, view }) => {
					const agent = harness.getAgent(agent_id);
					if (!agent) throw new Error(`agent ${agent_id} not found`);

					let call: ToolUse | undefined;
					for (const m of agent.context) {
						for (const c of m.content) {
							if (c.type === "tool_use" && c.id === tool_use_id) {
								call = c;
								break;
							}
						}
						if (call) break;
					}
					if (!call) throw new Error(`tool_use ${tool_use_id} not found`);

					let result: ToolResult | undefined;
					for (const m of agent.context) {
						for (const c of m.content) {
							if (c.type === "tool_result" && c.tool_use_id === tool_use_id) {
								result = c;
								break;
							}
						}
						if (result) break;
					}

					return agent.viewToolCall(view, call, result);
				}
			}),
			listAgents: call({
				...baseRouteSchemas.listAgents,
				call: async () => {
					const agents = harness.listAgents();
					return { agents };
				}
			}),
			getAgentContext: call({
				...baseRouteSchemas.getAgentContext,
				call: async ({ id }) => {
					const agent = harness.getAgent(id);
					if (!agent) throw new Error(`agent ${id} not found`);
					return {
						id: agent.id,
						system: agent.system,
						title: agent.title,
						context: agent.context as Record<string, unknown>[],
					};
				}
			}),
		});
	}

	/** Listen to an emitter to automatically send events to subscribers. */
	hookEmitter<T>(emitter: { listen(f: (type: keyof T, data: T[typeof type]) => void): void }, translate: (event: keyof T, data: T[typeof event]) => EventMessage) {
		emitter.listen((event, data) => this.emit(translate(event, data)));
	}

	newAgent(agent: IAgent) {
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
		this.#registerOn(this.#rpc.get(plugin)!, rpc);
	}

	#registerOn(map: Map<string, CallDescription<any, any>>, rpc: Record<string, CallDescription<any, any>>) {
		for (const [name, desc] of Object.entries(rpc)) {
			map.set(name, desc);
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
		if (msg.plugin !== undefined) return;
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
		const bucket = msg.plugin ? subs.plugins[msg.plugin] : subs.base;
		if (!bucket) return false;
		if (this.#subMatchesAgent(bucket.all_events, msg.agent_id)) return true;
		const eventSub = bucket.events[msg.event];
		return eventSub ? this.#subMatchesAgent(eventSub, msg.agent_id) : false;
	}

	#subMatchesAgent(sub: Subscription, agent_id: string | undefined): boolean {
		return sub.all_agents || (agent_id !== undefined && sub.agents.has(agent_id));
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
