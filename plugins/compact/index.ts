import { Tiktoken } from "npm:js-tiktoken/lite";
import { Static, Type } from "typebox";
import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import { readTameConfig } from "../../config/index.ts";
import { StringEnum } from "../../util/string-enum.ts";
import type { InputMessage, InputContent, AssistantMessage, ToolUse } from "../../llm/types.ts";
import { tameMsgMeta } from "../../util/symbols.ts";
import { default as memory } from "../memory/index.ts";

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

const config = readTameConfig("compact.json", configSchema);

const rank = await import(`npm:js-tiktoken/ranks/${config.estimation.encoding}`);
const enc = new Tiktoken(rank.default);

export const estimateMessageTokens = (m: InputMessage) => {
	let n = 4;
	for (const block of m.content) {
		switch (block.type) {
			case "text":
				n += enc.encode(block.text).length;
				break;
			case "thinking":
				n += enc.encode(block.thinking).length;
				break;
			case "tool_use":
				n += enc.encode(JSON.stringify(block.input)).length;
				break;
			case "tool_result":
				n += enc.encode(block.content).length;
				break;
		}
	}
	return n;
}

const userMessageHistory = new Map<Agent, string[]>(); // TODO: get from history instead
export const summarizeContext = (ctx: InputMessage[], agent: Agent) => {
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

	if (memory.enabled) {
		const mem = memory.getAgentMemory(agent);
		if (mem.length > 0) {
			summary += "\n\nSession memory (calls to `remember`):"
			for (const [i,m] of mem.entries())
				if (!m.forgotten)
					summary += `\n- #${i+1}: ${m.text}`;
		}
	}

	return summary + "\n</history>";
};

function tailToKeep(context: InputMessage[]): number {
	let keepCount: number;
	if (config.keepTail.type === "messages") {
		keepCount = config.keepTail.messages;
	} else {
		let acc = 0;
		keepCount = 0;
		for (let i = context.length - 1; i >= 0; i--) {
			acc += estimateMessageTokens(context[i]);
			if (acc > config.keepTail.tokens) break;
			keepCount++;
		}
	}
	return keepCount;
}

function failedToolUseIds(msgs: InputMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of msgs) {
		for (const c of m.content) {
			if (c.type === "tool_result" && c.is_error)
				ids.add(c.tool_use_id);
		}
	}
	return ids;
}

function pruneContent(
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

const lastCompactKey = Symbol("tame:compact:last-interval-compact");

function intervalPrune(agent: Agent, lastCompact: number): void {
	const keepCount = tailToKeep(agent.context);
	const head = agent.context.slice(0, lastCompact);
	const toPrune = agent.context.slice(lastCompact, -keepCount);
	const tail = agent.context.slice(-keepCount);

	switch (config.interval!.every.type) {
		case "messages":
			if (toPrune.length < config.interval!.every.messages) return;
			break;
		case "tokens": {
			let midTokens = 0;
			for (const m of toPrune) midTokens += estimateMessageTokens(m);
			if (midTokens < config.interval!.every.tokens) return;
			break;
		}
	}

	const failedIds = failedToolUseIds(head);

	const pruned: InputMessage[] = [];
	for (const m of toPrune) {
		if (m.role === "user" || m[tameMsgMeta]?.noCompact) {
			pruned.push(m);
			continue;
		}

		const newContent: InputContent[] = [];
		for (const c of m.content) {
			const pruned = pruneContent(c, failedIds, config.interval!.prune);
			if (pruned !== null) newContent.push(pruned);
		}

		if (newContent.length === 0) continue;
		pruned.push({ ...m, content: newContent });
	}

	agent.pluginData.set(lastCompactKey, head.length + pruned.length - 1);
	agent.context = [...head, ...pruned, ...tail];
}

function ceilingCompact(agent: Agent): void {
	const keepCount = tailToKeep(agent.context);
	const tail = agent.context.slice(-keepCount);
	const head = agent.context.slice(0, -keepCount);

	const protectedMsgs = head.filter(m => m[tameMsgMeta]?.noCompact);
	const summarizable = head.filter(m => !m[tameMsgMeta]?.noCompact);

	const summary = summarizeContext(summarizable, agent);
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

const setCaching = (m: InputMessage): InputMessage => ({
	...m,
	content: m.content.map((c, i) =>
		i === m.content.length - 1
			? ({ ...c, cache_control: { type: "ephemeral", ttl: "5m" } })
			: c)
});

export class CompactPlugin implements Plugin {
	id = "compact" as const;

	enabled?: true;

	async init() {
	}

	newAgent(agent: Agent) {
		userMessageHistory.set(agent, []);

		agent.before("completion", async (e) => {
			const lastCompactBoundary = (agent.pluginData.get(lastCompactKey) ?? 0) as number;
			const lastUsageIdx = agent.context.findLastIndex(m => "usage" in m);
			if (lastUsageIdx < lastCompactBoundary) return e;
			const lastUsage = agent.context[lastUsageIdx] as AssistantMessage;

			let tokenCount = lastUsage.usage.input_tokens + lastUsage.usage.cache_read_input_tokens + lastUsage.usage.cache_creation_input_tokens;
			if (tokenCount < config.maxTokens) {
				const messagesWithoutUsage = agent.context.slice(lastUsageIdx + 1);
				for (const m of messagesWithoutUsage)
					tokenCount += estimateMessageTokens(m);
			}

			if (tokenCount > config.maxTokens) {
				ceilingCompact(agent);
			} else if (config.interval) {
				intervalPrune(agent, lastCompactBoundary);
			}

			const messages = structuredClone(agent.context);
			const compactBoundary = agent.pluginData.get(lastCompactKey);
			if (typeof compactBoundary === "number")
				messages[compactBoundary] = setCaching(messages[compactBoundary]);
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
}

export default new CompactPlugin();
