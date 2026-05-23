import type { IAgent } from "./interfaces.ts";
import type { IHarness } from "./interfaces.ts";

export interface Plugin {
	id: string;
	enabled?: true;
	init?: (harness: IHarness) => void;
	newAgent?: (agent: IAgent) => void;
}
