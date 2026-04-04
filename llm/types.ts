import { TSchema } from "@sinclair/typebox";

export interface CacheControl {
	type: "ephemeral";
	ttl: "5m" | "1h";
}

// Total input tokens in a request is the summation of input_tokens, cache_creation_input_tokens, and cache_read_input_tokens.
export interface Usage {
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	input_tokens: number;
	output_tokens: number;
	service_tier: string;
}

export interface Text {
	type: "text";
	text: string;
}

export interface Thinking {
	type: "thinking";
	thinking: string;
	signature?: string;
}

export interface RedactedThinking {
	type: "redacted_thinking";
	data: string;
}

export interface ToolUse {
	type: "tool_use";
	id: string;
	input: object;
	name: string;
}

export interface ToolResult {
	type: "tool_result";
	tool_use_id: string;
	is_error?: boolean;
	content: string;
}

export type Content = Text | Thinking | RedactedThinking | ToolUse | ToolResult;
export type InputContent = Content & { cache_control?: CacheControl };

export type StopReason =
	| "end_turn"
	| "max_tokens"
	| "stop_sequence"
	| "tool_use"
	| "pause_turn"
	| "refusal"
	| "aborted";

export interface UserMessage {
	role: "user";
	content: Content[];
}

export interface AssistantMessage {
	role: "assistant";
	content: Content[];
	stop_reason: StopReason;
	model: string;
	usage: Usage;
}

export type Message = UserMessage | AssistantMessage;

export interface InputMessage {
	role: "user" | "assistant";
	content: InputContent[];
}

export interface Tool {
	name: string;
	description: string;
	input_schema: TSchema;
};

export interface MessageRequest {
	model?: string;
	max_tokens?: number;
	system: string;
	tools?: Tool[];
	messages: InputMessage[];
	cache_control?: CacheControl;
}

export interface InferenceProvider {
	complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage>;
}
