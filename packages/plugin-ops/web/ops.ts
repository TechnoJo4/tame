import { LitElement, html } from "lit";

// ---- shared helpers ----

const truncate = (s: string, n: number): string =>
	s.length <= n ? s : s.slice(0, n) + "…";

const contractHome = (path: string): string => {
	const home = "/home/coder";
	if (path === home) return "~";
	if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
	return path;
};

// ---- tame-ops-read ----

export class TameOpsRead extends LitElement {
	static properties = {
		path: { type: String },
		offset: { type: Number },
		limit: { type: Number },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare offset?: number;
	declare limit?: number;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		const range = this.offset || this.limit
			? ` [${this.offset ? `L${this.offset}` : ""}${this.limit ? `+${this.limit}` : ""}]`
			: "";
		return html`
			<span class="ops-label">read ${contractHome(this.path)}${range}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre class="ops-content${this.isError ? " error" : ""}">${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-read", TameOpsRead);

// ---- tame-ops-write ----

export class TameOpsWrite extends LitElement {
	static properties = {
		path: { type: String },
		content: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare content: string;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">write ${contractHome(this.path)}</span>
			${this.content ? html`
				<pre class="ops-content">${truncate(this.content, 1000)}</pre>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span class="ops-status${this.isError ? " error" : ""}">${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-write", TameOpsWrite);

// ---- tame-ops-edit ----

export class TameOpsEdit extends LitElement {
	static properties = {
		path: { type: String },
		oldString: { type: String },
		newString: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare path: string;
	declare oldString: string;
	declare newString: string;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">edit ${contractHome(this.path)}</span>
			${this.oldString ? html`
				<div class="ops-diff">
					<pre class="ops-diff-old">− ${truncate(this.oldString, 200)}</pre>
					<pre class="ops-diff-new">+ ${truncate(this.newString, 200)}</pre>
				</div>
			` : html``}
			${this.result !== null && this.result !== undefined ? html`
				<span class="ops-status${this.isError ? " error" : ""}">${this.result}</span>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-edit", TameOpsEdit);

// ---- tame-ops-exec ----

export class TameOpsExec extends LitElement {
	static properties = {
		command: { type: String },
		workdir: { type: String },
		result: { type: String },
		isError: { type: Boolean },
	};

	declare command: string;
	declare workdir?: string;
	declare result: string | null;
	declare isError: boolean;

	createRenderRoot() { return this; }

	render() {
		return html`
			<span class="ops-label">exec <code>${this.command ?? "?"}</code>${this.workdir ? ` in ${contractHome(this.workdir)}` : ""}</span>
			${this.result !== null && this.result !== undefined ? html`
				<pre class="ops-content${this.isError ? " error" : ""}">${this.result}</pre>
			` : html``}
		`;
	}
}
customElements.define("tame-ops-exec", TameOpsExec);

// ---- tame-ops-files (file explorer for sidebar) ----

interface DirEntry {
	name: string;
	isDir: boolean;
	size: number;
}

interface DirListing {
	path: string;
	name: string;
	entries: DirEntry[];
}

export class TameOpsFiles extends LitElement {
	static properties = { controller: { type: Object } };
	declare controller: { client: { call(plugin: string, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>; subscribe(filter: Record<string, unknown>, cb: (msg: { data: Record<string, unknown> }) => void): () => void } | null };

	#tree: DirListing | null = null;
	#expanded = new Set<string>();
	#preview: { path: string; content: string } | null = null;
	#loading = "";
	#loaded = false;
	#unsub: (() => void) | null = null;
	#cwd = "/home/coder";

	createRenderRoot() { return this; }

	connectedCallback() {
		super.connectedCallback();
		this.#subscribe();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.#unsub?.();
		this.#unsub = null;
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("controller") && this.controller?.client && !this.#loaded) {
			this.#loaded = true;
			this.#refresh();
		}
	}

	#subscribe() {
		const client = this.controller?.client;
		if (!client) return;
		this.#unsub = client.subscribe(
			{ plugin: "ops", event: "fileAccessed" },
			() => this.#refresh(),
		);
	}

	async #refresh() {
		const client = this.controller?.client;
		if (!client) return;
		this.#loading = "loading...";
		this.requestUpdate();
		try {
			const result = await client.call("ops", "listDir", { path: this.#cwd });
			this.#tree = result as unknown as DirListing;
		} catch (e) {
			console.error("tame-ops-files: failed to list dir", e);
		} finally {
			this.#loading = "";
			this.requestUpdate();
		}
	}

	async #toggleDir(path: string) {
		if (this.#expanded.has(path)) {
			this.#expanded.delete(path);
			this.requestUpdate();
			return;
		}
		const client = this.controller?.client;
		if (!client) return;
		try {
			const result = await client.call("ops", "listDir", { path });
			(this as any)[`_sub_${path}`] = result;
			this.#expanded.add(path);
			this.requestUpdate();
		} catch (e) {
			console.error("tame-ops-files: failed to list subdir", e);
		}
	}

	async #previewFile(path: string) {
		const client = this.controller?.client;
		if (!client) return;
		try {
			const result = await client.call("ops", "readFile", { path });
			this.#preview = { path, content: (result as any).content ?? "" };
			this.requestUpdate();
		} catch (e) {
			this.#preview = { path, content: `error reading file: ${e}` };
			this.requestUpdate();
		}
	}

	#closePreview() {
		this.#preview = null;
		this.requestUpdate();
	}

	render() {
		return html`
			<div class="files-header">
				<span class="files-title">files</span>
				<button class="files-refresh" @click=${this.#refresh} title="refresh">↻</button>
			</div>
			${this.#loading ? html`<div class="files-loading">${this.#loading}</div>` : this.#renderTree()}
			${this.#preview ? this.#renderPreview() : html``}
		`;
	}

	#renderTree() {
		if (!this.#tree) return html`<div class="files-empty">no files</div>`;
		return html`<div class="files-tree">${this.#renderDir(this.#tree)}</div>`;
	}

	#renderDir(dir: DirListing, depth = 0) {
		const isExpanded = depth === 0 || this.#expanded.has(dir.path);
		return html`
			${depth > 0 ? html`
				<button class="files-dir${isExpanded ? " open" : ""}"
					style="padding-left: ${depth * 12 + 4}px"
					@click=${() => this.#toggleDir(dir.path)}>
					${isExpanded ? "▾" : "▸"} ${dir.name}/
				</button>
			` : html``}
			${isExpanded ? (dir.entries ?? []).map((e: DirEntry) => {
				const fullPath = dir.path + "/" + e.name;
				if (e.isDir) {
					const sub = (this as any)[`_sub_${fullPath}`] as DirListing | undefined;
					if (sub) return this.#renderDir(sub, depth + 1);
					return html`
						<button class="files-dir"
							style="padding-left: ${(depth + 1) * 12 + 4}px"
							@click=${() => this.#toggleDir(fullPath)}>
							▸ ${e.name}/
						</button>
					`;
				}
				return html`
					<button class="files-file"
						style="padding-left: ${(depth + 1) * 12 + 4}px"
						@click=${() => this.#previewFile(fullPath)}>
						${e.name}
						<span class="files-size">${this.#fmtSize(e.size)}</span>
					</button>
				`;
			}) : html``}
		`;
	}

	#renderPreview() {
		if (!this.#preview) return html``;
		const p = this.#preview;
		return html`
			<div class="files-preview">
				<div class="files-preview-header">
					<span class="files-preview-path">${p.path.split("/").pop()}</span>
					<button class="files-preview-close" @click=${this.#closePreview}>×</button>
				</div>
				<pre class="files-preview-content">${p.content}</pre>
			</div>
		`;
	}

	#fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
	}
}
customElements.define("tame-ops-files", TameOpsFiles);
