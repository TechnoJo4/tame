import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext, settingsPluginIdContext } from "../lib/settings-context.ts";
import { SettingController } from "../lib/setting-controller.ts";
import type { SettingsStore } from "@tame/web-sdk";

/** Boolean toggle with label. Consumes store + pluginId from context. */
export class TameSettingCheckbox extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: SettingsStore | undefined;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	@property({ type: String }) key = "";
	@property({ type: String }) default = "false";
	@property({ type: String }) label = "";

	#setting: SettingController | null = null;

	createRenderRoot() { return this; }

	willUpdate(_changed: Map<string, unknown>) {
		if (!this.#setting && this.store && this.pluginId && this.key) {
			this.#setting = new SettingController(
				this, this.pluginId, this.key, this.default,
			);
		}
	}

	#toggle() {
		this.#setting?.toggle();
	}

	render() {
		const checked = this.#setting?.bool ?? (this.default === "true");
		return html`
			<label class="setting-checkbox">
				<input type="checkbox" .checked=${checked} @change=${this.#toggle}>
				<span>${this.label}</span>
			</label>
		`;
	}
}
customElements.define("tame-web-setting-checkbox", TameSettingCheckbox);
