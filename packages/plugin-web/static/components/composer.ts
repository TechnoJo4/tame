import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameComposer extends LitElement {
	static properties = { controller: { type: Object } };
	declare controller: RPCController;

	createRenderRoot() { return this; }

	render() {
		return html`
			<textarea
				class="input"
				placeholder="send a message..."
				@keydown=${this.#onKeydown}
			></textarea>
		`;
	}

	#onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const textarea = e.target as HTMLTextAreaElement;
			const text = textarea.value.trim();
			if (text) {
				this.controller?.send(text);
				textarea.value = "";
			}
		}
	}
}
customElements.define("tame-composer", TameComposer);
