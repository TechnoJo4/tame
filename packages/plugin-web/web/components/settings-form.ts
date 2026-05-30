import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { provide } from "@lit/context";
import { settingsPluginIdContext } from "../lib/settings-context.ts";

/** Context provider for settingsPluginIdContext.
 *  Wraps all settings controls within a plugin's section.
 *  Descendants consume pluginId via @consume(). */
export class TameSettingsForm extends LitElement {
	@provide({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	override createRenderRoot() { return this; }

	override render() {
		return html`<slot></slot>`;
	}
}
customElements.define("tame-web-settings-form", TameSettingsForm);
