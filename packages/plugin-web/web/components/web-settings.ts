import {consume} from "@lit/context";
import type {SettingsStore} from "@tame/web-sdk";
import {html, LitElement} from "lit";
import {property} from "lit/decorators.js";

import {settingsStoreContext} from "../lib/settings-context.ts";

const FORMAT_OPTIONS = [
	{ value: "markdown", label: "markdown" },
	{ value: "raw", label: "raw text" },
];

const VISIBILITY_OPTIONS = [
	{ value: "shown", label: "shown" },
	{ value: "hidden", label: "hidden" },
	{ value: "collapsable", label: "collapsable" },
	{ value: "collapsed", label: "collapsed" },
];

export class TameWebSettings extends LitElement {
	@consume({ context: settingsStoreContext }) @property({ attribute: false }) store!: SettingsStore;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<tame-web-settings-section plugin-id="web" heading="message rendering">
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
				<tame-web-setting-select
					key="automatedVisibility"
					default="hidden"
					label="automated messages"
					.options=${VISIBILITY_OPTIONS}></tame-web-setting-select>
			</tame-web-settings-section>
		`;
	}
}
customElements.define("tame-web-settings", TameWebSettings);
