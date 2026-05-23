import { LitElement, html } from "lit";
import type { RPCController, MessageItem, TextOrThinking } from "../lib/rpc-controller.ts";

export class TameMessage extends LitElement {
	static properties = {
		item: { type: Object },
		controller: { type: Object },
	};

	declare item: MessageItem;
	declare controller: RPCController;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("item")) {
			this.dataset.role = this.item.role;
		}
	}

	render() {
		return html`
			<span class="role">${this.item.role}</span>
			${this.item.content.map((block) => this.#renderBlock(block))}
		`;
	}

	#renderBlock(block: TextOrThinking) {
		switch (block.type) {
			case "text":
				return html`<tame-markdown .text=${block.text}></tame-markdown>`;
			case "thinking":
				return html`<details class="thinking">
					<summary>thinking</summary>
					<tame-markdown .text=${block.thinking}></tame-markdown>
				</details>`;
			default:
				return html``;
		}
	}
}
customElements.define("tame-message", TameMessage);

// ---- <tame-tool-view> ----

class TameToolView extends LitElement {
	static properties = {
		controller: { type: Object },
		toolUseId: { type: String },
		toolName: { type: String },
		toolInput: { type: Object },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare controller: RPCController;
	declare toolUseId: string;
	declare toolName: string;
	declare toolInput: Record<string, unknown>;
	declare result: string | null;
	declare isError: boolean;

	#resolved: { tag: string; props: Record<string, unknown> } | null = null;
	#loaded = false;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#resolve();
	}

	async #resolve() {
		const result = await this.controller.viewToolCall(this.toolUseId);
		if (result?.tag) {
			this.#resolved = result;
			const src = this.controller.getComponentSrc(result.tag);
			if (src) {
				await import(src).catch(() => {});
			}
		}
		this.#loaded = true;
		this.requestUpdate();
	}

	render() {
		if (!this.#loaded) {
			return html`<div class="loading">loading tool view...</div>`;
		}
		if (!this.#resolved) {
			return html`<tame-tool-fallback
				.name=${this.toolName}
				.input=${this.toolInput}
				.result=${this.result ?? null}
				.isError=${this.isError}
			></tame-tool-fallback>`;
		}
		const { tag, props } = this.#resolved;
		const el = document.createElement(tag) as any;
		if (props) Object.assign(el, props);
		if (this.result !== undefined) {
			el.result = this.result;
			el.isError = this.isError;
		}
		return el;
	}
}
customElements.define("tame-tool-view", TameToolView);
