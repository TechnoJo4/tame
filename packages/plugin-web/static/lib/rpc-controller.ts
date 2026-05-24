import { RPCClient, wsToStream } from "@tame/rpc-client";
import type { ThreadItem, MessageItem, ToolCallItem, TextOrThinking, WebController, Placement } from "@tame/web-sdk";

interface ComponentEntry { src: string; }

interface Registry {
	components: Record<string, ComponentEntry>;
	placements: Placement[];
	stylesheets: Record<string, string>; // pluginId → url
}

// ---- thread item model ----
// types imported from @tame/web-sdk

// ---- backwards compat ----

export type { ThreadItem, MessageItem, ToolCallItem, TextOrThinking } from "@tame/web-sdk";

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
	idle: boolean;
	addController(c: RPCController): void;
	requestUpdate(): void;
}

export class RPCController implements WebController {
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
			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
			});
			const stream = wsToStream(ws);
			this.#client = new RPCClient(stream);

			const [registry, agent] = await Promise.all([
				this.#client.call("web", "getRegistry", {}),
				this.#client.newAgent(),
			]);

			this.registry = registry as unknown as Registry;
			this.agentId = agent.id;
			this.#host.loading = false;
			this.#injectStylesheets();
			this.#host.requestUpdate();
			this.#subscribeTo(this.agentId);
		} catch (e) {
			this.#host.error = e instanceof Error ? e.message : String(e);
			this.#host.loading = false;
			this.#host.requestUpdate();
		}
	}

	#subscribeTo(agentId: string) {
		if (!this.#client) return;

		const on = (event: string, handler: (data: Record<string, unknown>) => void) => {
			this.#unsubs.push(
				this.#client!.subscribe({ agent_id: agentId, event }, (msg) => {
					// only apply events for the currently-viewed agent
					if (msg.agent_id !== this.agentId) return;
					handler(msg.data as Record<string, unknown>);
				}),
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
			this.#host.items = [...this.#host.items];
			this.#host.requestUpdate();
		});
		on("idle", () => {
			this.#host.idle = true;
			this.#host.requestUpdate();
		});
	}

	#injectStylesheets() {
		if (!this.registry) return;
		for (const [, url] of Object.entries(this.registry.stylesheets)) {
			if (document.querySelector(`link[href="${url}"]`)) continue;
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = url;
			document.head.appendChild(link);
		}
	}

	/** Switch the displayed thread to a different agent. Keeps the old
	 *  agent's subscriptions alive (the agent stays in memory server-side). */
	async switchAgent(id: string) {
		if (!this.#client) return;
		if (id === this.agentId) return;

		// ensure agent is loaded into memory (no-op if already there)
		await this.#client.call("history", "load", { id });

		// fetch context and populate the thread
		const ctx = await this.#client.call("@tame", "getAgentContext", { id });
		this.agentId = id;
		this.#host.items = contextToItems(ctx.context as RawMessage[]);
		this.#host.requestUpdate();

		// subscribe to live events for this agent
		this.#subscribeTo(id);
	}

	/** Create a fresh agent and switch to it. */
	async newChat(system?: string) {
		if (!this.#client) return;
		const agent = await this.#client.newAgent({ system });
		await this.switchAgent(agent.id);
	}

	send(text: string) {
		if (!this.#client || !this.agentId) return;
		this.#host.idle = false;
		this.#host.requestUpdate();
		this.#client.emit(this.agentId, "userMessage", {
			msg: { role: "user", content: [{ type: "text", text }] },
		});
	}

	abort() {
		if (!this.#client || !this.agentId) return;
		this.#client.call("@tame", "abort", { id: this.agentId });
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

	/** Exposed for plugin components that need to call RPC methods directly. */
	get client(): RPCClient | null { return this.#client; }
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

interface RawMessage {
	role: string;
	content: RawBlock[];
}

function userItem(data: { msg: { content: RawBlock[] } }): MessageItem {
	const content: TextOrThinking[] = [];
	for (const c of data.msg.content) {
		if (c.type === "text") content.push({ type: "text", text: c.text! });
	}
	return { type: "message", role: "user", content };
}

function assistantItems(data: { msg: { content: RawBlock[] } }): ThreadItem[] {
	return rawBlocksToItems(data.msg.content);
}

function contextToItems(messages: RawMessage[]): ThreadItem[] {
	const items: ThreadItem[] = [];
	for (const msg of messages) {
		if (msg.role === "user") {
			for (const c of msg.content) {
				if (c.type === "text") {
					items.push({ type: "message", role: "user", content: [{ type: "text", text: c.text! }] });
				} else if (c.type === "tool_result") {
					// find matching tool_call and attach result
					for (let i = items.length - 1; i >= 0; i--) {
						const item = items[i];
						if (item.type === "tool_call" && item.id === (c as any).tool_use_id) {
							item.result = (c as any).content ?? (c as any).result;
							item.isError = !!(c as any).is_error;
							break;
						}
					}
				}
			}
		} else {
			items.push(...rawBlocksToItems(msg.content));
		}
	}
	return items;
}

function rawBlocksToItems(blocks: RawBlock[]): ThreadItem[] {
	const items: ThreadItem[] = [];
	const textBlocks: TextOrThinking[] = [];

	for (const c of blocks) {
		if (c.type === "tool_use") {
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
			// tool results for this call are already in the context, paired up below
		} else if (c.type === "tool_result") {
			// find the matching tool_call and attach the result
			for (let i = items.length - 1; i >= 0; i--) {
				const item = items[i];
				if (item.type === "tool_call" && item.id === (c as any).tool_use_id) {
					item.result = (c as any).content ?? (c as any).result;
					item.isError = !!(c as any).is_error;
					break;
				}
			}
		} else if (c.type === "text") {
			textBlocks.push({ type: "text", text: c.text! });
		} else if (c.type === "thinking") {
			textBlocks.push({ type: "thinking", thinking: c.thinking! });
		}
	}

	if (textBlocks.length > 0) {
		items.push({ type: "message", role: "assistant", content: [...textBlocks] });
	}

	return items;
}

function applyToolResult(items: ThreadItem[], data: { toolUse: string; error: boolean; result: string }) {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.type === "tool_call" && item.id === data.toolUse) {
			item.result = data.result;
			item.isError = data.error;
			return;
		}
	}
}
