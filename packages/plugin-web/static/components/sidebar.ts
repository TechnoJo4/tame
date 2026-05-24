import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameSidebar extends LitElement {
	@property({ type: Object }) controller: RPCController;
	@property({ type: Boolean, reflect: true }) collapsed: boolean;

	#loaded = new Set<string>();

	createRenderRoot() { return this; }

	render() {
		if (this.collapsed) return html``;
		const placements = this.controller?.getPlacements("panel:sidebar") ?? [];
		return html`${placements.map((p) => this.#renderPlacement(p))}`;
	}

	#renderPlacement(p: { tag: string; props?: Record<string, unknown> }) {
		const src = this.controller.getComponentSrc(p.tag);
		if (src && !this.#loaded.has(p.tag)) {
			this.#loaded.add(p.tag);
			import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
		}
		const el = document.createElement(p.tag) as any;
		el.controller = this.controller;
		if (p.props) Object.assign(el, p.props);
		return el;
	}
}
customElements.define("tame-sidebar", TameSidebar);

// ---- toggle button (sibling to sidebar in the layout) ----

export class TameSidebarToggle extends LitElement {
	@property({ type: Boolean }) collapsed: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`<button class="toggle" @click=${this.#fire} title="${this.collapsed ? "expand" : "collapse"} sidebar">☰</button>`;
	}

	#fire() {
		this.dispatchEvent(new CustomEvent("tame:sidebar-toggle", { bubbles: true, composed: true }));
	}
}
customElements.define("tame-sidebar-toggle", TameSidebarToggle);
