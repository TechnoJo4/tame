export interface BackoffOnlyOptions {
	errorMin: number;
	errorMax: number;
	errorExp: number;
}

export const defaultBackoffOnlyOptions: BackoffOnlyOptions = {
	errorMin: 1_000,
	errorMax: 300_000,
	errorExp: 2,
};

/**
 * A "ratelimiter" that does not actually limit the rate. Only applies
 * backoff delays after errors and honours Retry-After headers.
 *
 * Multiple concurrent callers may proceed simultaneously. Useful as a
 * fallback when the upstream provider does its own rate-limiting.
 */
export class BackoffOnlyRatelimiter {
    #options: BackoffOnlyOptions;
    #errors: number = 0;
    #retryAfterTime: number = 0;

    constructor(options: Partial<BackoffOnlyOptions> = {}) {
        this.#options = { ...defaultBackoffOnlyOptions, ...options };
    }

    error() {
        this.#errors++;
    }

    success() {
        this.#errors = 0;
    }

    retryAfter(date: string) {
        const n = parseInt(date);
        const retryTime = isNaN(n)
            ? new Date(date).getTime()
            : Date.now() + n * 1000;
        this.#retryAfterTime = Math.max(this.#retryAfterTime, retryTime);
    }

    delay(): number {
        const retryDelay = Math.max(0, this.#retryAfterTime - Date.now());
        if (this.#errors === 0) return retryDelay;
        const errorDelay = Math.min(
            this.#options.errorMax,
            Math.pow(this.#options.errorExp, this.#errors - 1) *
                this.#options.errorMin,
        );
        return Math.max(retryDelay, errorDelay);
    }

    async wait() {
        const d = this.delay();
        if (d > 0) {
            await new Promise((r) => setTimeout(r, d));
        }
    }
}