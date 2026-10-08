import {consume} from "@lit/context";
import type {SettingsStore} from "@tame/web-sdk";
import {settingsStoreContext} from "@tame/web-sdk/settings-context";
import {html, LitElement, type TemplateResult} from "lit";
import {property} from "lit/decorators.js";

// ---- shared helpers ----

const truncate = (s: string, n: number): string => s.length <= n ? s : s.slice(0, n) + "…";

type Visibility = "shown"|"hidden"|"collapsable"|"collapsed";

const DEFAULT_VISIBILITY: Visibility = "collapsable";

function parseVisibility(raw: string|null): Visibility {
	switch (raw) {
	case "shown":
	case "hidden":
	case "collapsable":
	case "collapsed":
		return raw;
	default:
		return DEFAULT_VISIBILITY;
	}
}

/**
 * Wrap a label + body pair according to the visibility setting.
 *  - hidden: label only, no body
 *  - shown: label + body, flat
 *  - collapsable / collapsed: <details> with label in <summary>
 */
function withVisibility(label: TemplateResult, body: TemplateResult, v: Visibility): TemplateResult {
	switch (v) {
	case "hidden":
		return html`<span data-label>${label}</span>`;
	case "shown":
		return html`<span data-label>${label}</span>${body}`;
	case "collapsable":
		return html`<details open><summary><span data-label>${label}</span></summary>${body}</details>`;
	case "collapsed":
		return html`<details><summary><span data-label>${label}</span></summary>${body}</details>`;
	}
}

/**
 * Base class for ops tool views. Subscribes to a single settings key
 *  on the "ops" plugin's SettingsStore and re-renders on change.
 */
abstract class OpsView extends LitElement {
	@consume({ context: settingsStoreContext }) @property({ attribute: false }) store: SettingsStore|undefined;

	#unsub: (() => void)|null = null;

	abstract get visibilityKey(): string;

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
		if (changed.has("store") && this.store) this.#subscribe();
	}

	#subscribe() {
		if (!this.store || !this.visibilityKey) return;
		this.#unsub?.();
		this.#unsub = this.store.onChange("ops", this.visibilityKey, () => this.requestUpdate());
	}

	#getVisibility(): Visibility { return parseVisibility(this.store?.get("ops", this.visibilityKey) ?? null); }

	protected wrap(label: TemplateResult, body: TemplateResult): TemplateResult {
		return withVisibility(label, body, this.#getVisibility());
	}
}

// ---- tame-ops-read ----

export class TameOpsRead extends OpsView {
	static override properties = {
		path: { type: String },
		offset: { type: Number },
		limit: { type: Number },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare offset?: number;
	declare limit?: number;
	declare result: string|null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	get visibilityKey() { return "readVisibility"; }

	override render() {
		const range = this.offset || this.limit
		                  ? ` [${this.offset ? `L${this.offset}` : ""}${this.limit ? `+${this.limit}` : ""}]`
						  : "";
		const label = html`read ${this.path}${range}`;
		const body = this.result !== null && this.result !== undefined
		                 ? html`<pre ?data-error="${this.isError}">${this.result}</pre>`
				         : html``;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-read", TameOpsRead);

// ---- tame-ops-write ----

export class TameOpsWrite extends OpsView {
	static override properties = {
		path: { type: String },
		content: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare content: string;
	declare result: string|null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	get visibilityKey() { return "writeVisibility"; }

	override render() {
		const label = html`write ${this.path}`;
		const content = this.content ? html`<pre>${truncate(this.content, 1000)}</pre>` : html``;
		const result = this.result !== null && this.result !== undefined
		                   ? html`<span data-status ?data-error="${this.isError}">${this.result}</span>`
				           : html``;
		const body = html`${content}${result}`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-write", TameOpsWrite);

// ---- tame-ops-edit ----

export class TameOpsEdit extends OpsView {
	static override properties = {
		path: { type: String },
		oldString: { type: String },
		newString: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare oldString: string;
	declare newString: string;
	declare result: string|null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	get visibilityKey() { return "editVisibility"; }

	override render() {
		const label = html`edit ${this.path}`;
		let changes = html``;
		if (this.oldString) {
			const oldText = truncate(this.oldString, 200);
			const newText = truncate(this.newString, 200);
			changes = html`<div><del>− ${oldText}</del><ins>+ ${newText}</ins></div>`;
		}
		const result = this.result !== null && this.result !== undefined
		                   ? html`<span data-status ?data-error="${this.isError}">${this.result}</span>`
				           : html``;
		const body = html`${changes}${result}`;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-edit", TameOpsEdit);

// ---- tame-ops-exec ----

export class TameOpsExec extends OpsView {
	static override properties = {
		command: { type: String },
		workdir: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare command: string;
	declare workdir?: string;
	declare result: string|null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	get visibilityKey() { return "execVisibility"; }

	override render() {
		const label = html`exec <code>${this.command ?? "?"}</code>${this.workdir ? ` in ${this.workdir}` : ""}`;
		const body = this.result !== null && this.result !== undefined
		                 ? html`<pre ?data-error="${this.isError}">${this.result}</pre>`
				         : html``;
		return this.wrap(label, body);
	}
}
customElements.define("tame-ops-exec", TameOpsExec);
