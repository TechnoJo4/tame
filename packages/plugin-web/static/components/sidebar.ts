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
		// use lit template so lit can reuse the DOM element across renders
		// instead of destroying/recreating it each time
		return html`<${p.tag}
			.controller=${this.controller}
			.agentId=${this.controller.agentId}
		></${p.tag}>`;
	}
}
customElements.define("tame-web-sidebar", TameSidebar);
