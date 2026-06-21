import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import { agentIdContext, registryContext, type Registry } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import { settingsStoreContext } from "../lib/settings-context.ts";
import { LocalSettingsStore } from "../lib/settings-store.ts";
import { connectRPC } from "../lib/rpc-transport.ts";
import { send, abort } from "../lib/actions.ts";

export class TameShell extends LitElement {
	@property({ type: Boolean, state: true }) loading = true;
	@property({ type: String, state: true }) error: string | null = null;
	@property({ type: Boolean, state: true }) idle = true;
	@property({ type: Boolean, state: true }) sidebarCollapsed = false;
	@property({ type: Boolean, state: true }) settingsOpen = false;

	#settingsStore = new LocalSettingsStore();
	#settingsProvider: ContextProvider<typeof settingsStoreContext>;
	#agentProvider: ContextProvider<typeof agentIdContext>;
	#rpcProvider: ContextProvider<typeof rpcClientContext>;
	#registryProvider: ContextProvider<typeof registryContext>;

	#client: RPCClientLike | null = null;
	#agentId: string | null = null;
	#registry: Registry | null = null;
	#unsubs: (() => void)[] = [];

	constructor() {
		super();
		this.#settingsProvider = new ContextProvider(this, {
			context: settingsStoreContext,
			initialValue: this.#settingsStore,
		});
		this.#agentProvider = new ContextProvider(this, {
			context: agentIdContext,
			initialValue: null,
		});
		this.#rpcProvider = new ContextProvider(this, {
			context: rpcClientContext,
			initialValue: null,
		});
		this.#registryProvider = new ContextProvider(this, {
			context: registryContext,
			initialValue: null,
		});
	}

	override createRenderRoot() { return this; }

	override willUpdate(changed: Map<string, unknown>) {
		this.toggleAttribute("data-loading", this.loading);
		this.toggleAttribute("data-error", this.error !== null);
	}

	override connectedCallback() {
		super.connectedCallback();
		this.addEventListener("web:toggle-sidebar", () => {
			this.sidebarCollapsed = !this.sidebarCollapsed;
		});
		this.addEventListener("web:toggle-settings", () => {
			this.settingsOpen = !this.settingsOpen;
		});
		this.addEventListener("web:switch-agent", (e) => {
			const id = (e as CustomEvent).detail?.id;
			if (typeof id === "string" && id !== this.#agentId) {
				this.#setAgent(id);
			}
		});
		this.addEventListener("web:send", (e) => {
			const text = (e as CustomEvent).detail?.text;
			if (typeof text === "string" && this.#client && this.#agentId) {
				this.idle = false;
				send(this.#client, this.#agentId, text);
			}
		});
		this.addEventListener("web:abort", () => {
			if (this.#client && this.#agentId) {
				abort(this.#client, this.#agentId);
			}
		});
		this.#connect();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsubscribeAll();
	}

	async #connect() {
		const client = await connectRPC();
		if (!client) {
			this.error = "failed to connect";
			this.loading = false;
			return;
		}
		this.#client = client;
		this.#rpcProvider.setValue(client);

		// fetch registry (components, placements, stylesheets)
		try {
			const raw = await client.call("web", "getRegistry", {});
			const reg = raw as any;
			this.#registry = {
				placements: (reg.placements ?? []) as any[],
				getComponentSrc: (tag: string) => reg.components?.[tag]?.src,
			};
			this.#registryProvider.setValue(this.#registry);
			this.#injectStylesheets(reg.stylesheets as Record<string, string> | undefined);
		} catch (e) {
			this.error = `failed to load registry: ${e instanceof Error ? e.message : String(e)}`;
			this.loading = false;
			return;
		}

		// create initial agent
		try {
			const result = await client.call("@tame", "newAgent", {});
			this.#setAgent((result as any).id);
		} catch (e) {
			this.error = `failed to create agent: ${e instanceof Error ? e.message : String(e)}`;
			this.loading = false;
			return;
		}

		this.loading = false;
	}

	#setAgent(id: string) {
		const oldId = this.#agentId;
		this.#agentId = id;
		this.#agentProvider.setValue(id);
		this.idle = true;

		// re-subscribe to server events for the new agent
		this.#subscribeToAgent(id);
		this.requestUpdate();

		// request update from children after context flush
		requestAnimationFrame(() => this.requestUpdate());
	}

	#subscribeToAgent(agentId: string) {
		if (!this.#client) return;
		this.#unsubscribeAll();

		const on = (event: string, handler: (data: object) => void) => {
			this.#unsubs.push(
				this.#client!.subscribe(
					{ agent_id: agentId, plugin: "web", event },
					(msg) => handler(msg.data as Record<string, unknown>),
				),
			);
		};

		on("idle", () => {
			this.idle = true;
			this.requestUpdate();
		});
	}

	#unsubscribeAll() {
		for (const unsub of this.#unsubs) unsub();
		this.#unsubs = [];
	}

	#injectStylesheets(stylesheets: Record<string, string> | undefined) {
		if (!stylesheets) return;
		for (const url of Object.values(stylesheets)) {
			if (document.querySelector(`link[href="${url}"]`)) continue;
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = url;
			document.head.appendChild(link);
		}
	}

	override render() {
		if (this.loading) {
			return html`loading...`;
		}
		if (this.error) {
			return html`${this.error}`;
		}
		return html`
			<tame-web-sidebar .collapsed=${this.sidebarCollapsed}></tame-web-sidebar>
			<main>
				<tame-web-top-bar .sidebarCollapsed=${this.sidebarCollapsed}></tame-web-top-bar>
				<tame-web-thread></tame-web-thread>
				<tame-web-composer .idle=${this.idle}></tame-web-composer>
			</main>
			<tame-web-settings-modal .open=${this.settingsOpen}></tame-web-settings-modal>
		`;
	}
}
customElements.define("tame-web-shell", TameShell);
