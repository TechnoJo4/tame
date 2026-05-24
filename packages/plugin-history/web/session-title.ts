import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { WebController } from "@tame/web-sdk/controller";

interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
}

export class TameSessionTitle extends LitElement {
	@property({ type: Object }) controller: WebController;

	#title = "tame";
	#loaded = false;
	#unsub: (() => void) | null = null;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("controller") && this.controller?.client && !this.#loaded) {
			this.#loaded = true;
			const client = this.controller.client;
			this.#unsub = client.subscribe(
				{ plugin: "history", event: "sessionsChanged" },
				(msg) => {
					const sessions: SessionInfo[] = (msg.data as any)?.sessions ?? [];
					this.#updateTitle(sessions);
				},
			);
			this.#fetchInitial();
		}
	}

	async #fetchInitial() {
		const result = await this.controller?.client?.call("history", "list", {});
		const sessions: SessionInfo[] = (result as any)?.sessions ?? [];
		this.#updateTitle(sessions);
	}

	#updateTitle(sessions: SessionInfo[]) {
		const active = sessions.find(s => s.id === this.controller?.agentId);
		this.#title = active?.title || active?.id?.slice(0, 8) || "tame";
		this.requestUpdate();
	}

	render() {
		return html`<span class="session-title">${this.#title}</span>`;
	}
}
customElements.define("tame-session-title", TameSessionTitle);
