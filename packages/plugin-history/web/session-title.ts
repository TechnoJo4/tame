import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/agent-context";
import type { WebController } from "@tame/web-sdk/controller";

interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
}

export class TameHistorySessionTitle extends LitElement {
	@property({ type: Object }) controller: WebController;
	@consume({ context: agentIdContext, subscribe: true })
	agentId: string | null;

	#title = "tame";
	#loaded = false;
	#unsub: (() => void) | null = null;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#setup();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("controller")) {
			this.#setup();
		}
		// agentId comes from context — re-fetch when it changes so the
		// title follows agent switches.
		if (changed.has("agentId") && this.agentId && this.#loaded) {
			this.#fetchInitial();
		}
	}

	/** Wire up controller. Idempotent — only runs once. */
	#setup() {
		const client = this.controller?.client;
		if (!client || this.#loaded) return;
		this.#loaded = true;

		this.#unsub = client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg) => {
				const sessions: SessionInfo[] = (msg.data as any)?.sessions ?? [];
				this.#updateTitle(sessions);
			},
		);
		this.#fetchInitial();
	}

	async #fetchInitial() {
		const result = await this.controller?.client?.call("history", "list", {});
		const sessions: SessionInfo[] = (result as any)?.sessions ?? [];
		this.#updateTitle(sessions);
	}

	#updateTitle(sessions: SessionInfo[]) {
		const active = sessions.find(s => s.id === this.agentId);
		this.#title = active?.title || active?.id?.slice(0, 8) || "tame";
		this.requestUpdate();
	}

	render() {
		return html`<span class="session-title">${this.#title}</span>`;
	}
}
customElements.define("tame-history-session-title", TameHistorySessionTitle);
