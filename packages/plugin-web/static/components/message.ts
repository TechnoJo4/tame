import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController, MessageItem, TextOrThinking } from "../lib/rpc-controller.ts";

export class TameMessage extends LitElement {
	@property({ type: Object }) item: MessageItem;
	@property({ type: Object }) controller: RPCController;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("item")) {
			this.dataset.role = this.item.role;
		}
	}

	render() {
		const visible = this.item.content.filter((block) => {
			if (block.type === "thinking") return block.thinking?.trim();
			return true;
		});
		if (visible.length === 0) return html``;
		return html`
			<span class="role">${this.item.role}</span>
			${visible.map((block) => this.#renderBlock(block))}
		`;
	}

	#renderBlock(block: TextOrThinking) {
		switch (block.type) {
			case "text":
				return html`<tame-web-markdown .text=${block.text}></tame-web-markdown>`;
			case "thinking":
				if (!block.thinking?.trim()) return html``;
				return html`<details class="thinking">
					<summary>thinking</summary>
					<tame-web-markdown .text=${block.thinking}></tame-web-markdown>
				</details>`;
			default:
				return html``;
		}
	}
}
customElements.define("tame-web-message", TameMessage);

// ---- <tame-web-tool-view> ----

class TameToolView extends LitElement {
	@property({ type: Object }) controller: RPCController;
	@property({ type: String }) toolUseId: string;
	@property({ type: String }) toolName: string;
	@property({ type: Object }) toolInput: Record<string, unknown>;
	@property({ type: String }) result: string | null;
	@property({ type: Boolean }) isError: boolean;

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
			return html`<tame-web-tool-fallback
				.name=${this.toolName}
				.input=${this.toolInput}
				.result=${this.result ?? null}
				.isError=${this.isError}
			></tame-web-tool-fallback>`;
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
customElements.define("tame-web-tool-view", TameToolView);
