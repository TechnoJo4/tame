import { LitElement, html } from "lit";
import { RPCController, type ThreadItem } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	static properties = {
		items: { type: Array, state: true },
		loading: { type: Boolean, state: true },
		error: { type: String, state: true },
		sidebarCollapsed: { type: Boolean, state: true },
	};

	declare items: ThreadItem[];
	declare loading: boolean;
	declare error: string | null;
	declare sidebarCollapsed: boolean;

	#controller = new RPCController(this);

	constructor() {
		super();
		this.items = [];
		this.loading = true;
		this.error = null;
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
			<div class="layout" @tame:sidebar-toggle=${this.#toggleSidebar}>
				<tame-sidebar-toggle .collapsed=${this.sidebarCollapsed}></tame-sidebar-toggle>
				<tame-sidebar .controller=${this.#controller} .collapsed=${this.sidebarCollapsed}></tame-sidebar>
				<main class="main">
					<tame-thread .items=${this.items} .controller=${this.#controller}></tame-thread>
					<tame-composer .controller=${this.#controller}></tame-composer>
				</main>
			</div>
		`;
	}

	#toggleSidebar() {
		this.sidebarCollapsed = !this.sidebarCollapsed;
	}
}
customElements.define("tame-shell", TameShell);
