import { InferenceError } from "./error.ts";
import { InferenceProvider, AssistantMessage, MessageRequest } from "./types.ts";

export class AnthropicMessagesProvider implements InferenceProvider {
    #url: string;
    #headers: Record<string, string>;
    defaultModel?: string;

    constructor(url: string, key?: string, headers?: Record<string, string>, defaultModel?: string) {
        this.#url = url;
        this.#headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            ...headers
        };
        if (key) {
            this.#headers["x-api-key"] ??= key;
            this.#headers["Authorization"] ??= `Bearer ${key}`;
        }
        this.defaultModel = defaultModel;
    }

    async complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
    	const res = await fetch(this.#url, {
            method: "POST",
            headers: this.#headers,
            body: JSON.stringify({
                model: this.defaultModel,
                ...req
            }),
            signal
        });
        const data = await res.json();
        if (res.ok && data.type === "message")
            return data;
        throw new InferenceError(res, data);
    }
}
