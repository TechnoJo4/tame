import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import type { SessionInfo } from "./types.ts";

export class TameHistorySessionTitle extends LitElement {
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) client: RPCClientLike | null = null;

	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) agentId: string | null = null;

	@property({ type: Array, state: true }) sessions: SessionInfo[] = [];

	#unsub: (() => void) | null = null;
	#lastClient: RPCClientLike | null = null;

	override createRenderRoot() { return this; }

	get title(): string {
		const session = this.sessions.find(s => s.id === this.agentId);
		return session?.title || session?.id?.slice(0, 8) || "tame";
	}

	// use updated() not willUpdate() — same timing issue as TameHistory:
	// context values aren't propagated yet when willUpdate fires for elements
	// created via document.createElement() in TamePlacement.render().
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

	#subscribe() {
		if (!this.client) return;
		this.#unsub?.();
		this.#unsub = this.client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg: any) => {
				this.sessions = (msg.data as any)?.sessions ?? [];
			},
		);
	}

	async #fetch() {
		const client = this.client;
		if (!client) return;
		const result = await client.call("history", "list", {});
		this.sessions = (result as any)?.sessions ?? [];
	}

	override render() {
		return html`<span class="session-title">${this.title}</span>`;
	}
}
customElements.define("tame-history-session-title", TameHistorySessionTitle);
