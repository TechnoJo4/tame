import { RPCClient } from "@tame/rpc-client";
import { wsToStream } from "@tame/rpc-client/stream";
import type { ThreadItem, MessageItem, WebController, Placement } from "@tame/web-sdk";

interface ComponentEntry { src: string; }

interface Registry {
	components: Record<string, ComponentEntry>;
	placements: Placement[];
	stylesheets: Record<string, string>; // pluginId → url
}

export type { ThreadItem, MessageItem, ToolCallItem, TextOrThinking } from "@tame/web-sdk";

// ---- controller ----

interface TameShellHost {
	items: ThreadItem[];
	loading: boolean;
	error: string | null;
	idle: boolean;
	agentId: string | null;
	addController(c: RPCController): void;
	requestUpdate(): void;
	updateComplete: Promise<boolean>;
}

const PAGE_SIZE = 50;

export class RPCController implements WebController {
	#host: TameShellHost;
	#client: RPCClient | null = null;
	#unsubs: (() => void)[] = [];

	registry: Registry | null = null;
	agentId: string | null = null;

	/** How many items from the end we've loaded. Grows with pagination
	 *  and live events. Used as offset for the next getItems call. */
	#totalLoaded = 0;

	/** Total items in the agent context (from last getItems response). */
	#totalItems = 0;

	#loadingMore = false;

	constructor(host: TameShellHost) {
		this.#host = host;
		host.addController(this);
	}

	hostConnected() { this.#connect(); }

	hostDisconnected() {
		this.#client?.close();
		this.#unsubscribeAll();
	}

	async #connect() {
		try {
			const secure = location.protocol === "https";
			const wsProtocol = secure ? "wss" : "ws";
			const ws = new WebSocket(`${wsProtocol}://${location.host}`);
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
			this.#host.agentId = agent.id;
			this.#host.loading = false;
			this.#injectStylesheets();
			this.#host.requestUpdate();

			// load initial items
			await this.#loadItems(agent.id);
			this.#subscribeTo(agent.id);
		} catch (e) {
			this.#host.error = e instanceof Error ? e.message : String(e);
			this.#host.loading = false;
			this.#host.requestUpdate();
		}
	}

	#unsubscribeAll() {
		for (const unsub of this.#unsubs) unsub();
		this.#unsubs = [];
	}

	#subscribeTo(agentId: string) {
		if (!this.#client) return;
		this.#unsubscribeAll();

		const on = (event: string, handler: (data: object) => void) => {
			this.#unsubs.push(
				this.#client!.subscribe(
					{ agent_id: agentId, plugin: "web", event },
					(msg) => handler(msg.data as Record<string, unknown>),
				),
			);
		};

		on("userMessage", (d) => {
			const item = (d as any).item as MessageItem | undefined;
			if (!item) return;
			this.#host.items = [...this.#host.items, item];
			this.#totalLoaded++;
			this.#host.requestUpdate();
		});

		on("assistantMessage", (d) => {
			const items = (d as any).items as ThreadItem[] | undefined;
			if (!items || items.length === 0) return;
			this.#host.items = [...this.#host.items, ...items];
			this.#totalLoaded += items.length;
			this.#host.requestUpdate();
		});

		on("toolResult", (d) => {
			const { toolUseId, result, isError } = d as {
				toolUseId: string; result: string; isError: boolean;
			};
			applyToolResult(this.#host.items, toolUseId, result, isError);
			this.#host.items = [...this.#host.items];
			this.#host.requestUpdate();
		});

		on("idle", () => {
			this.#host.idle = true;
			this.#host.requestUpdate();
		});
	}

	async #loadItems(agentId: string, offset = 0): Promise<void> {
		if (!this.#client) return;
		const result = await this.#client.call("web", "getItems", {
			id: agentId, offset, limit: PAGE_SIZE,
		});
		const items = (result as any).items as ThreadItem[];
		const total = (result as any).total as number;
		this.#host.items = items;
		this.#totalLoaded = items.length;
		this.#totalItems = total;
		this.#host.requestUpdate();
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

	/** Switch the displayed thread to a different agent. */
	async switchAgent(id: string) {
		if (!this.#client) return;
		if (id === this.agentId) return;

		const oldId = this.agentId;
		this.agentId = id;
		this.#host.agentId = id;

		try {
			await this.#loadItems(id);
		} catch {
			// rollback on failure — don't leave agentId pointing at an unloaded agent
			this.agentId = oldId;
			this.#host.agentId = oldId;
			return;
		}
		this.#subscribeTo(id);
		await this.#host.updateComplete;
	}

	/** Load more history (older items). Called when scrolling near the top.
	 *  Returns true if more items were loaded. */
	async loadMore(): Promise<boolean> {
		if (!this.#client || !this.agentId) return false;
		if (this.#totalLoaded >= this.#totalItems) return false;
		if (this.#loadingMore) return false;

		this.#loadingMore = true;
		try {
			const result = await this.#client.call("web", "getItems", {
				id: this.agentId,
				offset: this.#totalLoaded,
				limit: PAGE_SIZE,
			});
			const items = (result as any).items as ThreadItem[];
			if (items.length === 0) return false;

			// prepend older items
			this.#host.items = [...items, ...this.#host.items];
			this.#totalLoaded += items.length;
			this.#host.requestUpdate();
			return true;
		} finally {
			this.#loadingMore = false;
		}
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

// ---- tool result application ----

function applyToolResult(
	items: ThreadItem[],
	toolUseId: string,
	result: string,
	isError: boolean,
) {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.type === "tool_call" && item.id === toolUseId) {
			item.result = result;
			item.isError = isError;
			return;
		}
	}
}
