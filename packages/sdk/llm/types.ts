import type { TSchema } from "typebox";
import type { tameMsgMeta, tameContentMeta } from "../util/symbols.ts";

// Total input tokens in a request is the summation of input_tokens, cache_creation_input_tokens, and cache_read_input_tokens.
export interface Usage {
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	input_tokens: number;
	output_tokens: number;
	service_tier: string;
}

export interface TameContentMeta {
	providerData?: object;
}

export interface Text {
	type: "text";
	text: string;
	[tameContentMeta]?: TameContentMeta;
}

export interface Thinking {
	type: "thinking";
	thinking: string;
	[tameContentMeta]?: TameContentMeta;
}

export interface RedactedThinking {
	type: "redacted_thinking";
	[tameContentMeta]?: TameContentMeta;
}

export interface ToolResult {
	type: "tool_result";
	is_error?: boolean;
	content: string;
	[tameContentMeta]?: TameContentMeta;
}

export interface ToolUse {
	type: "tool_use";
	id: string;
	input: Record<string, unknown>;
	name: string;
	result?: ToolResult;
	[tameContentMeta]?: TameContentMeta;
}

export type Content = Text | Thinking | RedactedThinking | ToolUse;
export type InputContent = Content;

export type StopReason =
	| "end_turn"
	| "max_tokens"
	| "stop_sequence"
	| "tool_use"
	| "pause_turn"
	| "refusal";

export interface TameMessageMeta {
	/** Whether this message was automatically inserted.  */
	automated?: true
	/** Keep this message during compaction. */
	noCompact?: true
	/** Skill associated with this message. */
	skill?: string
	/** Extraneous provider-specific data. */
	providerData?: object;
}

export interface UserMessage {
	role: "user";
	content: Content[];
	[tameMsgMeta]?: TameMessageMeta;
}

export interface AssistantMessage {
	role: "assistant";
	content: Content[];
	stop_reason: StopReason;
	model: string;
	usage: Usage;
	[tameMsgMeta]?: TameMessageMeta;
}

export type Message = UserMessage | AssistantMessage;

export interface InputMessage {
	role: "user" | "assistant";
	content: InputContent[];
	[tameMsgMeta]?: TameMessageMeta;
}

export interface ApiTool {
	name: string;
	description: string;
	input_schema: TSchema;
}

export interface MessageRequest {
	model?: string;
	max_tokens: number;
	system: string;
	tools?: ApiTool[];
	messages: InputMessage[];
	session_id?: string;
}

export interface InferenceProvider {
	defaultModel: string | undefined;
	complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage>;
}
