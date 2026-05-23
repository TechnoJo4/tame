import { LitElement, html } from "lit";

export class TameMarkdown extends LitElement {
	static properties = { text: { type: String } };
	declare text: string;

	createRenderRoot() { return this; }

	render() { return html``; }

	updated(changed: Map<string, unknown>) {
		if (changed.has("text")) {
			this.innerHTML = this.#renderMd(this.text ?? "");
		}
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
			const processed = para.replace(
				/`([^`]+)`/g,
				(_, code: string) => `<code>${this.#escape(code)}</code>`,
			);
			parts.push(`<p>${processed}</p>`);
		};

		const flushCode = () => {
			const code = buf.join("\n").trim();
			buf = [];
			parts.push(`<pre><code>${this.#escape(code)}</code></pre>`);
		};

		for (const line of lines) {
			const isFence = line.trim().startsWith("```");
			if (!inCode) {
				if (isFence) { flushPara(); inCode = true; }
				else if (line.trim() === "") { flushPara(); }
				else { buf.push(line); }
			} else {
				if (isFence) { flushCode(); inCode = false; }
				else { buf.push(line); }
			}
		}
		if (inCode) flushCode();
		else flushPara();

		return parts.join("");
	}

	#escape(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
customElements.define("tame-markdown", TameMarkdown);
