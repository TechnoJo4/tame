import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { RPCController, type ThreadItem } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	@property({ type: Array, state: true }) items: ThreadItem[];
	@property({ type: Boolean, state: true }) loading: boolean;
	@property({ type: String, state: true }) error: string | null;
	@property({ type: Boolean, state: true }) idle: boolean;
	@property({ type: Boolean, state: true }) sidebarCollapsed: boolean;
	@property({ type: String, state: true }) sessionTitle: string;

	#controller = new RPCController(this);

	constructor() {
		super();
		this.items = [];
		this.loading = true;
		this.error = null;
		this.idle = true;
		this.sidebarCollapsed = false;
		this.sessionTitle = "tame";
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
			<div class="layout" @tame:sidebar-toggle=${this.#toggleSidebar}
				@tame:session-title=${this.#onSessionTitle}>
				<tame-sidebar .controller=${this.#controller} .collapsed=${this.sidebarCollapsed}></tame-sidebar>
				<div class="main-column">
					<div class="top-bar">
						<button class="top-bar-toggle" @click=${this.#toggleSidebar}
							title="${this.sidebarCollapsed ? "expand" : "collapse"} sidebar">☰</button>
						<span class="top-bar-title">${this.sessionTitle}</span>
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

	#onSessionTitle(e: CustomEvent) {
		this.sessionTitle = e.detail?.title || "tame";
	}
}
customElements.define("tame-shell", TameShell);
