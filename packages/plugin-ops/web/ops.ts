import { html, LitElement, type TemplateResult } from "lit";
import { settingWhen } from "@tame/web-sdk/setting-directives";

// ---- shared helpers ----

const truncate = (s: string, n: number): string =>
	s.length <= n ? s : s.slice(0, n) + "…";

type Visibility = "shown" | "hidden" | "collapsable" | "collapsed";

const DEFAULT_VISIBILITY: Visibility = "collapsable";

/** Wrap a label + body pair according to the visibility setting.
 *  - hidden: label only, no body
 *  - shown: label + body, flat
 *  - collapsable / collapsed: <details> with label in <summary> */
function withVisibility(
	label: TemplateResult,
	body: TemplateResult,
	// deno-lint-ignore no-explicit-any
	value: any,
): TemplateResult {
	const v: Visibility = value === "shown" || value === "hidden" ||
			value === "collapsable" || value === "collapsed"
		? value
		: DEFAULT_VISIBILITY;
	switch (v) {
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

	override createRenderRoot() {
		return this;
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
		return settingWhen(
			"ops",
			"readVisibility",
			DEFAULT_VISIBILITY,
			(v: string) => withVisibility(label, body, v),
		);
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

	override createRenderRoot() {
		return this;
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
		return settingWhen(
			"ops",
			"writeVisibility",
			DEFAULT_VISIBILITY,
			(v: string) => withVisibility(label, body, v),
		);
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

	override createRenderRoot() {
		return this;
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
		return settingWhen(
			"ops",
			"editVisibility",
			DEFAULT_VISIBILITY,
			(v: string) => withVisibility(label, body, v),
		);
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

	override createRenderRoot() {
		return this;
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
		return settingWhen(
			"ops",
			"execVisibility",
			DEFAULT_VISIBILITY,
			(v: string) => withVisibility(label, body, v),
		);
	}
}
customElements.define("tame-ops-exec", TameOpsExec);
