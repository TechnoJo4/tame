import { LitElement, html } from "lit";
import type { RPCController, Message, ContentBlock } from "../lib/rpc-controller.ts";

export class TameMessage extends LitElement {
	static properties = {
		message: { type: Object },
		index: { type: Number },
		controller: { type: Object },
	};

	declare message: Message;
	declare index: number;
	declare controller: RPCController;

	createRenderRoot() { return this; }

	willUpdate(changed: Map<string, unknown>) {
		if (changed.has("message")) {
			this.dataset.role = this.message.role;
		}
	}

	render() {
		const role = this.message.role;
		return html`
			<span class="role">${role}</span>
			${this.message.content.map((block) => this.#renderBlock(block))}
		`;
	}

	#renderBlock(block: ContentBlock) {
		switch (block.type) {
			case "text":
				return html`<tame-markdown .text=${block.text}></tame-markdown>`;
			case "thinking":
				return html`<details class="thinking">
					<summary>thinking</summary>
					<tame-markdown .text=${block.thinking}></tame-markdown>
				</details>`;
			case "tool_use":
				return html`<tame-tool-view
					.controller=${this.controller}
					.toolUseId=${block.id}
					.toolName=${block.name}
					.toolInput=${block.input}
				></tame-tool-view>`;
			case "tool_result":
				return html`<tame-tool-result
					.content=${block.content}
					.isError=${block.is_error}
				></tame-tool-result>`;
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
	};

	declare controller: RPCController;
	declare toolUseId: string;
	declare toolName: string;
	declare toolInput: Record<string, unknown>;

	#resolved: { tag: string; props: Record<string, unknown> } | null = null;
	#loaded = false;

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#resolve();
	}

	async #resolve() {
		const result = await this.controller.viewToolCall(this.toolUseId);
		if (result) {
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
			return html`<tame-tool-fallback .name=${this.toolName} .input=${this.toolInput}></tame-tool-fallback>`;
		}
		const { tag, props } = this.#resolved;
		const el = document.createElement(tag) as any;
		if (props) Object.assign(el, props);
		return el;
	}
}
customElements.define("tame-tool-view", TameToolView);
