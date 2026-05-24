import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { RPCController, type ThreadItem } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	@property({ type: Array, state: true }) items: ThreadItem[];
	@property({ type: Boolean, state: true }) loading: boolean;
	@property({ type: String, state: true }) error: string | null;
	@property({ type: Boolean, state: true }) idle: boolean;
	@property({ type: Boolean, state: true }) sidebarCollapsed: boolean;

	#controller = new RPCController(this);
	#loaded = new Set<string>();

	constructor() {
		super();
		this.items = [];
		this.loading = true;
		this.error = null;
		this.idle = true;
		this.sidebarCollapsed = false;
	}

	createRenderRoot() { return this; }

	render() {
		if (this.loading) {
			return html`<div class="loading">loading...</div>`;
		}
		if (this.error) {
			return html`<div class="error">${this.error}</div>`;
		}
		return html`
			<div class="layout">
				<tame-sidebar .controller=${this.#controller} .collapsed=${this.sidebarCollapsed}></tame-sidebar>
				<div class="main-column">
					<div class="top-bar">
						<div class="top-bar-left">
							<button class="top-bar-toggle" @click=${this.#toggleSidebar}
								title="${this.sidebarCollapsed ? "expand" : "collapse"} sidebar">☰</button>
							${this.#renderPlacements("topbar:left")}
						</div>
						<div class="top-bar-center">
							${this.#renderPlacements("topbar:center")}
						</div>
						<div class="top-bar-right">
							${this.#renderPlacements("topbar:right")}
						</div>
					</div>
					<main class="main">
						<tame-thread .items=${this.items} .controller=${this.#controller}></tame-thread>
						<tame-composer .controller=${this.#controller} .idle=${this.idle}></tame-composer>
					</main>
				</div>
			</div>
		`;
	}

	#toggleSidebar() {
		this.sidebarCollapsed = !this.sidebarCollapsed;
	}

	#renderPlacements(location: string) {
		const placements = this.#controller?.getPlacements(location) ?? [];
		return placements.map((p) => {
			const src = this.#controller.getComponentSrc(p.tag);
			if (src && !this.#loaded.has(p.tag)) {
				this.#loaded.add(p.tag);
				import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
			}
			const el = document.createElement(p.tag) as any;
			customElements.whenDefined(p.tag).then(() => {
				el.controller = this.#controller;
				if (p.props) Object.assign(el, p.props);
			});
			return el;
		});
	}
}
customElements.define("tame-shell", TameShell);
