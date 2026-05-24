import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext, settingsPluginIdContext } from "../lib/settings-context.ts";
import { SettingController } from "../lib/setting-controller.ts";

/** Shell's own settings. Registered at modal:settings by WebPlugin.init(). */
export class TameWebSettings extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: any;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	#theme: SettingController | null = null;

	createRenderRoot() { return this; }

	willUpdate(_changed: Map<string, unknown>) {
		if (!this.#theme && this.store && this.pluginId) {
			this.#theme = new SettingController(this, this.pluginId, "theme", "dark");
		}
	}

	render() {
		return html`
			<tame-web-settings-section heading="appearance">
				<tame-web-setting-select
					key="theme"
					default="dark"
					label="theme"
					.options=${[
						{ value: "dark", label: "dark" },
						{ value: "light", label: "light" },
					]}
				></tame-web-setting-select>
			</tame-web-settings-section>
		`;
	}
}
customElements.define("tame-web-settings", TameWebSettings);
