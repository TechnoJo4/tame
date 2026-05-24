import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

/** Modal frame. Renders modal:settings placements, each wrapped in
 *  <tame-web-settings-form> with pluginId from placement props.
 *  Visibility controlled by the open attribute. */
export class TameSettingsModal extends LitElement {
	@property({ type: Object }) controller: RPCController;
	@property({ type: Boolean, reflect: true }) open = false;

	#loaded = new Set<string>();

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#onKeydown = this.#onKeydown.bind(this);
		document.addEventListener("keydown", this.#onKeydown);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener("keydown", this.#onKeydown);
	}

	#onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && this.open) {
			this.#close();
		}
	}

	#close() {
		this.open = false;
	}

	#onBackdropClick(e: MouseEvent) {
		if ((e.target as HTMLElement).classList.contains("settings-backdrop")) {
			this.#close();
		}
	}

	render() {
		if (!this.open) return html``;
		const placements = this.controller?.getPlacements("modal:settings") ?? [];
		return html`
			<div class="settings-backdrop" @click=${this.#onBackdropClick}>
				<div class="settings-panel">
					<div class="settings-header">
						<h2>settings</h2>
						<button class="settings-close" @click=${this.#close} title="close">✕</button>
					</div>
					<div class="settings-body">
						${placements.map((p) => this.#renderPlacement(p))}
					</div>
				</div>
			</div>
		`;
	}

	#renderPlacement(p: { tag: string; props?: Record<string, unknown> }) {
		const pluginId = (p.props?.pluginId as string) ?? "";
		const src = this.controller?.getComponentSrc(p.tag);
		if (src && !this.#loaded.has(p.tag)) {
			this.#loaded.add(p.tag);
			import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
		}
		const el = document.createElement(p.tag) as any;
		customElements.whenDefined(p.tag).then(() => {
			el.controller = this.controller;
			if (p.props) Object.assign(el, p.props);
		});
		return html`
			<tame-web-settings-form pluginId=${pluginId}>
				${el}
			</tame-web-settings-form>
		`;
	}
}
customElements.define("tame-web-settings-modal", TameSettingsModal);
