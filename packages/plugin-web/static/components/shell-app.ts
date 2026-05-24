import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import { settingsStoreContext } from "../lib/settings-context.ts";
import { LocalSettingsStore } from "../lib/settings-store.ts";
import { agentIdContext } from "@tame/agent-context";
import { RPCController, type ThreadItem } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	@property({ type: Array, state: true }) items: ThreadItem[];
	@property({ type: Boolean, state: true }) loading: boolean;
	@property({ type: String, state: true }) error: string | null;
	@property({ type: Boolean, state: true }) idle: boolean;
	@property({ type: Boolean, state: true }) sidebarCollapsed: boolean;
	@property({ type: Boolean, state: true }) settingsOpen: boolean;
	@property({ type: String, state: true }) agentId: string | null = null;

	#settingsStore = new LocalSettingsStore();
	#settingsProvider: ContextProvider<typeof settingsStoreContext>;
	#agentProvider: ContextProvider<typeof agentIdContext>;

	#controller = new RPCController(this);

	constructor() {
		super();
		this.items = [];
		this.loading = true;
		this.error = null;
		this.idle = true;
		this.sidebarCollapsed = false;
		this.settingsOpen = false;
		this.#settingsProvider = new ContextProvider(this, {
			context: settingsStoreContext,
			initialValue: this.#settingsStore,
		});
		this.#agentProvider = new ContextProvider(this, {
			context: agentIdContext,
			initialValue: null,
		});
	}

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.addEventListener("toggle-sidebar", () => {
			this.sidebarCollapsed = !this.sidebarCollapsed;
		});
		this.addEventListener("toggle-settings", () => {
			this.settingsOpen = !this.settingsOpen;
		});
	}

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("agentId")) {
			this.#agentProvider.setValue(this.agentId);
		}
	}

	render() {
		if (this.loading) {
			return html`<div class="loading">loading...</div>`;
		}
		if (this.error) {
			return html`<div class="error">${this.error}</div>`;
		}
		return html`
			<div class="layout">
				<tame-web-sidebar .controller=${this.#controller} .collapsed=${this.sidebarCollapsed}></tame-web-sidebar>
				<div class="main-column">
					<tame-web-top-bar .controller=${this.#controller} .sidebarCollapsed=${this.sidebarCollapsed}></tame-web-top-bar>
					<main class="main">
						<tame-web-thread .items=${this.items} .controller=${this.#controller}></tame-web-thread>
						<tame-web-composer .controller=${this.#controller} .idle=${this.idle}></tame-web-composer>
					</main>
				</div>
				<tame-web-settings-modal .controller=${this.#controller} .open=${this.settingsOpen}></tame-web-settings-modal>
			</div>
		`;
	}
}
customElements.define("tame-web-shell", TameShell);
