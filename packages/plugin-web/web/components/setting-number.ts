import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext, settingsPluginIdContext } from "../lib/settings-context.ts";
import { SettingController } from "../lib/setting-controller.ts";
import type { SettingsStore } from "@tame/web-sdk";

/** Number input with min/max/step. Consumes store + pluginId from context. */
export class TameSettingNumber extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: SettingsStore | undefined;

	@consume({ context: settingsPluginIdContext })
	@property({ type: String })
	declare pluginId: string;

	@property({ type: String }) key = "";
	@property({ type: String }) default = "0";
	@property({ type: String }) label = "";
	@property({ type: Number }) min?: number;
	@property({ type: Number }) max?: number;
	@property({ type: Number }) step?: number;

	#setting: SettingController | null = null;

	override createRenderRoot() { return this; }

	override willUpdate(_changed: Map<string, unknown>) {
		if (!this.#setting && this.store && this.pluginId && this.key) {
			this.#setting = new SettingController(
				this, this.pluginId, this.key, this.default,
			);
		}
	}

	#onInput(e: Event) {
		const val = Number((e.target as HTMLInputElement).value);
		if (!Number.isNaN(val)) this.#setting!.num = val;
	}

	override render() {
		const val = this.#setting?.num ?? Number(this.default);
		return html`
			<label>
				<span>${this.label}</span>
				<input type="number"
					.value=${val}
					min=${this.min ?? ""}
					max=${this.max ?? ""}
					step=${this.step ?? ""}
					@input=${this.#onInput}>
			</label>
		`;
	}
}
customElements.define("tame-web-setting-number", TameSettingNumber);
