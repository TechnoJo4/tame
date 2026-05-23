import { LitElement, html } from "lit";
import type { WebController } from "@tame/web-sdk/controller";

interface SessionInfo {
	id: string;
	title?: string;
}

export class TameHistory extends LitElement {
	static properties = { controller: { type: Object } };
	declare controller: WebController;

	#sessions: SessionInfo[] = [];
	#loading = true;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#load();
	}

	async #load() {
		const client = this.controller?.client;
		if (!client) return;
		try {
			const result = await client.call("history", "list", {});
			this.#sessions = (result as any).sessions ?? [];
		} catch (e) {
			console.error("tame-history: failed to list sessions", e);
		} finally {
			this.#loading = false;
			this.requestUpdate();
		}
	}

	render() {
		return html`
			<div class="history-header">
				<span class="history-title">sessions</span>
				<button class="history-new" @click=${this.#newChat} title="new chat">+</button>
			</div>
			${this.#loading ? html`<div class="history-loading">loading...</div>` : this.#renderList()}
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
						@click=${() => this.#switch(s.id)}>
						${s.title || s.id.slice(0, 8)}
					</button>
				`)}
			</div>
		`;
	}

	#switch(id: string) {
		this.controller?.switchAgent(id);
	}

	#newChat() {
		this.controller?.newChat();
	}
}
customElements.define("tame-history", TameHistory);
