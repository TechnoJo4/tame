import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { WebController } from "@tame/web-sdk/controller";

interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
}

export class TameHistory extends LitElement {
	@property({ type: Object }) controller: WebController;

	#sessions: SessionInfo[] = [];
	#loading = true;
	#loaded = false;
	#unsub: (() => void) | null = null;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#subscribe();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("controller") && this.controller?.client && !this.#loaded) {
			this.#loaded = true;
			this.#load();
		}
	}

	#subscribe() {
		const client = this.controller?.client;
		if (!client) return;
		this.#unsub = client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg) => {
				const sessions: SessionInfo[] = (msg.data as any)?.sessions ?? [];
				sessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
				this.#sessions = sessions;
				this.#loading = false;
				this.requestUpdate();
			},
		);
	}

	async #load() {
		const client = this.controller?.client;
		if (!client) return;
		try {
			const result = await client.call("history", "list", {});
			const sessions: SessionInfo[] = (result as any).sessions ?? [];
			sessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
			this.#sessions = sessions;
		} catch (e) {
			console.error("tame-history: failed to list sessions", e);
		} finally {
			this.#loading = false;
			this.requestUpdate();
		}
	}

	render() {
		return html`
			<details class="history-details" open>
				<summary class="history-header">
					<span class="history-title">sessions</span>
					<button class="history-new" @click=${this.#newChat} title="new chat">+</button>
				</summary>
				${this.#loading ? html`<div class="history-loading">loading...</div>` : this.#renderList()}
			</details>
		`;
	}

	#renderList() {
		if (this.#sessions.length === 0) {
			return html`<div class="history-empty">no sessions yet</div>`;
		}
		return html`
			<div class="history-list">
				${this.#sessions.map((s) => html`
					<button class="history-item${s.id === this.controller?.agentId ? " active" : ""}"
						@click=${() => this.#switch(s)}>
						${s.title || s.id.slice(0, 8)}
					</button>
				`)}
			</div>
		`;
	}

	#switch(s: SessionInfo) {
		this.controller?.switchAgent(s.id);
	}

	#newChat() {
		this.controller?.newChat();
	}
}
customElements.define("tame-history", TameHistory);
