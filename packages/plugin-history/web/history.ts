import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import type { SessionInfo } from "./types.ts";

export class TameHistory extends LitElement {
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) declare client: RPCClientLike | null;

	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) declare agentId: string | null;

	@property({ type: Array, state: true }) sessions: SessionInfo[] = [];
	@property({ type: Boolean, state: true }) loading = true;

	#unsub: (() => void) | null = null;
	#lastClient: RPCClientLike | null = null;

	override createRenderRoot() { return this; }

	// use updated() not willUpdate() — willUpdate fires before the DOM commit
	// phase, so for elements created via document.createElement() inside a
	// parent's render() (the TamePlacement path), context values from @consume
	// haven't propagated yet. updated() fires after render + commit, so client
	// is guaranteed resolved.
	override updated(changed: Map<string, unknown>) {
		if (changed.has("client") && this.client && this.client !== this.#lastClient) {
			this.#lastClient = this.client;
			this.#subscribe();
			this.#fetch();
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	// -- actions -----------------------------------------------------------

	async #switchTo(s: SessionInfo) {
		if (!this.client) return;
		await this.client.call("history", "load", { id: s.id });
		this.dispatchEvent(new CustomEvent("web:switch-agent", {
			detail: { id: s.id },
			bubbles: true,
			composed: true,
		}));
	}

	async #newChat() {
		if (!this.client) return;
		const result = await this.client.call("@tame", "newAgent", {});
		const id = (result as any).id as string;
		this.dispatchEvent(new CustomEvent("web:switch-agent", {
			detail: { id },
			bubbles: true,
			composed: true,
		}));
	}

	// -- internals ---------------------------------------------------------

	#subscribe() {
		if (!this.client) return;
		this.#unsub?.();
		this.#unsub = this.client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg: any) => {
				this.sessions = this.#sort((msg.data as any)?.sessions ?? []);
			},
		);
	}

	async #fetch() {
		const client = this.client;
		if (!client) return;
		try {
			const result = await client.call("history", "list", {});
			this.sessions = this.#sort((result as any)?.sessions ?? []);
		} catch (e) {
			console.error("tame-history: failed to list sessions", e);
		} finally {
			this.loading = false;
		}
	}

	#sort(list: SessionInfo[]): SessionInfo[] {
		return [...list].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
	}

	// -- render ------------------------------------------------------------

	override render() {
		return html`
			<details open>
				<summary>
					<span>sessions</span>
					<button @click=${this.#newChat} title="new chat">+</button>
				</summary>
				${this.loading
					? html`<div data-state="loading">loading...</div>`
					: this.#renderList()}
			</details>
		`;
	}

	#renderList() {
		if (this.sessions.length === 0) {
			return html`<div data-state="empty">no sessions yet</div>`;
		}
		return html`
			<div data-state="list">
				${this.sessions.map((s) => html`
					<button ?data-active=${s.id === this.agentId}
						@click=${() => this.#switchTo(s)}>
						${s.title || s.id.slice(0, 8)}
					</button>
				`)}
			</div>
		`;
	}
}
customElements.define("tame-history", TameHistory);
