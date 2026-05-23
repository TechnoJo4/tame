import { Tiktoken } from "npm:js-tiktoken/lite";
import { type Static, Type } from "typebox";
import type { IAgent, IHarness, InputMessage, InputContent, AssistantMessage, ToolUse } from "@tame/sdk";
import { type Plugin, StringEnum, tameMsgMeta } from "@tame/sdk";
import type { MemoryPlugin } from "@tame/plugin-memory/index";

const target = Type.Union([
	Type.Object({ type: Type.Literal("tokens"), tokens: Type.Number() }),
	Type.Object({ type: Type.Literal("messages"), messages: Type.Number() }),
]);

const pruneSchema = Type.Object({
	thinking: Type.Boolean({ description: "Strip thinking blocks from pruned messages" }),
	failedToolCalls: Type.Boolean({ description: "Remove failed tool_result blocks and their paired tool_use" }),
	maxToolResultLength: Type.Number({ description: "Truncate tool results longer than this (0 = no truncation)" }),
});

export const configSchema = Type.Object({
	maxTokens: Type.Number(),
	estimation: Type.Union([
		Type.Object({
			type: Type.Literal("tiktoken"),
			encoding: StringEnum([ "gpt2", "r50k_base", "p50k_base", "p50k_edit", "cl100k_base", "o200k_base" ] as const)
		}),
	]),
	keepTail: target,
	interval: Type.Optional(Type.Object({
		every: target,
		prune: pruneSchema,
	})),
});

export type CompactConfig = Static<typeof configSchema>;

const userMessageHistory = new Map<IAgent, string[]>();

const lastCompactKey = Symbol("tame:compact:last-interval-compact");

export class CompactPlugin implements Plugin {
	id = "compact" as const;

	enabled?: true;

	#config: CompactConfig;
	#enc!: Tiktoken;
	#memory?: MemoryPlugin;

	constructor(config: CompactConfig) {
		this.#config = config;
	}

	async init(harness: IHarness) {
		this.#memory = harness.getPlugin<MemoryPlugin>("memory");
		const rank = await import(`npm:js-tiktoken/ranks/${this.#config.estimation.encoding}`);
		this.#enc = new Tiktoken(rank.default);
	}

	estimateMessageTokens(m: InputMessage) {
		let n = 4;
		for (const block of m.content) {
			switch (block.type) {
				case "text":
					n += this.#enc.encode(block.text).length;
					break;
				case "thinking":
					n += this.#enc.encode(block.thinking).length;
					break;
				case "tool_use":
					n += this.#enc.encode(JSON.stringify(block.input)).length;
					break;
				case "tool_result":
					n += this.#enc.encode(block.content).length;
					break;
			}
		}
		return n;
	}

	newAgent(agent: IAgent) {
		userMessageHistory.set(agent, []);

		agent.before("completion", async (e) => {
			const lastCompactBoundary = (agent.pluginData.get(lastCompactKey) ?? 0) as number;
			const lastUsageIdx = agent.context.findLastIndex(m => "usage" in m);
			if (lastUsageIdx < lastCompactBoundary) return e;
			const lastUsage = agent.context[lastUsageIdx] as AssistantMessage;

			let tokenCount = lastUsage.usage.input_tokens + lastUsage.usage.cache_read_input_tokens + lastUsage.usage.cache_creation_input_tokens;
			if (tokenCount < this.#config.maxTokens) {
				const messagesWithoutUsage = agent.context.slice(lastUsageIdx + 1);
				for (const m of messagesWithoutUsage)
					tokenCount += this.estimateMessageTokens(m);
			}

			if (tokenCount > this.#config.maxTokens) {
				this.ceilingCompact(agent);
			} else if (this.#config.interval) {
				this.intervalPrune(agent, lastCompactBoundary);
			}

			const messages = structuredClone(agent.context);
			const compactBoundary = agent.pluginData.get(lastCompactKey);
			if (typeof compactBoundary === "number")
				messages[compactBoundary] = this.setCaching(messages[compactBoundary]);
			return {
				...e,
				req: {
					...e.req,
					cache_control: { type: "ephemeral", ttl: "5m" },
					messages
				}
			};
		});
	}

