import { LitElement, html } from "lit";
import { property, query } from "lit/decorators.js";
import type { LitVirtualizer } from "@lit-labs/virtualizer";
import { RangeChangedEvent, UnpinnedEvent } from "@lit-labs/virtualizer/events.js";
import type { RPCController, ThreadItem, ToolCallItem, MessageItem } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	@property({ type: Array }) items: ThreadItem[];
	@property({ type: Object }) controller: RPCController;

	@query("lit-virtualizer") #virtualizer!: LitVirtualizer;

	#pinned = true;
	#layout: Record<string, unknown> = {};

	createRenderRoot() { return this; }

	updated(changed: Map<string, unknown>) {
		if (changed.has("items") && this.#pinned) {
			this.#pinToBottom();
		}
	}

	#pinToBottom() {
		const len = this.items?.length ?? 0;
		if (len === 0) return;
		this.#layout = { pin: { index: len - 1, block: "end" } };
	}

	#onUnpinned = () => {
		this.#pinned = false;
	};

	#onRangeChanged = (e: RangeChangedEvent) => {
		// if the last item is visible, consider us pinned
		const len = this.items?.length ?? 0;
		if (len > 0 && e.last >= len - 1) {
			this.#pinned = true;
		}
		// load more when scrolling near the top
		if (e.first <= 3) {
			this.controller?.loadMore();
		}
	};

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

	render() {
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
