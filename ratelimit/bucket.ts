
export interface TokenBucketOptions {
	/** Requests per second */
	rps: number;
	/** Max requests without waiting (burst capacity) */
	maxBurst: number;
	/** Each error consumes this many additional tokens for automatic backoff */
	errorMultiplier: number;
}

export const defaultTokenBucketOptions: TokenBucketOptions = {
	rps: 1,
	maxBurst: 1,
	errorMultiplier: 5,
};

export class TokenBucketRatelimiter {
    #increment: number;
    #errIncrement: number;
    #maxDiff: number;
    #next: number;

    constructor(options: Partial<TokenBucketOptions> = {}) {
        const opts = { ...defaultTokenBucketOptions, ...options };
        this.#increment = 1/opts.rps;
        this.#errIncrement = this.#increment * (opts.errorMultiplier - 1);
        this.#maxDiff = this.#increment * opts.maxBurst;
        this.#next = this.#min();
    }

    #min() {
        return Date.now() - this.#maxDiff;
    }

    error() {
        this.#next = Math.max(this.#min(), this.#next) + this.#errIncrement;
    }

    success() {
        // nothing; incremented in wait()
    }

    retryAfter(date: string) {
        const n = parseInt(date);
        const retryTime = isNaN(n)
            ? new Date(date).getTime()
            : Date.now() + n * 1000;
        this.#next = Math.max(this.#next, retryTime);
    }

    delay(): number {
		return Math.max(0, this.#next - Date.now());
    }

    async wait() {
        this.#next = Math.max(this.#min(), this.#next) + this.#increment;
        const wait = this.delay();
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
    }
}