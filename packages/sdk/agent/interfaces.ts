import type {Emitter} from "@tame/sdk";

import type {AssistantMessage, InferenceProvider, InputMessage, MessageRequest, StopReason, ToolUse, UserMessage} from "../llm/types.ts";

import type {Key} from "./key.ts";
import type {Plugin} from "./plugin.ts";
import type {AnyTool} from "./tool.ts";

// ---- event types ----

export type AgentStopReason = StopReason|"aborted"|"error";

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
	messageIdx: number;
	meta?: unknown;
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

export interface IAgent extends Emitter<AgentEvents> {
	readonly id: string;
	llm: InferenceProvider;
	system: string;
	title?: string;
	context: InputMessage[];
	tools: Map<string, AnyTool>;
	pluginData: Map<symbol, unknown>;

	setPluginData<T>(key: Key<T>, data: T): void;
	getPluginData<T>(key: Key<T>): T|undefined;

	addTool(tool: AnyTool): void;
	viewToolCall(view: string, call: ToolUse): unknown;
	queueCompletion(maxRetries?: number): void;
}

export interface NewAgentOptions {
	llm?: InferenceProvider;
	system?: string;
	id?: string;
	plugins?: string[];
}
;

export interface IHarness {
	getPlugin<T extends Plugin>(id: T["id"]): T|undefined;
	addTools(...tools: AnyTool[]): void;
	addPlugins(...plugins: Plugin[]): void;
	newAgent(opts?: NewAgentOptions): IAgent;
	getAgent(id: string): IAgent|undefined;
	listAgents(): { id: string; title?: string }[];
	cleanup(): void;
}
