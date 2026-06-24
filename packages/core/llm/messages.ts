import { InferenceError } from "./error.ts";
import { tameMsgMeta, tameContentMeta, stripMessage, type InferenceProvider, type AssistantMessage, type MessageRequest, type Content, type InputMessage } from "@tame/sdk";

export class AnthropicMessagesProvider implements InferenceProvider {
    #url: string;
    #headers: Record<string, string>;
    defaultModel = "";

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
        if (defaultModel)
            this.defaultModel = defaultModel;
    }

    #convertContent(content: Content): Content {
        const res = {
            ...content,
            ...content[tameContentMeta]?.providerData
        };
        if (res.type === "tool_use")
            delete res["result"];
        return res;
    }

    #convertMessage(message: InputMessage): InputMessage {
        // stop_reason/model/usage discarded here
        return {
            role: message.role,
            content: message.content.map(this.#convertContent),
            ...message[tameMsgMeta]?.providerData
        };
    }

    #convertMessages(messages: InputMessage[]): object[] {
        const res = [];
        for (const m of messages) {
            res.push(this.#convertMessage(m));
            const calls = m.content.filter(c => c.type === "tool_use");
            if (calls.length > 0)
                res.push({
                    role: "user",
                    content: calls.map(c => ({
                        type: "tool_result",
                        tool_use_id: c.id,
                        is_error: c.result!.is_error,
                        content: c.result!.content,
                        ...c.result![tameContentMeta]?.providerData
                    }))
                });
        }
        return res;
    }

    async complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
    	const res = await fetch(this.#url, {
            method: "POST",
            headers: this.#headers,
            body: JSON.stringify({
                model: this.defaultModel,
                ...req,
                messages: this.#convertMessages(req.messages)
            }),
            signal
        });
        const data = await res.json();
        if (res.ok && data.type === "message")
            return stripMessage<AssistantMessage>(data);
        throw new InferenceError(res, data);
    }
}
