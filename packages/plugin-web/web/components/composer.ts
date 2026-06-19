import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { agentIdContext } from "@tame/web-sdk";
import { rpcClientContext, type RPCClientLike } from "@tame/web-sdk/rpc-client-context";

export class TameComposer extends LitElement {
	@consume({ context: rpcClientContext, subscribe: true })
	@property({ attribute: false }) client: RPCClientLike | null = null;

	@consume({ context: agentIdContext, subscribe: true })
	@property({ type: String }) agentId: string | null = null;

	@property({ type: Boolean }) idle = true;

	override createRenderRoot() { return this; }

	override render() {
		return html`
			<textarea
				class="input"
				placeholder="send a message..."
				@keydown=${this.#onKeydown}
				@input=${this.#onInput}
			></textarea>
			${this.idle ? html`
				<button class="send-btn" @click=${this.#doSend} title="send (enter)">→</button>
			` : html`
				<button class="abort-btn" @click=${this.#doAbort} title="stop">■</button>
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
		if (!text) return;
		textarea.value = "";
		textarea.style.height = "auto";
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
