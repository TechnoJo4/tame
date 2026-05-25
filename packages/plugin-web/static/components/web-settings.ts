import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext, settingsPluginIdContext } from "../lib/settings-context.ts";

const FORMAT_OPTIONS = [
	{ value: "markdown", label: "markdown" },
	{ value: "raw", label: "raw text" },
];

/** Shell's own settings. Registered at modal:settings by WebPlugin.init(). */
export class TameWebSettings extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: any;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	createRenderRoot() { return this; }

	render() {
		return html`
			<fieldset class="settings-section">
				<legend>message rendering</legend>
				<tame-web-setting-select
					key="assistantFormat"
					default="markdown"
					label="assistant"
					.options=${FORMAT_OPTIONS}
				></tame-web-setting-select>
				<tame-web-setting-select
					key="userFormat"
					default="markdown"
					label="user"
					.options=${FORMAT_OPTIONS}
				></tame-web-setting-select>
			</fieldset>
		`;
	}
}
customElements.define("tame-web-settings", TameWebSettings);
