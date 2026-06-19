import { LitElement, html, type ReactiveController, type ReactiveControllerHost } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";
import type { SessionInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// controller: owns the subscription lifecycle + session state. the element
// itself is pure template — no lifecycle callbacks, no imperative fetch calls.
// ---------------------------------------------------------------------------

interface TitleHost extends ReactiveControllerHost {
	client: RPCClientLike | null;
	agentId: string | null;
}

class TitleController implements ReactiveController {
	#host: TitleHost;
	#unsub: (() => void) | null = null;
	#lastClient: RPCClientLike | null = null;
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

	// -- internals ---------------------------------------------------------

	#subscribe() {
		const client = this.#host.client;
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
		const client = this.#host.client;
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
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) client: RPCClientLike | null = null;

	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) agentId: string | null = null;

	#titleCtrl = new TitleController(this as TitleHost);

	override createRenderRoot() { return this; }

	override render() {
		return html`<span class="session-title">${this.#titleCtrl.title}</span>`;
	}
}

customElements.define("tame-history-session-title", TameHistorySessionTitle);
