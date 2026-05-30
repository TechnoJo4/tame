import { LitElement, html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { property } from "lit/decorators.js";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";

// ---- mdast node types we handle ----

interface MdNode {
	type: string;
	children?: MdNode[];
	value?: string;
	depth?: number;
	lang?: string | null;
	url?: string;
	title?: string | null;
	alt?: string;
	ordered?: boolean;
	start?: number | null;
	spread?: boolean;
	checked?: boolean | null;
	identifier?: string;
	label?: string;
	referenceType?: string;
	// annotated by #annotateTables
	_align?: string | null;
	_header?: boolean;
}

export class TameMarkdown extends LitElement {
	@property({ type: String }) text!: string;

	#root: MdNode | null = null;

	override createRenderRoot() { return this; }

	override render() {
		if (!this.#root) return html``;
		return this.#renderNode(this.#root);
	}

	override willUpdate(changed: Map<string, unknown>) {
		if (changed.has("text")) {
			try {
				const root = fromMarkdown(this.text ?? "", {
					extensions: [gfmTable()],
					mdastExtensions: [gfmTableFromMarkdown()],
				}) as unknown as MdNode;
				this.#annotateTables(root);
				this.#root = root;
			} catch {
				this.#root = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: this.text ?? "" }] }] };
			}
		}
	}

	// Annotate table cells with alignment and header flag so #renderNode
	// doesn't need to thread parent context through the recursive walk.
	#annotateTables(root: MdNode) {
		const walk = (node: MdNode, inHead: boolean) => {
			if (node.type === "table" && node.children) {
				const align = (node as unknown as { align?: (string | null)[] }).align;
				for (const section of node.children) {
					if (section.children) {
						for (const row of section.children) {
							if (row.type === "tableRow" && row.children && align) {
								for (let i = 0; i < row.children.length; i++) {
									const cell = row.children[i];
									cell._align = align[i] ?? null;
									cell._header = section.type === "tableHead";
								}
							}
						}
					}
				}
			}
			if (node.children) {
				for (const child of node.children) walk(child, false);
			}
		};
		walk(root, false);
	}

	// ---- mdast → Lit templates ----

	#renderNode(node: MdNode | string): unknown {
		if (typeof node === "string") return html`${node}`;

		switch (node.type) {
			case "root":
				return html`${(node.children ?? []).map((c) => this.#renderNode(c))}`;

			case "paragraph":
				return html`<p>${(node.children ?? []).map((c) => this.#renderNode(c))}</p>`;

			case "heading":
				return this.#heading(node);

			case "code":
				return html`<pre><code data-language=${node.lang ?? ""}>${node.value ?? ""}</code></pre>`;

			case "inlineCode":
				return html`<code>${node.value ?? ""}</code>`;

			case "emphasis":
				return html`<em>${(node.children ?? []).map((c) => this.#renderNode(c))}</em>`;

			case "strong":
				return html`<strong>${(node.children ?? []).map((c) => this.#renderNode(c))}</strong>`;

			case "delete":
				return html`<del>${(node.children ?? []).map((c) => this.#renderNode(c))}</del>`;

			case "link":
				return html`<a href=${node.url ?? ""} title=${node.title ?? ""}>${(node.children ?? []).map((c) => this.#renderNode(c))}</a>`;

			case "image":
				return html`<img src=${node.url ?? ""} alt=${node.alt ?? ""} title=${node.title ?? ""}>`;

			case "list":
				return this.#list(node);

			case "listItem":
				return html`<li>${(node.children ?? []).map((c) => this.#renderNode(c))}</li>`;

			case "table":
				return html`<table>${(node.children ?? []).map((c) => this.#renderNode(c))}</table>`;

			case "tableRow":
				return html`<tr>${(node.children ?? []).map((c) => this.#renderNode(c))}</tr>`;

			case "tableCell": {
				const style = node._align
					? `text-align: ${node._align}`
					: "";
				return html`<td style=${style} ?data-header=${node._header === true}>${(node.children ?? []).map((c) => this.#renderNode(c))}</td>`;
			}

			case "blockquote":
				return html`<blockquote>${(node.children ?? []).map((c) => this.#renderNode(c))}</blockquote>`;

			case "thematicBreak":
				return html`<hr>`;

			case "break":
				return html`<br>`;

			case "text":
				return html`${node.value ?? ""}`;

			case "html":
				return unsafeHTML(node.value ?? "");

			default:
				// passthrough: render children if any, otherwise just the value
				if (node.children) {
					return html`${node.children.map((c) => this.#renderNode(c))}`;
				}
				return html`${node.value ?? ""}`;
		}
	}

	#heading(node: MdNode) {
		const kids = (node.children ?? []).map((c) => this.#renderNode(c));
		switch (node.depth) {
			case 1: return html`<h1>${kids}</h1>`;
			case 2: return html`<h2>${kids}</h2>`;
			case 3: return html`<h3>${kids}</h3>`;
			case 4: return html`<h4>${kids}</h4>`;
			case 5: return html`<h5>${kids}</h5>`;
			case 6: return html`<h6>${kids}</h6>`;
			default: return html`<h3>${kids}</h3>`;
		}
	}

	#list(node: MdNode) {
		const kids = (node.children ?? []).map((c) => this.#renderNode(c));
		if (node.ordered) {
			const start = node.start != null && node.start !== 1 ? node.start : null;
			return html`<ol start=${start}>${kids}</ol>`;
		}
		return html`<ul>${kids}</ul>`;
	}
}
customElements.define("tame-web-markdown", TameMarkdown);
