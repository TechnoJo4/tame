import { LitElement, html } from "lit";
import { cache } from "lit/directives/cache.js";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameSidebar extends LitElement {
	@property({ type: Object }) controller!: RPCController;
	@property({ type: Boolean, reflect: true }) collapsed!: boolean;

	override createRenderRoot() { return this; }

	override render() {
		return html`${cache(this.collapsed
			? html``
			: html`<tame-web-placement location="panel:sidebar" .controller=${this.controller}></tame-web-placement>`)}`;
	}
}
customElements.define("tame-web-sidebar", TameSidebar);
