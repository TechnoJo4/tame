import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameComposer extends LitElement {
	static properties = {
		controller: { type: Object },
		idle: { type: Boolean },
	};

	declare controller: RPCController;
	declare idle: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<div class="composer-row">
				<textarea
					class="input"
					placeholder="send a message..."
					@keydown=${this.#onKeydown}
				></textarea>
				${this.idle ? html`
					<button class="send-btn" @click=${this.#send} title="send (enter)">→</button>
				` : html`
					<button class="abort-btn" @click=${this.#abort} title="stop">■</button>
				`}
			</div>
		`;
	}

	#onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.#send();
		}
	}

	#send() {
		const textarea = this.renderRoot.querySelector("textarea") as HTMLTextAreaElement;
		const text = textarea?.value.trim();
		if (text) {
			this.controller?.send(text);
			textarea.value = "";
		}
	}

	#abort() {
		this.controller?.abort();
	}
}
customElements.define("tame-composer", TameComposer);
