import { LitElement, html } from "lit";
import type { RPCController } from "../lib/rpc-controller.ts";

interface Message {
	role: string;
	content: { type: string; [k: string]: unknown }[];
}

export class TameThread extends LitElement {
	controller!: RPCController;
	messages: Message[] = [];

	createRenderRoot() { return this; }

	render() {
		return this.messages.map(
			(m, i) => html`<tame-message .controller=${this.controller} .message=${m} .index=${i}></tame-message>`,
		);
	}
}
customElements.define("tame-thread", TameThread);
