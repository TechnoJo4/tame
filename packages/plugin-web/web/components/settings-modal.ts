import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

/** Modal frame. Renders modal:settings placements, each wrapped in
 *  <tame-web-settings-form> with pluginId from placement props.
 *  Visibility controlled by the open attribute. */
export class TameSettingsModal extends LitElement {
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
					<button @click=${this.#close} title="close">✕</button>
				</h2>
				<tame-web-placement location="modal:settings"></tame-web-placement>
			</form>
		`;
	}
}
customElements.define("tame-web-settings-modal", TameSettingsModal);
