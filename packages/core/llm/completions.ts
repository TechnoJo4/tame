import { InferenceError } from "./error.ts";
import {
	tameMsgMeta,
	tameContentMeta,
	type InferenceProvider,
	type AssistantMessage,
	type MessageRequest,
	type Content,
	type InputMessage,
	type ToolUse,
	type Usage,
	type StopReason,
	type TameContentMeta,
} from "@tame/sdk";

interface ThinkingBlock {
	text: string;
	reasoningField: string;
	reasoningDetailType?: string;
	index?: number;
	signature?: string;
	providerData?: Record<string, unknown>;
}

function collectThinking(content: Content[]): ThinkingBlock[] {
	const blocks: ThinkingBlock[] = [];
	for (const c of content) {
		if (c.type === "thinking" || c.type === "redacted_thinking") {
			const meta = c[tameContentMeta] as TameContentMeta | undefined;
			if (!meta?.reasoningField) continue;
			const pd = (meta.providerData ?? {}) as Record<string, unknown>;
			blocks.push({
				text: c.type === "thinking" ? c.thinking : "",
				reasoningField: meta.reasoningField,
				reasoningDetailType: meta.reasoningDetailType,
				index: meta.reasoningIndex,
				signature: pd["signature"] as string | undefined,
				providerData: pd,
			});
		}
	}
	return blocks;
}

function applyThinking(msg: Record<string, unknown>, blocks: ThinkingBlock[]) {
	const byField = new Map<string, ThinkingBlock[]>();
	for (const b of blocks) {
		const existing = byField.get(b.reasoningField);
		if (existing) existing.push(b);
		else byField.set(b.reasoningField, [b]);
	}

	for (const [field, group] of byField) {
		switch (field) {
			case "reasoning_details": {
				const arr: Record<string, unknown>[] = [];
				for (const b of group) {
					const detail: Record<string, unknown> = {
						...b.providerData,
						type: b.reasoningDetailType ?? "reasoning.text",
					};
					if (b.text) {
						const textField =
							b.reasoningDetailType === "reasoning.summary"
								? "summary"
								: "text";
						detail[textField] = b.text;
					}
					if (b.index !== undefined) detail["index"] = b.index;
					if (b.signature) detail["signature"] = b.signature;
					arr.push(detail);
				}
				msg["reasoning_details"] = arr;
				break;
			}
			default:
				msg[field] = group.map((b) => b.text).join("\n");
				break;
		}
	}
}

export class CompletionsProvider implements InferenceProvider {
	#url: string;
	#headers: Record<string, string>;
	defaultModel = "";

