import { LitElement, html } from "lit";

export class TameToolResult extends LitElement {
	static properties = {
		content: { type: String },
		isError: { type: Boolean },
	};

	declare content: string;
	declare isError: boolean;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("isError")) {
			this.dataset.error = String(this.isError);
		}
	}

	render() {
		return html`<pre class="content">${this.content}</pre>`;
	}
}
customElements.define("tame-tool-result", TameToolResult);
