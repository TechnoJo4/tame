export interface RatelimitOptions {
    minDelay: number;
    errorMin: number;
    errorMax: number;
    errorExp: number;
}

export const defaultOptions: RatelimitOptions = {
    minDelay: 100, // 10req/s
    errorMin: 1_000,
    errorMax: 300_000,
    errorExp: 2,
};

export class Ratelimiter {
    #options: RatelimitOptions;

    #errors: number = 0;
    #nextReq: number = 0;
    #shouldQueue: boolean = false;
    #queue: (() => void)[] = [];

    constructor(options: Partial<RatelimitOptions> = {}) {
        this.#options = { ...defaultOptions, ...options };
    }

    /** Schedule next request */
    #schedule(wait: number) {
        const next = this.#queue.shift();
        if (next) {
            this.#shouldQueue = true;
            setTimeout(next, wait);
        } else {
            this.#nextReq = Date.now() + wait;
            this.#shouldQueue = false;
        }
    }

    /** Report an error response */
    error() {
        this.#errors++;
        this.#schedule(Math.min(this.#options.errorMax, Math.pow(this.#options.errorExp, this.#errors - 1) * this.#options.errorMin));
    }

    /** Report a success response */
    success() {
        this.#errors = 0;
        this.#schedule(this.#options.minDelay);
    }

    /** Report a response with a Retry-After header (usually a 429) */
    retryAfter(date: string) {
        const n = parseInt(date);
        this.#schedule(isNaN(n) ? new Date(date).getTime() - Date.now() : n * 1000);
    }

    /** Wait before sending a request. Callers must call success or error after their request. */
    async wait() {
        if (this.#queue.length !== 0 || this.#shouldQueue) {
            const p = Promise.withResolvers<void>();
            this.#queue.push(p.resolve);
            await p.promise;
        } else {
            this.#shouldQueue = true;
            if (this.#nextReq > Date.now())
                await new Promise(r => setTimeout(r, this.#nextReq - Date.now()))
        }
    }
}
