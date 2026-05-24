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
		// defer controller assignment until element is upgraded (import may still be in flight)
		customElements.whenDefined(p.tag).then(() => {
			el.controller = this.controller;
			if (p.props) Object.assign(el, p.props);
		});
		return el;
	}
}
customElements.define("tame-web-sidebar", TameSidebar);
