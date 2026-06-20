import { LitElement, html } from "lit";
import { until } from "lit/directives/until.js";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { registryContext, type Registry } from "@tame/web-sdk";

class TamePlacement extends LitElement {
	@consume({ context: registryContext, subscribe: true })
	@property({ attribute: false }) declare registry: Registry | null;

	@property({ type: String }) location = "";

	/** Modules that have finished loading (or failed — either way, stop retrying). */
	#loaded = new Set<string>();
	/** In-flight load promises. */
	#loading = new Map<string, Promise<void>>();
	/** Created elements, keyed by tag. Stable across renders. */
	#elements = new Map<string, HTMLElement>();

	override createRenderRoot() { return this; }

	override render() {
		const placements = this.registry?.placements?.filter(
			(p) => p.location === this.location,
		) ?? [];
		return placements.map((p) => {
			const src = this.registry?.getComponentSrc(p.tag);
			if (!src) return html``;

			// already have a stable element? return it directly
			const cached = this.#elements.get(p.tag);
			if (cached) return cached;

			// module already loaded (or failed) — create element synchronously.
			// the class is defined, so no two-phase upgrade.
			if (this.#loaded.has(p.tag)) {
				const el = this.#make(p);
				this.#elements.set(p.tag, el);
				return el;
			}

			// module not loaded yet — start loading, use until() to wait
			const promise = this.#ensureLoaded(p.tag, src).then(() => {
				// after load resolves, check cache (a previous resolution may have
				// already populated it via a re-render)
				const existing = this.#elements.get(p.tag);
				if (existing) return existing;
				const el = this.#make(p);
				this.#elements.set(p.tag, el);
				return el;
			});

			return until(promise, html``);
		});
	}

	#make(p: { tag: string; props?: Record<string, unknown> }) {
		const el = document.createElement(p.tag) as HTMLElement;
		if (p.props) Object.assign(el, p.props);
		return el;
	}

	#ensureLoaded(tag: string, src: string): Promise<void> {
		const existing = this.#loading.get(tag);
		if (existing) return existing;
		const p = import(src)
			.then(() => { this.#loaded.add(tag); })
			.catch((e) => {
				console.error(`failed to load ${tag}:`, e);
				this.#loaded.add(tag); // mark loaded so we stop retrying
			});
		this.#loading.set(tag, p);
		return p;
	}
}
customElements.define("tame-web-placement", TamePlacement);
