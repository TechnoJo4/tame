import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameSidebar extends LitElement {
	static properties = { controller: { type: Object } };
	declare controller: RPCController;
	#loaded = new Set<string>();

	createRenderRoot() { return this; }

	render() {
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
		if (p.props) Object.assign(el, p.props);
		return el;
	}
}
customElements.define("tame-sidebar", TameSidebar);
