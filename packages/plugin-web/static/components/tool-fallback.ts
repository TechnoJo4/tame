import { LitElement, html } from "lit";

export class TameToolFallback extends LitElement {
	name!: string;
	input!: Record<string, unknown>;

	createRenderRoot() { return this; }

	render() {
		return html`
			<div style="margin:4px 0;padding:8px;border:1px solid #444;border-radius:4px;background:#0a0a14">
				<div style="font-size:12px;color:#888;margin-bottom:4px">tool: ${this.name}</div>
				<pre style="white-space:pre-wrap;font-size:12px;margin:0;color:#ccc">${JSON.stringify(this.input, null, 2)}</pre>
			</div>
		`;
	}
}
customElements.define("tame-tool-fallback", TameToolFallback);
