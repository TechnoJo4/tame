import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameSidebar extends LitElement {
	controller!: RPCController;
	#loaded = new Set<string>();

	createRenderRoot() { return this; }

	render() {
		const placements = this.controller.getPlacements("panel:sidebar");
		return html`
			<aside style="width:260px;border-right:1px solid #333;overflow-y:auto;padding:8px;flex-shrink:0">
				${placements.map((p) => this.#renderPlacement(p))}
			</aside>
		`;
	}

	#renderPlacement(p: { tag: string; props?: Record<string, unknown> }) {
		const src = this.controller.getComponentSrc(p.tag);
		if (src && !this.#loaded.has(p.tag)) {
			this.#loaded.add(p.tag);
			import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
		}
		// create element with props — if not yet defined, customElements will upgrade when it is
		const el = document.createElement(p.tag) as any;
		if (p.props) Object.assign(el, p.props);
		return el;
	}
}
customElements.define("tame-sidebar", TameSidebar);
