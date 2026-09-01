import {consume} from "@lit/context";
import {agentIdContext} from "@tame/web-sdk";
import {rpcClientContext, type RPCClientLike} from "@tame/web-sdk/rpc-client-context";
import {html, LitElement} from "lit";
import {property} from "lit/decorators.js";

export class TameComposer extends LitElement {
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false })
	declare client: RPCClientLike|null;

	@consume({ context: agentIdContext, subscribe: true }) @property({ type: String }) declare agentId: string|null;

	@property({ type: Boolean }) idle = true;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<textarea
				placeholder="send a message..."
				@keydown=${this.#onKeydown}
				@input=${this.#onInput}
			></textarea>
			${
			this.idle ? html`
				<button data-action="send" @click=${this.#doSend} title="send (enter)">→</button>
			`
					  : html`
				<button data-action="abort" @click=${this.#doAbort} title="stop">■</button>
			`}
		`;
	}

	#onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.#doSend();
		}
	}

	#onInput() {
		const textarea = this.renderRoot.querySelector("textarea") as HTMLTextAreaElement;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	#doSend() {
		const textarea = this.renderRoot.querySelector("textarea") as HTMLTextAreaElement;
		const text = textarea?.value.trim();
		if (!text) {
			this.dispatchEvent(new CustomEvent("web:queue", {
				bubbles: true,
				composed: true,
			}));
			return;
		}
		// Clear via execCommand so the browser maintains its own undo
		// stack — ctrl+z restores the content after sending.
		textarea.focus();
		textarea.select();
		document.execCommand("delete");
		this.dispatchEvent(new CustomEvent("web:send", {
			detail: { text },
			bubbles: true,
			composed: true,
		}));
	}

	#doAbort() {
		this.dispatchEvent(new CustomEvent("web:abort", {
			bubbles: true,
			composed: true,
		}));
	}
}
customElements.define("tame-web-composer", TameComposer);
