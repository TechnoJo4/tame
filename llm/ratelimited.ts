import { Ratelimiter } from "../util/ratelimit.ts";
import { InferenceError } from "./error.ts";
import { AssistantMessage, InferenceProvider, MessageRequest } from "./types.ts";

export class RatelimitedProvider implements RatelimitedProvider {
    underlying: InferenceProvider;
    limiter: Ratelimiter;

    constructor(underlying: InferenceProvider, limiter: Ratelimiter) {
        this.underlying = underlying;
        this.limiter = limiter;
    }

    async complete(req: MessageRequest): Promise<AssistantMessage> {
        await this.limiter.wait();
        try {
            const res = await this.underlying.complete(req);
            this.limiter.success();
            return res;
        } catch (e) {
            if (e instanceof InferenceError) {
                const retryAfter = e.response.headers.get("Retry-After");
                if (retryAfter) {
					this.limiter.retryAfter(retryAfter);
                    throw e;
                }
            }
            this.limiter.error();
            throw e;
        }
    }

    delay(): Promise<number> {
        return Promise.resolve(this.limiter.delay());
    }
}
