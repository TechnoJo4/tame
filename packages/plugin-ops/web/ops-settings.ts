import { html, LitElement } from "lit";

const VISIBILITY_OPTIONS = [
	{ value: "shown", label: "shown" },
	{ value: "hidden", label: "hidden" },
	{ value: "collapsable", label: "collapsable" },
	{ value: "collapsed", label: "collapsed" },
];

/** Settings form for plugin-ops tool view components. Registered at the
 *  `modal:settings` placement so it only loads when the settings modal
 *  is opened. Each tool view gets a visibility dropdown controlling how
 *  its output / diff / status body is displayed. */
export class TameOpsSettings extends LitElement {
	override createRenderRoot() {
		return this;
	}

	override render() {
		return html`
			<tame-web-settings-section plugin-id="ops" heading="ops tool views">
				<tame-web-setting-select
					key="readVisibility"
					default="collapsable"
					label="read output"
					.options="${VISIBILITY_OPTIONS}"
				></tame-web-setting-select>
				<tame-web-setting-select
					key="writeVisibility"
					default="collapsable"
					label="write content"
					.options="${VISIBILITY_OPTIONS}"
				></tame-web-setting-select>
				<tame-web-setting-select
					key="editVisibility"
					default="collapsable"
					label="edit diff"
					.options="${VISIBILITY_OPTIONS}"
				></tame-web-setting-select>
				<tame-web-setting-select
					key="execVisibility"
					default="collapsable"
					label="exec output"
					.options="${VISIBILITY_OPTIONS}"
				></tame-web-setting-select>
			</tame-web-settings-section>
		`;
	}
}
customElements.define("tame-ops-settings", TameOpsSettings);
