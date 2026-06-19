import { createContext } from "@lit/context";
import type { Placement } from "./placement.ts";

/** Shell registry — static after connect. Components, placements, and
 *  stylesheets registered by plugins at init time. */
export interface Registry {
	placements: Placement[];
	/** Resolve a component tag name to its JS module URL for dynamic import. */
	getComponentSrc(tag: string): string | undefined;
}

export const registryContext = createContext<Registry | null>(
	Symbol("registry"),
);
