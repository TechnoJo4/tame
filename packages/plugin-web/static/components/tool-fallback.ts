import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

export class TameToolFallback extends LitElement {
	@property({ type: String }) name: string;
	@property({ type: Object }) input: Record<string, unknown>;
	@property({ type: String }) result: string | null;
	@property({ type: Boolean }) isError: boolean;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("name")) this.dataset.tool = this.name;
		if (changed.has("result") && this.result !== null) {
			this.dataset.hasResult = "";
		}
	}

	render() {
		const fields = Object.entries(this.input ?? {});
		return html`
			<span class="tool-label">tool: ${this.name}</span>
			${fields.map(([k, v]) => html`<span class="tool-field"><b>${k}</b>: ${this.#fmt(v)}</span>`)}
			${this.result !== null && this.result !== undefined ? html`
				<pre class="tool-output${this.isError ? " error" : ""}">${this.result}</pre>
			` : html``}
		`;
	}

	#fmt(v: unknown): string {
		if (typeof v === "string") return v;
		if (v === null || v === undefined) return "";
		return JSON.stringify(v);
	}
}
customElements.define("tame-web-tool-fallback", TameToolFallback);
