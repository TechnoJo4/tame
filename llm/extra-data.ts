import { AssistantMessage, InferenceProvider, MessageRequest } from "./types.ts";

export class ExtraDataProvider implements InferenceProvider {
    underlying: InferenceProvider;
    extra: object;

    constructor(underlying: InferenceProvider, extra: object) {
        this.underlying = underlying;
        this.extra = extra;
    }

    complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
        return this.underlying.complete({ ...this.extra, ...req }, signal);
    }
}
