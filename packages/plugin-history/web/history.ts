import { LitElement, html, type ReactiveController, type ReactiveControllerHost } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import type { WebController } from "@tame/web-sdk/controller";
import type { SessionInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// controller
// ---------------------------------------------------------------------------

interface HistoryHost extends ReactiveControllerHost {
	controller: WebController;
	agentId: string | null;
}

class HistoryController implements ReactiveController {
	#host: HistoryHost;
	#unsub: (() => void) | null = null;
	#lastCtrl: WebController | undefined;
	#lastAid: string | null = null;

	sessions: SessionInfo[] = [];
	loading = true;

	constructor(host: HistoryHost) {
		(this.#host = host).addController(this);
	}

	get activeId(): string | null {
		return this.#host.agentId;
	}

	// -- ReactiveController hooks ------------------------------------------

	hostConnected() {
		this.#lastCtrl = this.#host.controller;
		this.#lastAid = this.#host.agentId;
		this.#subscribe();
		this.#fetch();
	}

	hostDisconnected() {
		this.#unsub?.();
		this.#unsub = null;
	}

	hostUpdate() {
		const ctrl = this.#host.controller;
		const aid = this.#host.agentId;
		const ctrlChanged = ctrl !== this.#lastCtrl;
		const aidChanged = aid !== this.#lastAid;

		if (ctrlChanged) {
			this.#unsub?.();
			this.#unsub = null;
			this.#lastCtrl = ctrl;
			this.#subscribe();
		}

		if (ctrlChanged || aidChanged) {
			this.#lastAid = aid;
			this.#fetch();
		}
	}

	// -- actions -----------------------------------------------------------

	async switch(s: SessionInfo) {
		await this.#host.controller?.client?.call("history", "load", { id: s.id });
		await this.#host.controller?.switchAgent(s.id);
	}

	newChat() {
		this.#host.controller?.newChat();
	}

	// -- internals ---------------------------------------------------------

	#subscribe() {
		const client = this.#host.controller?.client;
		if (!client) return;
		this.#unsub = client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg: any) => {
				this.sessions = this.#sort((msg.data as any)?.sessions ?? []);
				this.#host.requestUpdate();
			},
		);
	}

	async #fetch() {
		const client = this.#host.controller?.client;
		if (!client) return;
		try {
			const result = await client.call("history", "list", {});
			this.sessions = this.#sort((result as any)?.sessions ?? []);
		} catch (e) {
			console.error("tame-history: failed to list sessions", e);
		} finally {
			this.loading = false;
			this.#host.requestUpdate();
		}
	}

	#sort(list: SessionInfo[]): SessionInfo[] {
		return [...list].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
	}
}

// ---------------------------------------------------------------------------
// element
// ---------------------------------------------------------------------------

export class TameHistory extends LitElement {
	@property({ type: Object }) controller!: WebController;
	@consume({ context: agentIdContext, subscribe: true })
	agentId: string | null = null;

	#ctrl = new HistoryController(this as HistoryHost);

	override createRenderRoot() { return this; }

	override render() {
		const c = this.#ctrl;
		return html`
			<details class="history-details" open>
				<summary class="history-header">
					<span class="history-title">sessions</span>
					<button class="history-new" @click=${() => c.newChat()} title="new chat">+</button>
				</summary>
				${c.loading
					? html`<div class="history-loading">loading...</div>`
					: this.#renderList()}
			</details>
		`;
	}

	#renderList() {
		const c = this.#ctrl;
		if (c.sessions.length === 0) {
			return html`<div class="history-empty">no sessions yet</div>`;
		}
		return html`
			<div class="history-list">
				${c.sessions.map((s) => html`
					<button class="history-item${s.id === c.activeId ? " active" : ""}"
						@click=${() => c.switch(s)}>
						${s.title || s.id.slice(0, 8)}
					</button>
				`)}
			</div>
		`;
	}
}
customElements.define("tame-history", TameHistory);
