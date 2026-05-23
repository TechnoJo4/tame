import { LitElement, html } from "lit";
import type { RPCController, ThreadItem } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	static properties = {
		items: { type: Array },
		controller: { type: Object },
	};

	declare items: ThreadItem[];
	declare controller: RPCController;

	createRenderRoot() { return this; }

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
