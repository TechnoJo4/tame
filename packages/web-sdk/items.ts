/** A thread item — either a chat message or a tool call. */
export type ThreadItem = MessageItem | ToolCallItem;

export interface MessageItem {
	type: "message";
	role: "user" | "assistant";
	content: TextOrThinking[];
}

export type TextOrThinking =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string };

export interface ToolCallItem {
	type: "tool_call";
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}
