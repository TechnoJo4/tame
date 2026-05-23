import { Type, type Static } from "typebox";
import { StringEnum } from "@tame/sdk/util/string-enum";

export const eventSchema = Type.Object({
	type: Type.Literal("event"),
	agent_id: Type.Optional(Type.String({ description: "The ID of the agent. Required for most events." })),
	plugin: Type.Optional(Type.String({ description: "The plugin this event is from. If undefined, it is a non-plugin event." })),
	event: Type.String({ description: "The event type name." }),
	data: Type.Object({}, { additionalProperties: true, description: "The event data." })
});

export type EventMessage = Static<typeof eventSchema>;

export const subscriptionSchema = Type.Object({
	type: StringEnum(["subscribe", "unsubscribe"] as const),
	agent_id: Type.Optional(Type.String({ description: "The agent ID to subscribe to events for. If undefined, all agents." })),
	plugin: Type.Optional(Type.String({ description: "The plugin to subscribe to events for. If undefined, base tame non-plugin events." })),
	event: Type.Optional(Type.String({ description: "The events to subscribe to. If undefined, all events are subscribed to." }))
});

export type SubscriptionMessage = Static<typeof subscriptionSchema>;

export const callSchema = Type.Object({
	type: Type.Literal("call"),
	id: Type.String({ description: "An ID to return in the response." }),
	plugin: Type.Optional(Type.String({ description: "The plugin to call." })),
	call: Type.String({ description: "The name of the function to call." }),
	args: Type.Object({}, { additionalProperties: true })
});

export type CallMessage = Static<typeof callSchema>;

export const callResultSchema = Type.Object({
	type: Type.Literal("result"),
	id: Type.String({ description: "The ID included in the call." }),
	error: Type.Optional(Type.String()),
	result: Type.Optional(Type.Object({}, { additionalProperties: true }))
});

export type CallResultMessage = Static<typeof callResultSchema>;

export const rpcMsgSchema = Type.Union([ eventSchema, subscriptionSchema, callSchema, callResultSchema ]);

export type RPCMessage = Static<typeof rpcMsgSchema>;

export const messagesSchema = {
	agentEvent: eventSchema,
	subscriptionMessage: subscriptionSchema,
	callMessage: callSchema,
	callResultMessage: callResultSchema,
	rpcMessage: rpcMsgSchema
};
