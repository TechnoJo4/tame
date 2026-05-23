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

	render() {
		const role = this.message.role;
		return html`
			<div style="margin-bottom:16px;padding:8px;border-radius:4px;${role === "user" ? "background:#1a1a2e" : ""}">
				<div style="font-size:11px;color:#888;margin-bottom:4px">${role}</div>
				${this.message.content.map((block) => this.#renderBlock(block))}
			</div>
		`;
	}

	#renderBlock(block: ContentBlock) {
		switch (block.type) {
			case "text":
				return html`<tame-markdown .text=${block.text}></tame-markdown>`;
			case "thinking":
				return html`<details style="color:#888;font-style:italic;margin:8px 0">
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
				return html`<div style="margin:4px 0;padding:8px;border-left:2px solid ${block.is_error ? "#f66" : "#6f6"};background:#111">
					<pre style="white-space:pre-wrap;font-size:12px;margin:0">${block.content}</pre>
				</div>`;
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
			return html`<div style="padding:8px;color:#888">loading tool view...</div>`;
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
