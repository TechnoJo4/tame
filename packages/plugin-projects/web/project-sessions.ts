import {consume} from "@lit/context";
import {agentIdContext} from "@tame/web-sdk";
import {rpcClientContext, type RPCClientLike,} from "@tame/web-sdk/rpc-client-context";
import {html, LitElement} from "lit";
import {property, state} from "lit/decorators.js";

interface SessionInfo {
	id: string;
	title?: string;
	lastMessageAt?: number;
	project?: string;
}

export class TameProjectSessions extends LitElement {
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false })
	declare client: RPCClientLike|null;

	@consume({ context: agentIdContext, subscribe: true }) @property({ type: String }) declare agentId: string|null;

	@property({ type: Array }) projects: string[] = [];
	@property({ type: Boolean }) hasHistory = false;
	@state() sessions: SessionInfo[] = [];
	@state() loading = true;
	@state() error: string|null = null;

	#unsub: (() => void)|null = null;
	#lastClient: RPCClientLike|null = null;
	#collapsed = new Set<string>();
	#pending = new Set<string>();
	#sessionPending = new Set<string>();

	override createRenderRoot() { return this; }

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
		if (!this.client || !this.hasHistory) return;
		this.#unsub?.();
		this.#unsub = this.client.subscribe(
		    { plugin: "projects", event: "sessionsChanged" },
		    () => this.#fetch(),
		);
	}

	async #fetch() {
		if (!this.client || !this.hasHistory) {
			this.loading = false;
			return;
		}
		this.loading = true;
		try {
			const result = await this.client.call("projects", "listSessions", {});
			this.sessions = ((result as { sessions?: SessionInfo[] }).sessions ??
			                 []).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
			this.error = null;
		} catch (e) { this.error = e instanceof Error ? e.message : String(e); } finally {
			this.loading = false;
		}
	}

	async #newAgent(project: string) {
		if (!this.client || this.#pending.has(project)) return;
		this.error = null;
		this.#pending.add(project);
		this.requestUpdate();
		try {
			const result = await this.client.call("projects", "newAgent", {
				project,
			});
			this.#switchTo((result as { id: string }).id);
		} catch (e) {
			this.error = `failed to create ${project}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			this.#pending.delete(project);
			this.requestUpdate();
		}
	}

	async #loadSession(session: SessionInfo) {
		if (!this.client || this.#sessionPending.has(session.id)) return;
		this.error = null;
		this.#sessionPending.add(session.id);
		this.requestUpdate();
		try {
			await this.client.call("projects", "loadSession", { id: session.id });
			this.#switchTo(session.id);
		} catch (e) {
			this.error = `failed to load ${session.title || session.id}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			this.#sessionPending.delete(session.id);
			this.requestUpdate();
		}
	}

	#switchTo(id: string) {
		this.dispatchEvent(
		    new CustomEvent("web:switch-agent", {
			    detail: { id },
			    bubbles: true,
			    composed: true,
		    }),
		);
	}

	#toggle(name: string, event: Event) {
		const details = event.currentTarget as HTMLDetailsElement;
		if (details.open)
			this.#collapsed.delete(name);
		else
			this.#collapsed.add(name);
	}

	#projectKey(project: string) { return `project:${project}`; }

	override render() {
		return html`
			${this.error ? html`<div data-state="error">${this.error}</div>` : html``}
			${this.projects.map((project) => this.#renderProject(project))}
			${this.hasHistory ? this.#renderOther() : html``}
		`;
	}

	#renderProject(project: string) {
		const sessions = this.sessions.filter((session) => session.project === project);
		const key = this.#projectKey(project);
		return html`
			<details ?open=${!this.#collapsed.has(key)} @toggle=${(e: Event) => this.#toggle(key, e)}>
				<summary>
					<span data-role="label">${project}</span>
					<button ?disabled=${this.#pending.has(project)} @click=${
			(
				e: Event,
				) => {
			    e.preventDefault();
			    e.stopPropagation();
			    this.#newAgent(project);
			}} title="new ${project} agent">+</button>
				</summary>
				${this.#renderSessions(sessions, `no ${project} sessions yet`)}
			</details>
		`;
	}

	#renderOther() {
		const configured = new Set(this.projects);
		const sessions = this.sessions.filter((session) => !session.project || !configured.has(session.project));
		return html`
			<details ?open=${!this.#collapsed.has("other")} @toggle=${(e: Event) => this.#toggle("other", e)}>
				<summary><span data-role="label">other</span></summary>
				${this.#renderSessions(sessions, "no other sessions yet")}
			</details>
		`;
	}

	#renderSessions(sessions: SessionInfo[], empty: string) {
		if (this.loading) return html`<div data-state="loading">loading...</div>`;
		if (this.error && sessions.length === 0) { return html`<div data-state="error">${this.error}</div>`; }
		if (sessions.length === 0) { return html`<div data-state="empty">${empty}</div>`; }
		return html`
			<div data-state="list">
				${sessions.map((session) => html`
						<button ?data-active=${session.id === this.agentId}
							?disabled=${this.#sessionPending.has(session.id)}
							@click=${() => this.#loadSession(session)}>
							${session.title || session.id.slice(0, 8)}
						</button>
					`)}
			</div>
		`;
	}
}

customElements.define("tame-project-sessions", TameProjectSessions);
