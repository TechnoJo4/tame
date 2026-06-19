import { LitElement, html, type ReactiveController, type ReactiveControllerHost } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import type { SessionInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// controller
// ---------------------------------------------------------------------------

interface HistoryHost extends ReactiveControllerHost {
	client: RPCClientLike | null;
	agentId: string | null;
}

class HistoryController implements ReactiveController {
	#host: HistoryHost;
	#unsub: (() => void) | null = null;
	#lastClient: RPCClientLike | null = null;
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
		this.#lastClient = this.#host.client;
		this.#lastAid = this.#host.agentId;
		this.#subscribe();
		this.#fetch();
	}

	hostDisconnected() {
		this.#unsub?.();
		this.#unsub = null;
	}

	hostUpdate() {
		const client = this.#host.client;
		const aid = this.#host.agentId;
		const clientChanged = client !== this.#lastClient;
		const aidChanged = aid !== this.#lastAid;

		if (clientChanged) {
			this.#unsub?.();
			this.#unsub = null;
			this.#lastClient = client;
			this.#subscribe();
		}

		if (clientChanged || aidChanged) {
			this.#lastAid = aid;
			this.#fetch();
		}
	}

	// -- actions -----------------------------------------------------------

	async switchTo(s: SessionInfo) {
		if (!this.#host.client) return;
		await this.#host.client.call("history", "load", { id: s.id });
		// bubble up to shell-app to switch the active agent
		this.#host.dispatchEvent(new CustomEvent("web:switch-agent", {
			detail: { id: s.id },
			bubbles: true,
			composed: true,
		}));
	}

	async newChat() {
		if (!this.#host.client) return;
		const result = await this.#host.client.call("@tame", "newAgent", {});
		const id = (result as any).id as string;
		this.#host.dispatchEvent(new CustomEvent("web:switch-agent", {
			detail: { id },
			bubbles: true,
			composed: true,
		}));
	}

	// -- internals ---------------------------------------------------------

	#subscribe() {
		const client = this.#host.client;
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
		const client = this.#host.client;
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
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) client: RPCClientLike | null = null;

	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) agentId: string | null = null;

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
						@click=${() => c.switchTo(s)}>
						${s.title || s.id.slice(0, 8)}
					</button>
				`)}
			</div>
		`;
	}
}
customElements.define("tame-history", TameHistory);
