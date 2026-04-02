import { InferenceError } from "./error.ts";
import { InferenceProvider, AssistantMessage, MessageRequest } from "./types.ts";

export class AnthropicMessagesProvider implements InferenceProvider {
    #url: string;
    #headers: Record<string, string>;
    defaultModel?: string;

    constructor(url: string, key: string, headers?: Record<string, string>, defaultModel?: string) {
        this.#url = url;
        this.#headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": key,
            "Authorization": `Bearer ${key}`,
            ...headers
        };
        this.defaultModel = defaultModel;
    }

    async complete(req: MessageRequest): Promise<AssistantMessage> {
        req.model ??= this.defaultModel;
    	const res = await fetch(this.#url, {
            method: "POST",
            headers: this.#headers,
            body: JSON.stringify(req)
        });
        const data = await res.json();
        if (res.ok && data.type === "message")
            return data;
        throw new InferenceError(res, data);
    }
}
