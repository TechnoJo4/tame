import { html, LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import {
	settingsPluginIdContext,
	settingsStoreContext,
} from "@tame/web-sdk/settings-context";
import type { SettingsStore } from "@tame/web-sdk";

// ---- shared helpers ----

const truncate = (s: string, n: number): string =>
	s.length <= n ? s : s.slice(0, n) + "…";

type Visibility = "shown" | "hidden" | "collapsable" | "collapsed";

/** Base class for ops tool views. Provides settings-driven visibility
 *  via the "ops" plugin's SettingsStore keys. The store is resolved
 *  from lit context; the host re-renders on change.
 *
 *  Subclasses implement #summaryKey (the settings key) and pass their
 *  label + body to #wrap() in render(). */
abstract class OpsView extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: SettingsStore | undefined;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	declare pluginId: string;

	#unsub: (() => void) | null = null;

	override connectedCallback() {
		super.connectedCallback();
		this.#subscribe();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	override willUpdate(changed: Map<string, unknown>) {
		if (
			(changed.has("store") || changed.has("pluginId")) && this.store &&
			this.pluginId
		) {
			this.#subscribe();
		}
	}

	#subscribe() {
		if (!this.store || !this.pluginId || !this.visibilityKey) return;
		this.#unsub?.();
		this.#unsub = this.store.onChange(
			this.pluginId,
			this.visibilityKey,
			() => this.requestUpdate(),
		);
	}

	abstract get visibilityKey(): string;

	#visibility(): Visibility {
		const raw = this.store?.get(this.pluginId, this.visibilityKey);
		switch (raw) {
			case "shown":
			case "hidden":
			case "collapsable":
			case "collapsed":
				return raw;
			default:
				return "collapsable";
		}
	}

	/** Render the label + body according to the visibility setting.
	 *  - hidden: label only, no body
	 *  - shown: label + body, flat
	 *  - collapsable / collapsed: <details> with label in <summary> */
	protected wrap(label: TemplateResult, body: TemplateResult): TemplateResult {
		switch (this.#visibility()) {
			case "hidden":
				return html`
					<span data-label>${label}</span>
				`;
			case "shown":
				return html`
					<span data-label>${label}</span>${body}
				`;
			case "collapsable":
				return html`
					<details open>
						<summary><span data-label>${label}</span></summary>${body}
					</details>
				`;
			case "collapsed":
				return html`
					<details>
						<summary><span data-label>${label}</span></summary>${body}
					</details>
				`;
		}
	}
}

// ---- tame-ops-read ----

export class TameOpsRead extends OpsView {
	@property({ type: String })
	path = "";
	@property({ type: Number })
	offset?: number;
	@property({ type: Number })
	limit?: number;
	@property({ type: String })
	result: string | null = null;
	@property({ type: Boolean })
	isError = false;

	override createRenderRoot() {
		return this;
	}

	get visibilityKey() {
		return "readVisibility";
	}

	override render() {
		const range = this.offset || this.limit
			? ` [${this.offset ? `L${this.offset}` : ""}${
				this.limit ? `+${this.limit}` : ""
			}]`
			: "";
		const label = html`
			read ${this.path}${range}
		`;
		const body = this.result !== null && this.result !== undefined
			? html`
				<pre ?data-error="${this.isError}">${this.result}</pre>
			`
			: html`

			`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-read", TameOpsRead);

// ---- tame-ops-write ----

export class TameOpsWrite extends OpsView {
	@property({ type: String })
	path = "";
	@property({ type: String })
	content = "";
	@property({ type: String })
	result: string | null = null;
	@property({ type: Boolean })
	isError = false;

	override createRenderRoot() {
		return this;
	}

	get visibilityKey() {
		return "writeVisibility";
	}

	override render() {
		const label = html`
			write ${this.path}
		`;
		const body = html`
			${this.content
				? html`
					<pre>${truncate(this.content, 1000)}</pre>
				`
				: html`

				`} ${this.result !== null && this.result !== undefined
				? html`
					<span data-status ?data-error="${this.isError}">${this.result}</span>
				`
				: html`

				`}
		`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-write", TameOpsWrite);

// ---- tame-ops-edit ----

export class TameOpsEdit extends OpsView {
	@property({ type: String })
	path = "";
	@property({ type: String })
	oldString = "";
	@property({ type: String })
	newString = "";
	@property({ type: String })
	result: string | null = null;
	@property({ type: Boolean })
	isError = false;

	override createRenderRoot() {
		return this;
	}

	get visibilityKey() {
		return "editVisibility";
	}

	override render() {
		const label = html`
			edit ${this.path}
		`;
		const body = html`
			${this.oldString
				? html`
					<div>
						<del>− ${truncate(this.oldString, 200)}</del>
						<ins>+ ${truncate(this.newString, 200)}</ins>
					</div>
				`
				: html`

				`} ${this.result !== null && this.result !== undefined
				? html`
					<span data-status ?data-error="${this.isError}">${this.result}</span>
				`
				: html`

				`}
		`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-edit", TameOpsEdit);

// ---- tame-ops-exec ----

export class TameOpsExec extends OpsView {
	@property({ type: String })
	command = "";
	@property({ type: String })
	workdir?: string;
	@property({ type: String })
	result: string | null = null;
	@property({ type: Boolean })
	isError = false;

	override createRenderRoot() {
		return this;
	}

	get visibilityKey() {
		return "execVisibility";
	}

	override render() {
		const label = html`
			exec <code>${this.command ?? "?"}</code>${this.workdir
				? ` in ${this.workdir}`
				: ""}
		`;
		const body = this.result !== null && this.result !== undefined
			? html`
				<pre ?data-error="${this.isError}">${this.result}</pre>
			`
			: html`

			`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-exec", TameOpsExec);
