import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameSidebar extends LitElement {
	@property({ type: Object }) controller!: RPCController;
	@property({ type: Boolean, reflect: true }) collapsed!: boolean;

	override createRenderRoot() { return this; }

	override render() {
		if (this.collapsed) return html``;
		return html`<tame-web-placement location="panel:sidebar" .controller=${this.controller}></tame-web-placement>`;
	}
}
customElements.define("tame-web-sidebar", TameSidebar);
