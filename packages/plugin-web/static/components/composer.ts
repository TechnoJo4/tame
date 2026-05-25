import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameComposer extends LitElement {
	@property({ type: Object }) controller: RPCController;
	@property({ type: Boolean }) idle: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<div class="composer-row">
				<textarea
					class="input"
					placeholder="send a message..."
					@keydown=${this.#onKeydown}
					@input=${this.#onInput}
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

	#onInput() {
		const textarea = this.renderRoot.querySelector("textarea") as HTMLTextAreaElement;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	#send() {
		const textarea = this.renderRoot.querySelector("textarea") as HTMLTextAreaElement;
		const text = textarea?.value.trim();
		if (text) {
			this.controller?.send(text);
			textarea.value = "";
			textarea.style.height = "auto";
		}
	}

	#abort() {
		this.controller?.abort();
	}
}
customElements.define("tame-web-composer", TameComposer);
