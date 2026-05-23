import type { AssistantMessage, InferenceProvider, MessageRequest } from "@tame/sdk";

export class ExtraDataProvider implements InferenceProvider {
    underlying: InferenceProvider;
    extra: object;

    get defaultModel(): string | undefined {
        return this.underlying.defaultModel;
    }

    constructor(underlying: InferenceProvider, extra: object) {
        this.underlying = underlying;
        this.extra = extra;
    }

    complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
        return this.underlying.complete({ ...this.extra, ...req }, signal);
    }
}
