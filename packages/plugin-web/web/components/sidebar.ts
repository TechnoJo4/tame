import { LitElement, html } from "lit";
import { cache } from "lit/directives/cache.js";
import { property } from "lit/decorators.js";

export class TameSidebar extends LitElement {
	@property({ type: Boolean, reflect: true }) collapsed = false;

	override createRenderRoot() { return this; }

	override render() {
		return html`${cache(this.collapsed
			? html``
			: html`<tame-web-placement location="panel:sidebar"></tame-web-placement>`)}`;
	}
}
customElements.define("tame-web-sidebar", TameSidebar);
