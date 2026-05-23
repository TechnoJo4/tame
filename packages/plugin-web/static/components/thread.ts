import { LitElement, html } from "lit";
import type { RPCController, Message } from "../lib/rpc-controller.ts";

export class TameThread extends LitElement {
	static properties = {
		messages: { type: Array },
		controller: { type: Object },
	};

	messages: Message[] = [];
	controller!: RPCController;

	createRenderRoot() { return this; }

	render() {
		return this.messages.map(
			(m, i) => html`<tame-message .message=${m} .index=${i} .controller=${this.controller}></tame-message>`,
		);
	}
}
customElements.define("tame-thread", TameThread);
