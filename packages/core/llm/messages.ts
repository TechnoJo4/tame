import {type AssistantMessage, type Content, type InferenceProvider, type InputMessage, type MessageRequest, stripMessage, tameContentMeta, tameMsgMeta} from "@tame/sdk";

import {InferenceError} from "./error.ts";

export class AnthropicMessagesProvider implements InferenceProvider {
	#url: string;
	#headers: Record<string, string>;
	defaultModel = "";

	constructor(url: string, key?: string, headers?: Record<string, string>, defaultModel?: string) {
		this.#url = url;
		this.#headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", ...headers };
		if (key) {
			this.#headers["x-api-key"] ??= key;
			this.#headers["Authorization"] ??= `Bearer ${key}`;
		}
		if (defaultModel) this.defaultModel = defaultModel;
	}

	#convertContent(content: Content): Content {
		const res = {...content, ...content[tameContentMeta]?.providerData };
		if (res.type === "tool_use") delete res["result"];
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
			// Tool results are attached to tool_use blocks after execution;
			// calls without one (aborted/hanging/restored) must not be sent
			// as tool_result blocks, and dangling tool_use blocks are invalid
			// on the wire. Drop them (and the message if nothing remains).
			const content = m.content.filter(c => c.type !== "tool_use" || c.result);
			if (content.length === 0) continue;
			res.push(this.#convertMessage({...m, content }));
			const calls = content.filter(c => c.type === "tool_use");
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
		const { headers, ...body } = req;
		const res = await fetch(this.#url, {
			method: "POST",
			headers: {...this.#headers, ...headers },
			body: JSON.stringify({ model: this.defaultModel, ...body, messages: this.#convertMessages(req.messages) }),
			signal
		});
		const data = await res.json();
		if (res.ok && data.type === "message") return stripMessage<AssistantMessage>(data);
		throw new InferenceError(res, data);
	}
}
