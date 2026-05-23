import { LitElement, html } from "lit";

export class TameMarkdown extends LitElement {
	text!: string;

	createRenderRoot() { return this; }

	render() {
		// minimal markdown — paragraphs and code. good enough for mvp.
		const md = this.#renderMd(this.text ?? "");
		// .innerHTML bypasses lit's escaping — #renderMd returns trusted html
		return html`<div style="line-height:1.5;word-break:break-word" .innerHTML=${md}></div>`;
	}

	// state-machine markdown — paragraphs and fenced code blocks. good enough.
	#renderMd(text: string) {
		const lines = text.split("\n");
		const parts: string[] = [];
		let inCode = false;
		let buf: string[] = [];

		const flushPara = () => {
			const para = buf.join("\n").trim();
			buf = [];
			if (!para) return;
			// inline code: `...` — escape contents
			const processed = para.replace(
				/`([^`]+)`/g,
				(_, code: string) =>
					`<code style="background:#0a0a14;padding:1px 4px;border-radius:2px;font-size:13px">${this.#escape(code)}</code>`,
			);
			parts.push(`<p style="margin:4px 0">${processed}</p>`);
		};

		const flushCode = () => {
			const code = buf.join("\n").trim();
			buf = [];
			parts.push(`<pre style="background:#0a0a14;padding:8px;border-radius:4px;overflow-x:auto;font-size:13px"><code>${this.#escape(code)}</code></pre>`);
		};

		for (const line of lines) {
			const isFence = line.trim().startsWith("```");
			if (!inCode) {
				if (isFence) {
					flushPara();
					inCode = true;
					// optional language tag after opening ``` — discard it
				} else if (line.trim() === "") {
					flushPara();
				} else {
					buf.push(line);
				}
			} else {
				if (isFence) {
					flushCode();
					inCode = false;
				} else {
					buf.push(line);
				}
			}
		}
		// trailing content
		if (inCode) flushCode();
		else flushPara();

		return parts.join("");
	}

	#escape(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
customElements.define("tame-markdown", TameMarkdown);
