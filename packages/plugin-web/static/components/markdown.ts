import { LitElement, html } from "lit";

export class TameMarkdown extends LitElement {
	text!: string;

	createRenderRoot() { return this; }

	render() {
		// minimal markdown — paragraphs and code. good enough for mvp.
		const html2 = this.#renderMd(this.text ?? "");
		return html`<div style="line-height:1.5;word-break:break-word">${html2}</div>`;
	}

	#renderMd(text: string) {
		// split on double newlines for paragraphs
		const paragraphs = text.split(/\n\n+/);
		const parts: string[] = [];
		for (const p of paragraphs) {
			const trimmed = p.trim();
			if (!trimmed) continue;
			// code blocks: ``` ... ```
			if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
				const code = trimmed.slice(3, -3).replace(/^\S*\n?/, "").trim();
				parts.push(`<pre style="background:#0a0a14;padding:8px;border-radius:4px;overflow-x:auto;font-size:13px"><code>${this.#escape(code)}</code></pre>`);
			} else {
				// inline code: `...`
				const processed = trimmed.replace(/`([^`]+)`/g, '<code style="background:#0a0a14;padding:1px 4px;border-radius:2px;font-size:13px">$1</code>');
				parts.push(`<p style="margin:4px 0">${processed}</p>`);
			}
		}
		return parts.join("");
	}

	#escape(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
customElements.define("tame-markdown", TameMarkdown);
