import { Ratelimiter } from "./ratelimit.ts";

export interface SerialRatelimitOptions {
	minDelay: number;
	errorMin: number;
	errorMax: number;
	errorExp: number;
}

export const defaultOptions: SerialRatelimitOptions = {
	minDelay: 100,
	errorMin: 1_000,
	errorMax: 300_000,
	errorExp: 2,
};

export class SerialRatelimiter implements Ratelimiter {
	#options: SerialRatelimitOptions;

	#errors: number = 0;
	#nextReq: number = 0;
	#shouldQueue: boolean = false;
	#queue: (() => void)[] = [];

	constructor(options: Partial<SerialRatelimitOptions> = {}) {
		this.#options = { ...defaultOptions, ...options };
	}

	/** Schedule next request */
	#schedule(wait: number) {
		this.#nextReq = Date.now() + wait;
		const next = this.#queue.shift();
		if (next) {
			this.#shouldQueue = true;
			setTimeout(next, wait);
		} else {
			this.#shouldQueue = false;
		}
	}

	error() {
		this.#errors++;
		this.#schedule(Math.min(this.#options.errorMax, Math.pow(this.#options.errorExp, this.#errors - 1) * this.#options.errorMin));
	}

	success() {
		this.#errors = 0;
		this.#schedule(this.#options.minDelay);
	}

	retryAfter(date: string) {
		const n = parseInt(date);
		this.#schedule(
			isNaN(n) ? new Date(date).getTime() - Date.now() : n * 1000,
		);
	}

	delay(): number {
		return Math.max(0, this.#nextReq - Date.now());
	}

	async wait() {
		if (this.#shouldQueue) {
			const p = Promise.withResolvers<void>();
			this.#queue.push(p.resolve);
			await p.promise;
		} else {
			this.#shouldQueue = true;
			if (this.#nextReq > Date.now()) {
				await new Promise((r) =>
					setTimeout(r, this.#nextReq - Date.now()),
				);
			}
		}
	}
}