	tailToKeep(context: InputMessage[]): number {
		let keepCount: number;
		if (this.#config.keepTail.type === "messages") {
			keepCount = this.#config.keepTail.messages;
		} else {
			let acc = 0;
			keepCount = 0;
			for (let i = context.length - 1; i >= 0; i--) {
				acc += this.estimateMessageTokens(context[i]);
				if (acc > this.#config.keepTail.tokens) break;
				keepCount++;
			}
		}
		return keepCount;
	}

	failedToolUseIds(msgs: InputMessage[]): Set<string> {
		const ids = new Set<string>();
		for (const m of msgs) {
			for (const c of m.content) {
				if (c.type === "tool_result" && c.is_error)
					ids.add(c.tool_use_id);
			}
		}
		return ids;
	}

	pruneContent(
		c: InputContent,
		failedIds: Set<string>,
		prune: Static<typeof pruneSchema>
	): InputContent | null {
		switch (c.type) {
			case "thinking":
				if (prune.thinking) return null;
				break;
			case "tool_use":
				if (prune.failedToolCalls && failedIds.has(c.id)) return null;
				break;
			case "tool_result":
				if (prune.failedToolCalls && c.is_error) return null;
				if (prune.maxToolResultLength > 0 && c.content.length > prune.maxToolResultLength) {
					const head = c.content.slice(0, prune.maxToolResultLength);
					const omitted = c.content.length - prune.maxToolResultLength;
					return {
						...c,
						content: `${head}\n\n[... ${omitted} more characters truncated by compaction]`,
					};
				}
				break;
		}
		return c;
	}

	intervalPrune(agent: IAgent, lastCompact: number): void {
		const keepCount = this.tailToKeep(agent.context);
		const head = agent.context.slice(0, lastCompact);
		const toPrune = agent.context.slice(lastCompact, -keepCount);
		const tail = agent.context.slice(-keepCount);

		switch (this.#config.interval!.every.type) {
			case "messages":
				if (toPrune.length < this.#config.interval!.every.messages) return;
				break;
			case "tokens": {
				let midTokens = 0;
				for (const m of toPrune) midTokens += this.estimateMessageTokens(m);
				if (midTokens < this.#config.interval!.every.tokens) return;
				break;
			}
		}

		const failedIds = this.failedToolUseIds(head);

		const pruned: InputMessage[] = [];
		for (const m of toPrune) {
			if (m.role === "user" || m[tameMsgMeta]?.noCompact) {
				pruned.push(m);
				continue;
			}

			const newContent: InputContent[] = [];
			for (const c of m.content) {
				const pruned = this.pruneContent(c, failedIds, this.#config.interval!.prune);
				if (pruned !== null) newContent.push(pruned);
			}

			if (newContent.length === 0) continue;
			pruned.push({ ...m, content: newContent });
		}

		agent.pluginData.set(lastCompactKey, head.length + pruned.length - 1);
		agent.context = [...head, ...pruned, ...tail];
	}

	ceilingCompact(agent: IAgent): void {
		const keepCount = this.tailToKeep(agent.context);
		const tail = agent.context.slice(-keepCount);
		const head = agent.context.slice(0, -keepCount);

		const protectedMsgs = head.filter(m => m[tameMsgMeta]?.noCompact);
		const summarizable = head.filter(m => !m[tameMsgMeta]?.noCompact);

		const summary = this.summarizeContext(summarizable, agent);
		agent.context = [
			{
				role: "user",
				content: [{ type: "text", text: summary }],
				[tameMsgMeta]: { automated: true },
			},
			...protectedMsgs,
			...tail,
		];
	}

	summarizeContext(ctx: InputMessage[], agent: IAgent) {
		let summary = "Your context window has been compacted.\n\n<history>\nKey conversation turns:";

		const calls: Record<string, ToolUse> = {};
		for (const c of userMessageHistory.get(agent)!)
			summary += `\n[user] ${c}`;

		for (const m of ctx) {
			if (!m[tameMsgMeta]?.automated) {
				for (const c of m.content) {
					if (c.type === "tool_use")
						calls[c.id] = c;
					if (c.type === "text") {
						summary += `\n[${m.role}] ${c.text}`;
						if (m.role === "user")
							userMessageHistory.get(agent)!.push(c.text);
					}
				}
			}
		}

		let calls_text = "";
		for (const m of ctx) {
			for (const c of m.content) {
				if (c.type === "tool_result" && !c.is_error) {
					const view = agent.viewToolCall("compact", calls[c.tool_use_id], c);
					if (view) calls_text += `\n- ${view}`;
				}
			}
		}

		if (calls_text !== "")
			summary += "\n\nTool calls:" + calls_text;

		if (this.#memory) {
			const mem = this.#memory.getAgentMemory(agent);
			if (mem.length > 0) {
				summary += "\n\nSession memory (calls to `remember`):"
				for (const [i,m] of mem.entries())
					if (!m.forgotten)
						summary += `\n- #${i+1}: ${m.text}`;
			}
		}

		return summary + "\n</history>";
	}

	setCaching(m: InputMessage): InputMessage {
		return {
			...m,
			content: m.content.map((c, i) =>
				i === m.content.length - 1
					? ({ ...c, cache_control: { type: "ephemeral", ttl: "5m" } })
					: c)
		};
	}
}
