import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameTopBar extends LitElement {
	@property({ type: Object }) controller!: RPCController;
	@property({ type: Boolean }) sidebarCollapsed!: boolean;

	#loaded = new Set<string>();

	override createRenderRoot() { return this; }

	#toggle() {
		this.dispatchEvent(new CustomEvent("toggle-sidebar", { bubbles: true, composed: true }));
	}

	override render() {
		return html`
			<div class="top-bar-left">
				<button class="top-bar-toggle" @click=${this.#toggle}
					title="${this.sidebarCollapsed ? "expand" : "collapse"} sidebar">☰</button>
				<tame-web-placement location="topbar:left" .controller=${this.controller}></tame-web-placement>
			</div>
			<div class="top-bar-center">
				<tame-web-placement location="topbar:center" .controller=${this.controller}></tame-web-placement>
			</div>
			<div class="top-bar-right">
				<tame-web-placement location="topbar:right" .controller=${this.controller}></tame-web-placement>
				<button class="top-bar-gear" @click=${this.#openSettings} title="settings">⚙</button>
			</div>
		`;
	}

	#openSettings() {
		this.dispatchEvent(new CustomEvent("toggle-settings", { bubbles: true, composed: true }));
	}
}
customElements.define("tame-web-top-bar", TameTopBar);
