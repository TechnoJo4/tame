import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import "@lit-labs/virtualizer";
import type { LitVirtualizer } from "@lit-labs/virtualizer";
import { RangeChangedEvent, UnpinnedEvent } from "@lit-labs/virtualizer/events.js";
import type { RPCController, ThreadItem, ToolCallItem, MessageItem } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	@property({ type: Array }) items!: ThreadItem[];
	@property({ type: Object }) controller!: RPCController;

	#virtualizer: LitVirtualizer | null = null;

	#pinned = true;
	#layout: Record<string, unknown> = {};
	#loadingMore = false;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#virtualizer?.removeEventListener("scroll", this.#onScroll);
	}

	override firstUpdated() {
		// query the virtualizer manually — decorator on private field breaks swc
		this.#virtualizer = this.querySelector("lit-virtualizer") as LitVirtualizer;
		this.#virtualizer?.addEventListener("scroll", this.#onScroll, { passive: true });
	}

	override updated(changed: Map<string, unknown>) {
		if (changed.has("items") && this.#pinned) {
			// defer until after the virtualizer lays out new items
			requestAnimationFrame(() => this.#pinToBottom());
		}
	}

	#pinToBottom() {
		const len = this.items?.length ?? 0;
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
		}
	};

	#onUnpinned = () => {
		this.#pinned = false;
	};

	#onRangeChanged = (e: RangeChangedEvent) => {
		// load more history when scrolling near the top
		if (e.first <= 3 && !this.#loadingMore) {
			this.#loadMore();
		}
	};

	async #loadMore() {
		this.#loadingMore = true;
		try {
			await this.controller?.loadMore();
		} finally {
			this.#loadingMore = false;
		}
	}

	#renderItem = (item: ThreadItem) => {
		if (item.type === "tool_call") {
			const ti = item as ToolCallItem;
			return html`<tame-web-tool-view
				.controller=${this.controller}
				.toolUseId=${ti.id}
				.toolName=${ti.name}
				.toolInput=${ti.input}
				.result=${ti.result ?? null}
				.isError=${ti.isError ?? false}
				.view=${ti.view ?? null}
			></tame-web-tool-view>`;
		}
		const mi = item as MessageItem;
		return html`<tame-web-message .item=${mi} .controller=${this.controller}></tame-web-message>`;
	};

	#keyFunction = (item: ThreadItem) => item.key;

	override render() {
		return html`<lit-virtualizer
			scroller
			.items=${this.items ?? []}
			.renderItem=${this.#renderItem}
			.keyFunction=${this.#keyFunction}
			.layout=${this.#layout}
			@unpinned=${this.#onUnpinned}
			@rangeChanged=${this.#onRangeChanged}
		></lit-virtualizer>`;
	}
}
customElements.define("tame-web-thread", TameThread);
