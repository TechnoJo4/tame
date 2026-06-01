import { LitElement } from "lit";
import { property } from "lit/decorators.js";
import type { RPCController } from "../lib/rpc-controller.ts";

class TamePlacement extends LitElement {
    @property({ type: String }) location!: string;
    @property({ type: Object }) controller!: RPCController;
    #loaded = new Set<string>();

    override createRenderRoot() { return this; }

    override render() {
        const placements = this.controller?.getPlacements(this.location) ?? [];
        return placements.map((p) => {
            const src = this.controller?.getComponentSrc(p.tag);
            if (src && !this.#loaded.has(p.tag)) {
                this.#loaded.add(p.tag);
                import(src).catch((e) => console.error(`failed to load ${p.tag}:`, e));
            }
            const el = document.createElement(p.tag) as any;
            customElements.whenDefined(p.tag).then(() => {
                el.controller = this.controller;
                if (p.props) Object.assign(el, p.props);
            });
            return el;
        });
    }
}
customElements.define("tame-web-placement", TamePlacement);
