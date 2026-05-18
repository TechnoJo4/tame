import { Type, Static, TSchema } from "typebox";
import { StringEnum } from "../../util/string-enum.ts";
import type { Agent } from "../../agent/agent.ts";
import type { Plugin } from "../../agent/plugin.ts";
import type { Emitter } from "../../util/emitter.ts";

const eventSchema = Type.Object({
    type: Type.Literal("event"),
    agent_id: Type.Optional(Type.String({ description: "The ID of the agent. Required for most events." })),
    plugin: Type.Optional(Type.String({ description: "The plugin this event is from. If undefined, it is a non-plugin event." })),
    event: Type.String({ description: "The event type name." }),
    data: Type.Object({}, { description: "The event data." })
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
    args: Type.Object({})
});

export type PluginCallMessage = Static<typeof pluginCallSchema>;

const pluginCallResultSchema = Type.Object({
    type: Type.Literal("result"),
    id: Type.String({ description: "The ID included in the call." }),
    error: Type.Optional(Type.String()),
    result: Type.Object({})
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

export class RPCPlugin implements Plugin {
    id = "rpc" as const;

    /** Listen to an emitter to automatically send events to subcribers. */
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
        // TODO
    }

    /** Register RPC routes for a plugin. */
    register(plugin: string, rpc: Record<string, CallDescription<any, any>>) {
        // TODO
    }

    connect(stream: Stream) {
        // TODO
    }
}
