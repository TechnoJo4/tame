import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

/** Layout wrapper with heading and preview slot. */
export class TameSettingsSection extends LitElement {
	@property({ type: String }) heading = "";

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<fieldset class="settings-section">
				<legend>${this.heading}</legend>
				<slot></slot>
				<slot name="preview"></slot>
			</fieldset>
		`;
	}
}
customElements.define("tame-web-settings-section", TameSettingsSection);
