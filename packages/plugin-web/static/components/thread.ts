import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController, ThreadItem } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	@property({ type: Array }) items: ThreadItem[];
	@property({ type: Object }) controller: RPCController;

	#pinned = true;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.addEventListener("scroll", this.#onScroll);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.removeEventListener("scroll", this.#onScroll);
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("items") && this.#pinned) {
			requestAnimationFrame(() => this.#scrollToBottom());
		}
	}

	#onScroll = () => {
		const threshold = 48;
		this.#pinned = this.scrollTop + this.clientHeight >= this.scrollHeight - threshold;
	};

	#scrollToBottom() {
		this.scrollTop = this.scrollHeight;
	}

	render() {
		return (this.items ?? []).map((item, i) => {
			if (item.type === "tool_call") {
				return html`<tame-web-tool-view
					.controller=${this.controller}
					.toolUseId=${item.id}
					.toolName=${item.name}
					.toolInput=${item.input}
					.result=${item.result ?? null}
					.isError=${item.isError ?? false}
				></tame-web-tool-view>`;
			}
			return html`<tame-web-message .item=${item} .controller=${this.controller}></tame-web-message>`;
		});
	}
}
customElements.define("tame-web-thread", TameThread);
