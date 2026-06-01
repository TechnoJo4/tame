import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { settingsStoreContext } from "../lib/settings-context.ts";
import { SettingsStore } from "@tame/web-sdk";

const FORMAT_OPTIONS = [
	{ value: "markdown", label: "markdown" },
	{ value: "raw", label: "raw text" },
];

export class TameWebSettings extends LitElement {
	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store!: SettingsStore;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<tame-web-settings-section .pluginId="web" .heading="message rendering">
				<tame-web-setting-select
					key="assistantFormat"
					default="markdown"
					label="assistant"
					.options=${FORMAT_OPTIONS}></tame-web-setting-select>
				<tame-web-setting-select
					key="userFormat"
					default="markdown"
					label="user"
					.options=${FORMAT_OPTIONS}></tame-web-setting-select>
			</tame-web-settings-section>
		`;
	}
}
customElements.define("tame-web-settings", TameWebSettings);
