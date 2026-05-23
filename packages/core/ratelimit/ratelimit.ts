export interface Ratelimiter {
	/** Report an error response */
	error(): void;
	/** Report a success response */
	success(): void;
	/** Report a response with a Retry-After header (usually a 429) */
	retryAfter(date: string): void;
	/** How long a request would have to wait if wait() was called. */
	delay(): number;
	/** Wait before sending a request. Callers must call success or error after their request. */
	wait(): Promise<void>;
}
