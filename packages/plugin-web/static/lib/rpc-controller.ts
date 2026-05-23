import { RPCClient } from "./rpc-client.ts";
import { wsToStream } from "./stream.ts";

interface ComponentEntry { src: string; }

interface Registry {
	components: Record<string, ComponentEntry>;
	placements: Placement[];
}

interface Placement {
	location: string;
	tag: string;
	props?: Record<string, unknown>;
}

// ---- thread item model ----

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

// ---- for backwards compat with tame-tool-view ----

export interface Message {
	role: "user" | "assistant";
	content: ContentBlock[];
}

export type ContentBlock =
	| TextOrThinking
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

// ---- controller ----

interface TameShellHost {
	items: ThreadItem[];
	loading: boolean;
	error: string | null;
	addController(c: RPCController): void;
	requestUpdate(): void;
}

export class RPCController {
	#host: TameShellHost;
	#client: RPCClient | null = null;
	#unsubs: (() => void)[] = [];

	registry: Registry | null = null;
	agentId: string | null = null;

	constructor(host: TameShellHost) {
		this.#host = host;
		host.addController(this);
	}

	hostConnected() { this.#connect(); }

	hostDisconnected() {
		this.#client?.close();
		for (const unsub of this.#unsubs) unsub();
	}

	async #connect() {
		try {
			const ws = new WebSocket(`ws://${location.host}`);
			const stream = wsToStream(ws);
			this.#client = new RPCClient(stream);

			const [registry, agent] = await Promise.all([
				this.#client.call("web", "getRegistry", {}),
				this.#client.newAgent(),
			]);

			this.registry = registry as unknown as Registry;
			this.agentId = agent.id;
			this.#host.loading = false;
			this.#host.requestUpdate();
			this.#subscribe();
		} catch (e) {
			this.#host.error = e instanceof Error ? e.message : String(e);
			this.#host.loading = false;
			this.#host.requestUpdate();
		}
	}

	#subscribe() {
		if (!this.#client || !this.agentId) return;

		const on = (event: string, handler: (data: Record<string, unknown>) => void) => {
			this.#unsubs.push(
				this.#client.subscribe({ agent_id: this.agentId, event }, (msg) =>
					handler(msg.data as Record<string, unknown>),
				),
			);
		};

		on("userMessage", (d) => {
			this.#host.items = [...this.#host.items, userItem(d)];
			this.#host.requestUpdate();
		});
		on("assistantMessage", (d) => {
			this.#host.items = [...this.#host.items, ...assistantItems(d)];
			this.#host.requestUpdate();
		});
		on("toolResult", (d) => {
			applyToolResult(this.#host.items, d);
			this.#host.requestUpdate();
		});
	}

	send(text: string) {
		if (!this.#client || !this.agentId) return;
		this.#client.emit(this.agentId, "userMessage", {
			msg: { role: "user", content: [{ type: "text", text }] },
		});
	}

	async viewToolCall(toolUseId: string): Promise<{ tag: string; props: Record<string, unknown> } | null> {
		if (!this.#client || !this.agentId) return null;
		try {
			const result = await this.#client.viewToolCall(this.agentId, toolUseId, "web");
			if (!result || typeof result !== "object" || !("tag" in result)) return null;
			return result as { tag: string; props: Record<string, unknown> };
		} catch {
			return null;
		}
	}

	getPlacements(location: string): Placement[] {
		if (!this.registry) return [];
		return this.registry.placements.filter((p) => p.location === location);
	}

	getComponentSrc(tag: string): string | undefined {
		return this.registry?.components[tag]?.src;
	}
}

// ---- event → item constructors ----

interface RawBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
}

function userItem(data: { msg: { content: RawBlock[] } }): MessageItem {
	const content: TextOrThinking[] = [];
	for (const c of data.msg.content) {
		if (c.type === "text") content.push({ type: "text", text: c.text! });
	}
	return { type: "message", role: "user", content };
}

function assistantItems(data: { msg: { content: RawBlock[] } }): ThreadItem[] {
	const items: ThreadItem[] = [];
	const textBlocks: TextOrThinking[] = [];

	for (const c of data.msg.content) {
		if (c.type === "tool_use") {
			// flush pending text blocks as a message
			if (textBlocks.length > 0) {
				items.push({ type: "message", role: "assistant", content: [...textBlocks] });
				textBlocks.length = 0;
			}
			items.push({
				type: "tool_call",
				id: c.id!,
				name: c.name!,
				input: c.input!,
			});
		} else if (c.type === "text") {
			textBlocks.push({ type: "text", text: c.text! });
		} else if (c.type === "thinking") {
			textBlocks.push({ type: "thinking", thinking: c.thinking! });
		}
	}

	// trailing text blocks
	if (textBlocks.length > 0) {
		items.push({ type: "message", role: "assistant", content: [...textBlocks] });
	}

	return items;
}

function applyToolResult(items: ThreadItem[], data: { toolUse: string; error: boolean; result: string }) {
	// walk backwards to find the matching tool_call (most recent first)
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.type === "tool_call" && item.id === data.toolUse) {
			item.result = data.result;
			item.isError = data.error;
			return;
		}
	}
}