	constructor(url: string, key?: string, headers?: Record<string, string>, defaultModel?: string) {
		this.#url = url;
		this.#headers = {
			"Content-Type": "application/json",
			...headers,
		};
		if (key) {
			this.#headers["Authorization"] ??= `Bearer ${key}`;
		}
		if (defaultModel) this.defaultModel = defaultModel;
	}

	#convertContent(content: Content[]): { textParts: Record<string, unknown>[]; toolCalls: Record<string, unknown>[] } {
		const textParts: Record<string, unknown>[] = [];
		const toolCalls: Record<string, unknown>[] = [];
		for (const c of content) {
			const extra = c[tameContentMeta]?.providerData ?? {};
			switch (c.type) {
				case "text":
					textParts.push({ type: "text", text: c.text, ...extra });
					break;
				case "thinking":
				case "redacted_thinking":
					// handled at message level via applyThinking
					break;
				case "tool_use":
					toolCalls.push({
						id: c.id,
						type: "function",
						function: {
							name: c.name,
							arguments: JSON.stringify(c.input),
						},
						...extra,
					});
					break;
			}
		}
		return { textParts, toolCalls };
	}

	#convertTools(tools: MessageRequest["tools"]): Record<string, unknown>[] | undefined {
		if (!tools || tools.length === 0) return undefined;
		return tools.map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema,
			},
		}));
	}

	#convertMessages(messages: InputMessage[], system?: string): Record<string, unknown>[] {
		const res: Record<string, unknown>[] = [];

		if (system) {
			res.push({ role: "system", content: system });
		}

		for (const m of messages) {
			const extra = m[tameMsgMeta]?.providerData ?? {};
			const thinking = collectThinking(m.content);
			const { textParts, toolCalls } = this.#convertContent(m.content);

			if (m.role === "user") {
				const content: unknown =
					textParts.length === 1 && toolCalls.length === 0
						? (textParts[0] as { text: string }).text
						: textParts;
				res.push({ role: "user", content, ...extra });
			} else {
				const textContent = textParts
					.map((p) => (p as { text: string }).text)
					.join("\n");
				const msg: Record<string, unknown> = {
					role: "assistant",
					...extra,
				};
				if (textContent) msg["content"] = textContent;
				if (toolCalls.length > 0) msg["tool_calls"] = toolCalls;
				if (thinking.length > 0) applyThinking(msg, thinking);
				res.push(msg);

				// tool results
				const callsWithResults = m.content.filter(
					(c) => c.type === "tool_use" && c.result,
				);
				for (const c of callsWithResults) {
					const call = c as ToolUse;
					const resultExtra =
						call.result![tameContentMeta]?.providerData ?? {};
					res.push({
						role: "tool",
						tool_call_id: call.id,
						content: call.result!.content,
						...resultExtra,
					});
				}
			}
		}

		return res;
	}

	#mapStopReason(reason: string): StopReason {
		switch (reason) {
			case "stop":
				return "end_turn";
			case "length":
				return "max_tokens";
			case "tool_calls":
				return "tool_use";
			case "content_filter":
				return "refusal";
			default:
				return "end_turn";
		}
	}

	#parseResponse(data: Record<string, unknown>): AssistantMessage {
		const choice = (data["choices"] as Record<string, unknown>[])?.[0] ?? {};
		const message = (choice["message"] ?? {}) as Record<string, unknown>;
		const usage = (data["usage"] ?? {}) as Record<string, unknown>;
		const usageDetails = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;

		const content: Content[] = [];

		// text
		if (message["content"] && typeof message["content"] === "string") {
			content.push({ type: "text", text: message["content"] });
		}

		// refusal
		if (message["refusal"] && typeof message["refusal"] === "string") {
			content.push({
				type: "text",
				text: `[refusal] ${message["refusal"]}`,
			});
		}

		// reasoning string fields -- take first non-empty to avoid duplication
		const reasoningStringFields = [
			"reasoning_content",
			"reasoning",
			"reasoning_text",
		];
		for (const field of reasoningStringFields) {
			const value = message[field];
			if (typeof value === "string" && value.length > 0) {
				content.unshift({
					type: "thinking",
					thinking: value,
					[tameContentMeta]: { reasoningField: field },
				});
				break;
			}
		}

		// reasoning_details
		const reasoningDetails = message["reasoning_details"] as Record<string, unknown>[] | undefined;
		if (reasoningDetails) {
			for (const rd of reasoningDetails) {
				const detailType = rd["type"] as string;
				const providerData: Record<string, unknown> = {};
				// capture every field not explicitly stored in TameContentMeta
				for (const k of ["signature", "format", "id", "data"] as const) {
					if (rd[k] !== undefined) providerData[k] = rd[k];
				}

				const meta: TameContentMeta = {
					reasoningField: "reasoning_details",
					reasoningDetailType: detailType,
					providerData: Object.keys(providerData).length > 0
						? providerData
						: undefined,
				};
				if (rd["index"] !== undefined)
					meta.reasoningIndex = rd["index"] as number;

				const thinkingText =
					detailType === "reasoning.text"
						? (rd["text"] as string)
						: detailType === "reasoning.summary"
						? (rd["summary"] as string)
						: undefined;
				if (thinkingText) {
					content.unshift({
						type: "thinking",
						thinking: thinkingText,
						[tameContentMeta]: meta,
					});
				} else if (detailType === "reasoning.encrypted") {
					meta.providerData = providerData;
					content.unshift({
						type: "redacted_thinking",
						[tameContentMeta]: meta,
					} as Content);
				}
			}
		}

		// tool calls
		const toolCalls = message["tool_calls"] as Record<string, unknown>[] | undefined;
		if (toolCalls) {
			for (const tc of toolCalls) {
				let input: Record<string, unknown> = {};
				const fn = tc["function"] as Record<string, unknown> | undefined;
				try {
					input = JSON.parse(
						(fn?.["arguments"] as string) ?? "{}",
					);
				} catch {
					/* keep empty on parse failure */
				}

				// capture unknown tool_call-level fields for round-tripping
				const tcProviderData: Record<string, unknown> = {};
				const knownTcFields = new Set(["id", "type", "function"]);
				for (const k of Object.keys(tc)) {
					if (!knownTcFields.has(k)) tcProviderData[k] = tc[k];
				}

				content.push({
					type: "tool_use",
					id: tc["id"] as string,
					name: (fn?.["name"] as string) ?? "",
					input,
					[tameContentMeta]: Object.keys(tcProviderData).length > 0
						? { providerData: tcProviderData }
						: undefined,
				});
			}
		}

		const tameUsage: Usage = {
			input_tokens: (usage["prompt_tokens"] as number) ?? 0,
			output_tokens: (usage["completion_tokens"] as number) ?? 0,
			cache_creation_input_tokens:
				(usageDetails?.["cache_write_tokens"] as number) ?? 0,
			cache_read_input_tokens:
				(usageDetails?.["cached_tokens"] as number) ?? 0,
			service_tier: (data["service_tier"] as string) ?? "",
		};

		const handledMessageFields = new Set([
			"content",
			"refusal",
			"reasoning_content",
			"reasoning",
			"reasoning_text",
			"reasoning_details",
			"tool_calls",
			"role",
		]);
		const msgProviderData: Record<string, unknown> = {};
		for (const k of Object.keys(message)) {
			if (!handledMessageFields.has(k)) {
				msgProviderData[k] = message[k];
			}
		}

		return {
			role: "assistant",
			content,
			stop_reason: this.#mapStopReason(
				(choice["finish_reason"] as string) ?? "stop",
			),
			model: (data["model"] as string) ?? "",
			usage: tameUsage,
			[tameMsgMeta]: Object.keys(msgProviderData).length > 0
				? { providerData: msgProviderData }
				: undefined,
		};
	}

	async complete(req: MessageRequest, signal?: AbortSignal): Promise<AssistantMessage> {
		const body: Record<string, unknown> = {
			model: req.model ?? this.defaultModel,
			max_tokens: req.max_tokens,
			messages: this.#convertMessages(req.messages, req.system),
		};

		if (req.tools) {
			body["tools"] = this.#convertTools(req.tools);
		}

		const res = await fetch(this.#url, {
			method: "POST",
			headers: this.#headers,
			body: JSON.stringify(body),
			signal,
		});

		const data = await res.json();
		if (res.ok) {
			return this.#parseResponse(data);
		}
		throw new InferenceError(res, data);
	}
}
