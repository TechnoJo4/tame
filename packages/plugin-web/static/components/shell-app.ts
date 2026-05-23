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
			return html`<div style="display:flex;align-items:center;justify-content:center;height:100%">loading...</div>`;
		}
		if (this.error) {
			return html`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f66">${this.error}</div>`;
		}
		return html`
			<div style="display:flex;height:100%">
				<tame-sidebar .controller=${this.#controller}></tame-sidebar>
				<main style="flex:1;display:flex;flex-direction:column;min-width:0">
					<tame-thread .messages=${this.messages} .controller=${this.#controller} style="flex:1;overflow-y:auto"></tame-thread>
					<tame-composer .controller=${this.#controller}></tame-composer>
				</main>
			</div>
		`;
	}
}
customElements.define("tame-shell", TameShell);
