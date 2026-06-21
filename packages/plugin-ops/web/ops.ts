import { LitElement, html } from "lit";

// ---- shared helpers ----

const truncate = (s: string, n: number): string =>
	s.length <= n ? s : s.slice(0, n) + "…";

// ---- tame-ops-read ----

export class TameOpsRead extends LitElement {
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
	declare result: string | null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	override render() {
		const range = this.offset || this.limit
			? ` [${this.offset ? `L${this.offset}` : ""}${this.limit ? `+${this.limit}` : ""}]`
			: "";
		return html`
			<span data-label>read ${this.path}${range}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre ?data-error=${this.isError}>${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-read", TameOpsRead);

// ---- tame-ops-write ----

export class TameOpsWrite extends LitElement {
	static override properties = {
		path: { type: String },
		content: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare content: string;
	declare result: string | null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<span data-label>write ${this.path}</span>
			${this.content ? html`
				<pre>${truncate(this.content, 1000)}</pre>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span data-status ?data-error=${this.isError}>${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-write", TameOpsWrite);

// ---- tame-ops-edit ----

export class TameOpsEdit extends LitElement {
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
	declare result: string | null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<span data-label>edit ${this.path}</span>
			${this.oldString ? html`
				<div>
					<del>− ${truncate(this.oldString, 200)}</del>
					<ins>+ ${truncate(this.newString, 200)}</ins>
				</div>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span data-status ?data-error=${this.isError}>${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-edit", TameOpsEdit);

// ---- tame-ops-exec ----

export class TameOpsExec extends LitElement {
	static override properties = {
		command: { type: String },
		workdir: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare command: string;
	declare workdir?: string;
	declare result: string | null;
	declare isError: boolean;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<span data-label>exec <code>${this.command ?? "?"}</code>${this.workdir ? ` in ${this.workdir}` : ""}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre ?data-error=${this.isError}>${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-exec", TameOpsExec);

