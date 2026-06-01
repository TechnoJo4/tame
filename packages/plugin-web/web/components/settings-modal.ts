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
		document.addEventListener("click", this.#onClick);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener("keydown", this.#onKeydown);
		document.removeEventListener("click", this.#onClick);
	}

	#onKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && this.open) {
			this.#close();
		}
	};

	#close() {
		this.open = false;
	}

	#onClick(e: MouseEvent) {
		if (e.target === this) {
			this.#close();
		}
	}

	override render() {
		if (!this.open) return html``;
		return html`
			<div class="settings-panel">
				<div class="settings-header">
					<h2>settings</h2>
					<button class="settings-close" @click=${this.#close} title="close">✕</button>
				</div>
				<div class="settings-body">
					<tame-web-placement location="modal:settings" .controller=${this.controller}></tame-web-placement>
				</div>
			</div>
		`;
	}
}
customElements.define("tame-web-settings-modal", TameSettingsModal);
