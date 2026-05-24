import { LitElement, html } from "lit";
import type { RPCController, ThreadItem } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	static properties = {
		items: { type: Array },
		controller: { type: Object },
	};

	declare items: ThreadItem[];
	declare controller: RPCController;

	#pinned = true;
	#scrollHandler: (() => void) | null = null;

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
			// defer until child elements finish rendering (markdown sets innerHTML)
			requestAnimationFrame(() => this.#scrollToBottom());
		}
	}

	#onScroll = () => {
		const threshold = 48; // px from bottom to consider "pinned"
		this.#pinned = this.scrollTop + this.clientHeight >= this.scrollHeight - threshold;
	};

	#scrollToBottom() {
		this.scrollTop = this.scrollHeight;
	}

	render() {
		return (this.items ?? []).map((item, i) => {
			if (item.type === "tool_call") {
				return html`<tame-tool-view
					.controller=${this.controller}
					.toolUseId=${item.id}
					.toolName=${item.name}
					.toolInput=${item.input}
					.result=${item.result ?? null}
					.isError=${item.isError ?? false}
				></tame-tool-view>`;
			}
			return html`<tame-message .item=${item} .controller=${this.controller}></tame-message>`;
		});
	}
}
customElements.define("tame-thread", TameThread);
