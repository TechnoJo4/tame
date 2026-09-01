import {provide} from "@lit/context";
import {html, LitElement} from "lit";
import {property} from "lit/decorators.js";

import {settingsPluginIdContext} from "../lib/settings-context.ts";

export class TameSettingsSection extends LitElement {
	@provide({ context: settingsPluginIdContext }) @property({ type: String, attribute: "plugin-id" }) pluginId = "";

	@property({ type: String }) heading = "";

	override render() {
		return html`
			<fieldset>
				<legend>${this.heading}</legend>
				<slot></slot>
			</fieldset>
		`;
	}
}
customElements.define("tame-web-settings-section", TameSettingsSection);
