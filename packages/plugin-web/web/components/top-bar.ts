import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

export class TameTopBar extends LitElement {
	@property({ type: Boolean }) sidebarCollapsed = false;

	override createRenderRoot() { return this; }

	#toggleSidebar() {
		this.dispatchEvent(new CustomEvent("web:toggle-sidebar", { bubbles: true, composed: true }));
	}

	#openSettings() {
		this.dispatchEvent(new CustomEvent("web:toggle-settings", { bubbles: true, composed: true }));
	}

	override render() {
		return html`
			<div class="top-bar-left">
				<button class="top-bar-toggle" @click=${this.#toggleSidebar}
					title="${this.sidebarCollapsed ? "expand" : "collapse"} sidebar">☰</button>
				<tame-web-placement location="topbar:left"></tame-web-placement>
			</div>
			<div class="top-bar-center">
				<tame-web-placement location="topbar:center"></tame-web-placement>
			</div>
			<div class="top-bar-right">
				<tame-web-placement location="topbar:right"></tame-web-placement>
				<button class="top-bar-gear" @click=${this.#openSettings} title="settings">⚙</button>
			</div>
		`;
	}
}
customElements.define("tame-web-top-bar", TameTopBar);
