import { LitElement, html, type ReactiveController, type ReactiveControllerHost } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/agent-context";
import type { WebController } from "@tame/web-sdk/controller";

interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
}

// ---------------------------------------------------------------------------
// controller: owns the subscription lifecycle + session state. the element
// itself is pure template — no lifecycle callbacks, no imperative fetch calls.
// ---------------------------------------------------------------------------

interface TitleHost extends ReactiveControllerHost {
	controller: WebController;
	agentId: string | null;
}

class TitleController implements ReactiveController {
	#host: TitleHost;
	#unsub: (() => void) | null = null;
	#lastCtrl: WebController | undefined;
	#lastAid: string | null = null;

	sessions: SessionInfo[] = [];

	constructor(host: TitleHost) {
		(this.#host = host).addController(this);
	}

	/** Derived from sessions + agentId. Called during render. */
	get title(): string {
		const session = this.sessions.find(s => s.id === this.#host.agentId);
		return session?.title || session?.id?.slice(0, 8) || "tame";
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

	// -- internals ---------------------------------------------------------

	#subscribe() {
		const client = this.#host.controller?.client;
		if (!client) return;
		this.#unsub = client.subscribe(
			{ plugin: "history", event: "sessionsChanged" },
			(msg: any) => {
				this.sessions = (msg.data as any)?.sessions ?? [];
				this.#host.requestUpdate();
			},
		);
	}

	async #fetch() {
		const client = this.#host.controller?.client;
		if (!client) return;
		const result = await client.call("history", "list", {});
		this.sessions = (result as any)?.sessions ?? [];
		this.#host.requestUpdate();
	}
}

// ---------------------------------------------------------------------------
// element
// ---------------------------------------------------------------------------

export class TameHistorySessionTitle extends LitElement {
	@property({ type: Object }) controller: WebController;
	@consume({ context: agentIdContext, subscribe: true })
	agentId: string | null;

	#titleCtrl = new TitleController(this as TitleHost);

	createRenderRoot() { return this; }

	render() {
		return html`<span class="session-title">${this.#titleCtrl.title}</span>`;
	}
}

customElements.define("tame-history-session-title", TameHistorySessionTitle);
