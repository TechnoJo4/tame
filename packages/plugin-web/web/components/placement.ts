import { LitElement } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { registryContext, type Registry } from "@tame/web-sdk";

class TamePlacement extends LitElement {
	@consume({ context: registryContext, subscribe: true })
	@property({ attribute: false }) registry: Registry | null = null;

	@property({ type: String }) location = "";

	#loaded = new Set<string>();

	override createRenderRoot() { return this; }

	override render() {
		const placements = this.registry?.placements?.filter(
			(p) => p.location === this.location,
		) ?? [];
		return placements.map((p) => {
			const src = this.registry?.getComponentSrc(p.tag);
			if (src && !this.#loaded.has(p.tag)) {
				this.#loaded.add(p.tag);
				import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
			}
			const el = document.createElement(p.tag) as any;
			customElements.whenDefined(p.tag).then(() => {
				if (p.props) Object.assign(el, p.props);
			});
			return el;
		});
	}
}
customElements.define("tame-web-placement", TamePlacement);
