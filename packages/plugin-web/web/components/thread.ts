import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import "@lit-labs/virtualizer";
import type { LitVirtualizer } from "@lit-labs/virtualizer";
import { RangeChangedEvent } from "@lit-labs/virtualizer/events.js";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import type { ThreadItem, ToolCallItem, MessageItem } from "@tame/web-sdk";

const PAGE_SIZE = 50;

export class TameThread extends LitElement {
	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) declare agentId: string | null;

	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) declare client: RPCClientLike | null;

	@property({ type: Array, state: true }) items: ThreadItem[] = [];
	@property({ type: Boolean, state: true }) loading = true;
	@property({ type: String, state: true }) error: string | null = null;

	#virtualizer: LitVirtualizer | null = null;
	#pinned = true;
	#layout: Record<string, unknown> = {};
	#loadingMore = false;
	#totalLoaded = 0;
	#totalItems = 0;
	#unsubs: (() => void)[] = [];
	#lastAgentId: string | null = null;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#virtualizer?.removeEventListener("scroll", this.#onScroll);
		this.#unsubscribeAll();
	}

	override willUpdate(changed: Map<string, unknown>) {
		// agentId or client changed → reload if both are present and agentId is new
		if ((changed.has("agentId") || changed.has("client"))
			&& this.client && this.agentId
			&& this.agentId !== this.#lastAgentId
		) {
			this.#lastAgentId = this.agentId;
			this.#loadInitial();
		}
		this.toggleAttribute("data-loading", this.loading);
		this.toggleAttribute("data-error", this.error !== null);

		// when items change and we're pinned, pre-set the pin to the
		// new last item so the virtualizer renders at the bottom
		// immediately — no rAF flash.  when unpinned, ensure #layout
		// carries no pin so a stale pin isn't re-applied.
		if (changed.has("items")) {
			if (this.#pinned && this.items.length > 0) {
				this.#layout = { pin: { index: this.items.length - 1, block: "end" } };
			} else if (!this.#pinned && this.#layoutHasPin()) {
				this.#layout = {};
			}
		}
	}

	#layoutHasPin(): boolean {
		const p = this.#layout as Record<string, unknown>;
		return typeof p?.pin === "object" && p.pin !== null;
	}

	override firstUpdated() {
		this.#virtualizer = this.querySelector("lit-virtualizer") as LitVirtualizer;
		this.#virtualizer?.addEventListener("scroll", this.#onScroll, { passive: true });
	}

	override updated(_changed: Map<string, unknown>) {
		// pinning is handled in willUpdate() to avoid the rAF flash.
		// the virtualizer applies the pin synchronously during render.
	}

	#pinToBottom() {
		const len = this.items.length;
		if (len === 0) return;
		this.#layout = { pin: { index: len - 1, block: "end" } };
	}

	#onScroll = () => {
		const el = this.#virtualizer;
		if (!el) return;
		const threshold = 48;
		const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
		if (atBottom && !this.#pinned) {
			this.#pinned = true;
			this.#pinToBottom();
		} else if (!atBottom && this.#pinned) {
			this.#pinned = false;
		}
	};

	#onUnpinned = () => {
		// backup: the virtualizer's internal pin was cleared (e.g. user
		// scrolled).  the scroll handler above also detects this, but
		// the virtualizer may fire unpinned before the scroll event
		// reaches us.
		if (this.#pinned) {
			this.#pinned = false;
			this.#layout = {};
		}
	};

	#onRangeChanged = (e: RangeChangedEvent) => {
		if (e.first <= 3 && !this.#loadingMore) {
			this.#loadMore();
		}
	};

	#unsubscribeAll() {
		for (const unsub of this.#unsubs) unsub();
		this.#unsubs = [];
	}

	#subscribeToAgent() {
		if (!this.client || !this.agentId) return;
		this.#unsubscribeAll();

		const on = (event: string, handler: (data: any) => void) => {
			this.#unsubs.push(
				this.client!.subscribe(
					{ agent_id: this.agentId!, plugin: "web", event },
					(msg) => handler((msg.data as Record<string, unknown>)),
				),
			);
		};

		on("userMessage", (d) => {
			const item = d.item as MessageItem | undefined;
			if (!item) return;
			this.items = [...this.items, item];
			this.#totalLoaded++;
		});

		on("assistantMessage", (d) => {
			const items = d.items as ThreadItem[] | undefined;
			if (!items || items.length === 0) return;
			this.items = [...this.items, ...items];
			this.#totalLoaded += items.length;
		});

		on("toolResult", (d) => {
			const { toolUseId, result, isError } = d as {
				toolUseId: string; result: string; isError: boolean;
			};
			for (let i = this.items.length - 1; i >= 0; i--) {
				const item = this.items[i];
				if (item.type === "tool_call" && item.id === toolUseId) {
					item.result = result;
					item.isError = isError;
					break;
				}
			}
			this.items = [...this.items];
		});
	}

	async #loadInitial() {
		if (!this.client || !this.agentId) return;
		this.loading = true;
		this.error = null;
		this.#subscribeToAgent();
		try {
			const result = await this.client.call("web", "getItems", {
				id: this.agentId, offset: 0, limit: PAGE_SIZE,
			});
			const r = result as any;
			this.items = (r.items ?? []) as ThreadItem[];
			this.#totalLoaded = this.items.length;
			this.#totalItems = r.total as number;
			this.#pinned = true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	async #loadMore() {
		if (!this.client || !this.agentId) return;
		if (this.#totalLoaded >= this.#totalItems || this.#loadingMore) return;
		this.#loadingMore = true;
		try {
			const result = await this.client.call("web", "getItems", {
				id: this.agentId, offset: this.#totalLoaded, limit: PAGE_SIZE,
			});
			const r = result as any;
			const older = (r.items ?? []) as ThreadItem[];
			if (older.length === 0) return;
			this.items = [...older, ...this.items];
			this.#totalLoaded += older.length;
		} finally {
			this.#loadingMore = false;
		}
	}

	#renderItem = (item: ThreadItem) => {
		if (item.type === "tool_call") {
			const ti = item as ToolCallItem;
			return html`<tame-web-tool-view
				.toolUseId=${ti.id}
				.toolName=${ti.name}
				.toolInput=${ti.input}
				.result=${ti.result ?? null}
				.isError=${ti.isError ?? false}
				.view=${ti.view ?? null}
			></tame-web-tool-view>`;
		}
		const mi = item as MessageItem;
		return html`<tame-web-message .item=${mi}></tame-web-message>`;
	};

	#keyFunction = (item: ThreadItem) => item.key;

	override render() {
		if (this.loading) {
			return html`loading thread...`;
		}
		if (this.error) {
			return html`${this.error}`;
		}
		return html`<lit-virtualizer
			scroller
			.items=${this.items}
			.renderItem=${this.#renderItem}
			.keyFunction=${this.#keyFunction}
			.layout=${this.#layout}
			@unpinned=${this.#onUnpinned}
			@rangeChanged=${this.#onRangeChanged}
		></lit-virtualizer>`;
	}
}
customElements.define("tame-web-thread", TameThread);
