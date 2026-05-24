import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext, settingsPluginIdContext } from "../lib/settings-context.ts";
import { SettingController } from "../lib/setting-controller.ts";
import type { SettingsStore } from "@tame/web-sdk";

export interface SelectOption {
	value: string;
	label: string;
}

/** Dropdown with options. Consumes store + pluginId from context. */
export class TameSettingSelect extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: SettingsStore | undefined;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	pluginId = "";

	@property({ type: String }) key = "";
	@property({ type: String }) default = "";
	@property({ type: String }) label = "";
	@property({ type: Array }) options: SelectOption[] = [];

	#setting: SettingController | null = null;

	createRenderRoot() { return this; }

	willUpdate(_changed: Map<string, unknown>) {
		if (!this.#setting && this.store && this.pluginId && this.key) {
			this.#setting = new SettingController(
				this, this.pluginId, this.key, this.default,
			);
		}
	}

	#onChange(e: Event) {
		const val = (e.target as HTMLSelectElement).value;
		this.#setting!.value = val;
	}

	render() {
		const val = this.#setting?.value ?? this.default;
		return html`
			<label class="setting-select">
				<span>${this.label}</span>
				<select @change=${this.#onChange}>
					${this.options.map((o) => html`
						<option value=${o.value} ?selected=${o.value === val}>${o.label}</option>
					`)}
				</select>
			</label>
		`;
	}
}
customElements.define("tame-web-setting-select", TameSettingSelect);
