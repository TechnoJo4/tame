import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

export class TameComposer extends LitElement {
	static properties = {
		controller: { type: Object },
	};

	declare controller: RPCController;

	createRenderRoot() { return this; }

	render() {
		return html`
			<div style="border-top:1px solid #333;padding:12px">
				<textarea
					style="width:100%;min-height:60px;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:8px;font-family:inherit;font-size:14px;resize:vertical"
					placeholder="send a message..."
					@keydown=${this.#onKeydown}
				></textarea>
			</div>
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
