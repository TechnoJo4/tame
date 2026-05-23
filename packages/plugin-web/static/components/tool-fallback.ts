import { LitElement, html } from "lit";

export class TameToolFallback extends LitElement {
	static properties = {
		name: { type: String },
		input: { type: Object },
	};

	declare name: string;
	declare input: Record<string, unknown>;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("name")) this.dataset.tool = this.name;
	}

	render() {
		return html`
			<span class="tool-label">tool: ${this.name}</span>
			<pre class="tool-input">${JSON.stringify(this.input, null, 2)}</pre>
		`;
	}
}
customElements.define("tame-tool-fallback", TameToolFallback);
