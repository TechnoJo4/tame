import { LitElement, html } from "lit";
import { RPCController } from "../lib/rpc-controller.ts";

export class TameShell extends LitElement {
	static properties = {
		messages: { type: Array, state: true },
		loading: { type: Boolean, state: true },
		error: { type: String, state: true },
	};

	declare messages: any[];
	declare loading: boolean;
	declare error: string | null;

	#controller = new RPCController(this);

	constructor() {
		super();
		this.messages = [];
		this.loading = true;
		this.error = null;
	}

	createRenderRoot() { return this; }

	render() {
		if (this.loading) {
			return html`<div class="loading">loading...</div>`;
		}
		if (this.error) {
			return html`<div class="error">${this.error}</div>`;
		}
		return html`
			<div class="layout">
				<tame-sidebar .controller=${this.#controller}></tame-sidebar>
				<main class="main">
					<tame-thread .messages=${this.messages} .controller=${this.#controller}></tame-thread>
					<tame-composer .controller=${this.#controller}></tame-composer>
				</main>
			</div>
		`;
	}
}
customElements.define("tame-shell", TameShell);
