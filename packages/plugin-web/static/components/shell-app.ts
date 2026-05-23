import { LitElement, html } from "lit";
import { RPCController } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	controller = new RPCController(this);

	createRenderRoot() { return this; }

	render() {
		if (this.controller.loading) {
			return html`<div style="display:flex;align-items:center;justify-content:center;height:100%">loading...</div>`;
		}
		if (this.controller.error) {
			return html`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f66">${this.controller.error}</div>`;
		}
		return html`
			<div style="display:flex;height:100%">
				<tame-sidebar .controller=${this.controller}></tame-sidebar>
				<main style="flex:1;display:flex;flex-direction:column;min-width:0">
					<tame-thread .controller=${this.controller} .messages=${this.controller.messages} style="flex:1;overflow-y:auto"></tame-thread>
					<tame-composer .controller=${this.controller}></tame-composer>
				</main>
			</div>
		`;
	}
}
customElements.define("tame-shell", TameShell);
