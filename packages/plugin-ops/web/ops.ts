import { LitElement, html } from "lit";

// ---- shared helpers ----

const truncate = (s: string, n: number): string =>
	s.length <= n ? s : s.slice(0, n) + "…";

const contractHome = (path: string): string => {
	const home = "/home/coder";
	if (path === home) return "~";
	if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
	return path;
};

// ---- tame-ops-read ----

export class TameOpsRead extends LitElement {
	static properties = {
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

	createRenderRoot() { return this; }

	render() {
		const range = this.offset || this.limit
			? ` [${this.offset ? `L${this.offset}` : ""}${this.limit ? `+${this.limit}` : ""}]`
			: "";
		return html`
			<span class="ops-label">read ${contractHome(this.path)}${range}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre class="ops-content${this.isError ? " error" : ""}">${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-read", TameOpsRead);

// ---- tame-ops-write ----

export class TameOpsWrite extends LitElement {
	static properties = {
		path: { type: String },
		content: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare content: string;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">write ${contractHome(this.path)}</span>
			${this.content ? html`
				<pre class="ops-content">${truncate(this.content, 1000)}</pre>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span class="ops-status${this.isError ? " error" : ""}">${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-write", TameOpsWrite);

// ---- tame-ops-edit ----

export class TameOpsEdit extends LitElement {
	static properties = {
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

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">edit ${contractHome(this.path)}</span>
			${this.oldString ? html`
				<div class="ops-diff">
					<pre class="ops-diff-old">− ${truncate(this.oldString, 200)}</pre>
					<pre class="ops-diff-new">+ ${truncate(this.newString, 200)}</pre>
				</div>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span class="ops-status${this.isError ? " error" : ""}">${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-edit", TameOpsEdit);

// ---- tame-ops-exec ----

export class TameOpsExec extends LitElement {
	static properties = {
		command: { type: String },
		workdir: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare command: string;
	declare workdir?: string;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">exec <code>${this.command ?? "?"}</code>${this.workdir ? ` in ${contractHome(this.workdir)}` : ""}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre class="ops-content${this.isError ? " error" : ""}">${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-exec", TameOpsExec);

