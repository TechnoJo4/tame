import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { registryContext, type Registry } from "@tame/web-sdk";
import { settingsStoreContext } from "../lib/settings-context.ts";
import type { SettingsStore } from "@tame/web-sdk";
import type { MessageItem, TextOrThinking } from "@tame/web-sdk";

const SETTINGS_PLUGIN = "web";
const FORMAT_KEYS: Record<string, string> = {
	user: "userFormat",
	assistant: "assistantFormat",
};

export class TameMessage extends LitElement {
	@property({ type: Object }) item!: MessageItem;

	@consume({ context: settingsStoreContext })
	@property({ attribute: false })
	store: SettingsStore | undefined;

	#formatUnsub: (() => void) | null = null;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
		this.#subscribeFormat();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.#formatUnsub?.();
		this.#formatUnsub = null;
	}

	override willUpdate(changed: Map<string, unknown>) {
		if (changed.has("item")) {
			this.dataset.role = this.item.role;
			this.#subscribeFormat();
		}
		if (changed.has("store") && this.store) {
			this.#subscribeFormat();
		}
	}

	#subscribeFormat() {
		if (!this.store) return;
		this.#formatUnsub?.();
		const key = FORMAT_KEYS[this.item.role] ?? "assistantFormat";
		this.#formatUnsub = this.store.onChange(
			SETTINGS_PLUGIN, key, () => this.requestUpdate(),
		);
	}

	#formatForRole(): string {
		const key = FORMAT_KEYS[this.item.role] ?? "assistantFormat";
		return this.store?.get(SETTINGS_PLUGIN, key) || "markdown";
	}

	override render() {
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
		const format = this.#formatForRole();
		switch (block.type) {
			case "text":
				if (format === "raw") {
					return html`<pre>${block.text}</pre>`;
				}
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
	@consume({ context: registryContext, subscribe: true })
	@property({ attribute: false }) registry: Registry | null = null;

	@property({ type: String }) toolUseId = "";
	@property({ type: String }) toolName = "";
	@property({ type: Object }) toolInput: Record<string, unknown> = {};
	@property({ type: String }) result: string | null = null;
	@property({ type: Boolean }) isError = false;
	/** Pre-resolved view metadata from the server. When set, the component
	 *  is created directly without an RPC round-trip. */
	@property({ type: Object }) view: { tag: string; props: Record<string, unknown> } | null = null;

	#loaded = false;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
		this.#resolve();
	}

	async #resolve() {
		if (this.view?.tag) {
			const src = this.registry?.getComponentSrc(this.view.tag);
			if (src) await import(src).catch(() => {});
		}
		this.#loaded = true;
		this.requestUpdate();
	}

	override render() {
		if (!this.#loaded) {
			return html`<div class="loading">loading tool view...</div>`;
		}
		if (this.view?.tag) {
			const { tag, props } = this.view;
			const el = document.createElement(tag) as any;
			if (props) Object.assign(el, props);
			if (this.result !== undefined) {
				el.result = this.result;
				el.isError = this.isError;
			}
			return el;
		}
		return html`<tame-web-tool-fallback
			.name=${this.toolName}
			.input=${this.toolInput}
			.result=${this.result ?? null}
			.isError=${this.isError}
		></tame-web-tool-fallback>`;
	}
}
customElements.define("tame-web-tool-view", TameToolView);
