import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	controller!: RPCController;

	createRenderRoot() { return this; }

	render() {
		return html`
			<div style="flex:1;overflow-y:auto;padding:16px">
				${this.controller.messages.map(
					(m, i) => html`<tame-message .controller=${this.controller} .message=${m} .index=${i}></tame-message>`,
				)}
			</div>
		`;
	}
}
customElements.define("tame-thread", TameThread);
