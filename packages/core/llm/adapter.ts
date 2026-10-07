import type {AssistantMessage, InferenceProvider, MessageRequest} from "@tame/sdk";

export class AdapterProvider implements InferenceProvider {
	underlying: InferenceProvider;
	adapter: (req: MessageRequest) => MessageRequest;

	get defaultModel(): string|undefined { return this.underlying.defaultModel; }

	constructor(underlying: InferenceProvider, adapter: (req: MessageRequest) => MessageRequest) {
		this.underlying = underlying;
		this.adapter = adapter;
	}

	complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
		return this.underlying.complete(this.adapter(req), signal);
	}
}
