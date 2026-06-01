import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

/** Modal frame. Renders modal:settings placements, each wrapped in
 *  <tame-web-settings-form> with pluginId from placement props.
 *  Visibility controlled by the open attribute. */
export class TameSettingsModal extends LitElement {
	@property({ type: Object }) controller!: RPCController;
	@property({ type: Boolean, reflect: true }) open = false;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
		document.addEventListener("keydown", this.#onKeydown);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener("keydown", this.#onKeydown);
	}

	#onKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && this.open) {
			this.#close();
		}
	};

	#close() {
		this.open = false;
	}

	override render() {
		if (!this.open) return html``;
		return html`
			<form>
				<h2>
					settings
					<button class="settings-close" @click=${this.#close} title="close">✕</button>
				</h2>
				<tame-web-placement location="modal:settings" .controller=${this.controller}></tame-web-placement>
			</form>
		`;
	}
}
customElements.define("tame-web-settings-modal", TameSettingsModal);
