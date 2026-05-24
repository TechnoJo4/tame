import type { InferenceProvider, InputMessage, UserMessage, AssistantMessage, ToolUse, StopReason, MessageRequest, ToolResult } from "../llm/types.ts";
import type { AnyTool } from "./tool.ts";
import type { Plugin } from "./plugin.ts";
import type { Handler, Listener } from "../util/emitter.ts";

// ---- event types ----

export type AgentStopReason = StopReason | "aborted" | "error";

export interface UserMessageEvent {
	msg: UserMessage;
}

export interface AssistantMessageEvent {
	msg: AssistantMessage;
}

export interface ToolResultEvent {
	toolUse: string;
	error: boolean;
	result: string;
	resultMessageIdx: number;
}

export interface CompletionEvent {
	retriesLeft: number;
	req: MessageRequest;
}

export interface IdleEvent {
	stopReason: AgentStopReason;
}

export interface AgentEvents {
	userMessage: UserMessageEvent;
	assistantMessage: AssistantMessageEvent;
	toolResult: ToolResultEvent;
	completion: CompletionEvent;
	idle: IdleEvent;
}

// ---- IAgent ----

export interface IAgent {
	readonly id: string;
	llm: InferenceProvider;
	system: string;
	title?: string;
	context: InputMessage[];
	tools: Map<string, AnyTool>;
	pluginData: Map<symbol, unknown>;

	addTool(tool: AnyTool): void;
	viewToolCall(view: string, call: ToolUse, result?: ToolResult): unknown;
	queueCompletion(maxRetries?: number): void;

	// Emitter
	readonly signal: AbortSignal | undefined;
	readonly aborted: Promise<void>;
	abort(): void;
	fire<K extends keyof AgentEvents>(event: K, data: AgentEvents[K]): void;
	do<K extends keyof AgentEvents>(event: K, data: AgentEvents[K]): Promise<AgentEvents[K]>;
	before<K extends keyof AgentEvents>(event: K, f: Handler<AgentEvents, K>): void;
	after<K extends keyof AgentEvents>(event: K, f: Handler<AgentEvents, K>): void;
	once<K extends keyof AgentEvents>(event: K, f: Handler<AgentEvents, K>): void;
	waitFor<K extends keyof AgentEvents>(event: K): Promise<AgentEvents[K]>;
	listen(f: Listener<AgentEvents>): void;
}

// ---- IHarness ----

export interface IHarness {
	getPlugin<T extends Plugin>(id: T["id"]): T | undefined;
	addTools(...tools: AnyTool[]): void;
	addPlugins(...plugins: Plugin[]): void;
	newAgent(llm?: InferenceProvider, system?: string, id?: string): IAgent;
	getAgent(id: string): IAgent | undefined;
	listAgents(): { id: string; title?: string }[];
	cleanup(): void;
}
