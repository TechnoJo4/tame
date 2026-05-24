/** A thread item — either a chat message or a tool call. */
export type ThreadItem = MessageItem | ToolCallItem;

export interface MessageItem {
	type: "message";
	role: "user" | "assistant";
	content: TextOrThinking[];
	/** Stable key for virtual-list diffing. Set server-side during
	 *  context→items conversion. */
	key: string;
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
	/** Pre-resolved view metadata. When present, the client skips the
	 *  viewToolCall RPC and creates the component directly. */
	view?: { tag: string; props: Record<string, unknown> };
	/** Stable key for virtual-list diffing. Equals `id`. */
	key: string;
}
