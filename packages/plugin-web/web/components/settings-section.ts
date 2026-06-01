import { LitElement, html } from "lit";
import { provide } from "@lit/context";
import { property } from "lit/decorators.js";
import { settingsPluginIdContext } from "../lib/settings-context.ts";

export class TameSettingsSection extends LitElement {
	@provide({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	@property({ type: String }) heading = "";

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<fieldset class="settings-section">
				<legend>${this.heading}</legend>
				<slot></slot>
			</fieldset>
		`;
	}
}
customElements.define("tame-web-settings-section", TameSettingsSection);
