import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameTopBar extends LitElement {
	@property({ type: Object }) controller: RPCController;
	@property({ type: Boolean }) sidebarCollapsed: boolean;

	#loaded = new Set<string>();

	createRenderRoot() { return this; }

	#toggle() {
		this.dispatchEvent(new CustomEvent("toggle-sidebar", { bubbles: true, composed: true }));
	}

	#renderPlacements(location: string) {
		const placements = this.controller?.getPlacements(location) ?? [];
		return placements.map((p) => {
			const src = this.controller.getComponentSrc(p.tag);
			if (src && !this.#loaded.has(p.tag)) {
				this.#loaded.add(p.tag);
				import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
			}
			const el = document.createElement(p.tag) as any;
			customElements.whenDefined(p.tag).then(() => {
				el.controller = this.controller;
				el.agentId = this.controller.agentId;
				if (p.props) Object.assign(el, p.props);
			});
			return el;
		});
	}

	render() {
		return html`
			<div class="top-bar-left">
				<button class="top-bar-toggle" @click=${this.#toggle}
					title="${this.sidebarCollapsed ? "expand" : "collapse"} sidebar">☰</button>
				${this.#renderPlacements("topbar:left")}
			</div>
			<div class="top-bar-center">
				${this.#renderPlacements("topbar:center")}
			</div>
			<div class="top-bar-right">
				${this.#renderPlacements("topbar:right")}
			</div>
		`;
	}
}
customElements.define("tame-web-top-bar", TameTopBar);
