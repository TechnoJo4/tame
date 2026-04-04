import { RatelimitedProvider } from "./ratelimited.ts";
import {
	AssistantMessage,
	InferenceProvider,
	MessageRequest,
} from "./types.ts";

export class PriorityProvider implements InferenceProvider {
	underlying: (InferenceProvider | RatelimitedProvider)[];
	maxDelay: number;

	constructor(underlying: InferenceProvider[], maxDelay: number = 100) {
		this.underlying = underlying;
		this.maxDelay = maxDelay;
	}

	async complete(req: MessageRequest): Promise<AssistantMessage> {
		const skipped: [InferenceProvider, number][] = [];
		for (const provider of this.underlying) {
			if ("delay" in provider) {
				const delay = await provider.delay();
				if (delay > this.maxDelay) {
					skipped.push([provider, delay]);
					continue;
				}
			}

			try {
				return await provider.complete(req);
			} catch (e) {
				console.error("error in inference request:", req, e);
			}
		}

		skipped.sort(([_a, a], [_b, b]) => a - b);
		for (const [provider, _] of skipped) {
			try {
				return await provider.complete(req);
			} catch (e) {
				console.error("error in inference request:", req, e);
			}
		}

		throw new Error("no inference provider available");
	}
}
