import {assertEquals} from "@std/assert";
import {type IAgent, type InputMessage, tameMsgMeta} from "@tame/sdk";

import {assistantBlocksToItems, contextToItems, messageRole,} from "./items.ts";

const agent = (context: InputMessage[]): IAgent => ({
	context,
	viewToolCall: () => undefined,
} as unknown as IAgent);

Deno.test("automated context messages become tame web messages", () => {
	const context: InputMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: "human" }],
		},
		{
			role: "user",
			content: [{ type: "text", text: "injected" }],
			[tameMsgMeta]: { automated: true },
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "reply" }],
		},
	];

	assertEquals(contextToItems(agent(context)), [
		{
			type: "message",
			role: "user",
			content: [{ type: "text", text: "human" }],
			key: "msg-0",
		},
		{
			type: "message",
			role: "tame",
			content: [{ type: "text", text: "injected" }],
			key: "msg-1",
		},
		{
			type: "message",
			role: "assistant",
			content: [{ type: "text", text: "reply" }],
			key: "msg-2",
		},
	]);
});

Deno.test("live automated messages become tame without metadata serialization", () => {
	const context: InputMessage[] = [];
	const items = assistantBlocksToItems(
	    [{ type: "text", text: "summary" }],
	    agent(context),
	    true,
	);

	assertEquals(items[0], {
		type: "message",
		role: "tame",
		content: [{ type: "text", text: "summary" }],
		key: "msg-live-t",
	});
	assertEquals(
	    messageRole({
		    role: "user",
		    content: [],
		    [tameMsgMeta]: { automated: true },
	    }),
	    "tame",
	);
});

Deno.test("automated assistant tool calls retain tame visibility metadata", () => {
	const items = contextToItems(agent([{
		role: "assistant",
		content: [
			{ type: "text", text: "using a tool" },
			{
				type: "tool_use",
				id: "call-1",
				name: "read",
				input: { path: "x" },
			},
			{ type: "text", text: "tool complete" },
		],
		[tameMsgMeta]: { automated: true },
	}]));

	assertEquals(items.map((item) => item.role), ["tame", "tame", "tame"]);
	assertEquals(items.map((item) => item.key), ["msg-0", "call-1", "msg-0-1"]);
});
