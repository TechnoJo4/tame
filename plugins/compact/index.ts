import { Tiktoken } from "npm:js-tiktoken/lite";
import { TSchema, Type } from "@sinclair/typebox";
import { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";
import { readTameConfig } from "../../config/index.ts";
import { StringEnum } from "../../util/string-enum.ts";
import type { InputMessage, AssistantMessage, ToolUse } from "../../llm/types.ts";
import * as harness from "../../agent/harness.ts";
import { Tool, tool } from "../../agent/tool.ts";
import { automated } from "../../util/symbols.ts";

export const configSchema = Type.Object({
    maxTokens: Type.Number(),
    estimation: Type.Object({
        // tiktoken ranks
        encoding: StringEnum([ "gpt2", "r50k_base", "p50k_base", "p50k_edit", "cl100k_base", "o200k_base" ] as const)
    }),
    tools: Type.Object({
        remember: Type.Boolean()
    }),
    keepTail: Type.Union([
        //Type.Object({ type: Type.Literal("tokens"), tokens: Type.Number() }),
        Type.Object({ type: Type.Literal("messages"), messages: Type.Number() }),
        //Type.Object({ type: Type.Literal("calls"), calls: Type.Number() }),
    ]),
});

const config = readTameConfig("compact.json", configSchema);

const rank_req = await import(`npm:js-tiktoken/ranks/${config.estimation.encoding}`);
const rank_data = await rank_req.json();
const enc = new Tiktoken(rank_data);

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

const memory = new Map<Agent, string[]>();
const userMessageHistory = new Map<Agent, string[]>();
export const summarizeContext = (ctx: InputMessage[], agent: Agent) => {
    let summary = "Your context window has been compacted.\n\n<history>\nKey conversation turns:";

    const calls: Record<string, ToolUse> = {};
    for (const c of userMessageHistory.get(agent)!)
        summary += `\n[user] ${c}`;

    for (const m of ctx) {
        for (const c of m.content) {
            if (c.type === "tool_use")
                calls[c.id] = c;
            if (c.type === "text" && !c[automated]) {
                summary += `\n[${m.role}] ${c.text}`;
                if (m.role === "user")
                    userMessageHistory.get(agent)!.push(c.text);
            }
        }
    }

    let calls_text = "";
    for (const m of ctx) {
        for (const c of m.content) {
            if (c.type === "tool_result" && !c.is_error) {
                const tool = agent.tools.get(calls[c.tool_use_id].name)! as Tool<TSchema>;
                if (tool?.view?.compact) {
                    calls_text += `\n- ${tool.view.compact(calls[c.tool_use_id].input, c)}`;
                }
            }
        }
    }

    if (calls_text !== "")
        summary += "\n\nTool calls:" + calls_text;

    const mem = memory.get(agent)!;
    if (mem.length > 0)
        summary += "\n\nSession memory (calls to `remember`):" + mem.map(s => `\n- ${s}`).join("");

    return summary + "\n</history>";
};

export default {
    async init() {
        if (config.tools.remember)
            harness.tools.push(tool({
                name: "remember",
                desc: `Add a thought to session memory. It will be persisted after compaction`,
                args: Type.Object({ thought: Type.String({ description: "Text to persist" }) }),
                exec: async ({ thought }, agent) => {
                    memory.get(agent)!.push(thought);
                    return "done";
                },
                view: {
                    compact: ({ thought }) => "Remember: "+thought
                }
            }));
    },
    newAgent(agent: Agent) {
        memory.set(agent, []);
        userMessageHistory.set(agent, []);
        agent.before("completion", async (e) => {
            const lastUsageIdx = agent.context.findLastIndex(m => "usage" in m);
            if (lastUsageIdx === -1) return e;
            const lastUsage = agent.context[lastUsageIdx] as AssistantMessage;

            let tokenCount = lastUsage.usage.input_tokens + lastUsage.usage.cache_read_input_tokens + lastUsage.usage.cache_creation_input_tokens;
            if (tokenCount < config.maxTokens) {
                const messagesWithoutUsage = agent.context.slice(lastUsageIdx+1);
                for (const m of messagesWithoutUsage)
                    tokenCount += estimateMessageTokens(m);
            }

            if (tokenCount > config.maxTokens) {
                const toSummarize = agent.context.slice(0, -config.keepTail.messages);
                const summary = summarizeContext(toSummarize, agent);
                agent.context = [
                    {
                        role: "user",
                        content: [ { type: "text", text: summary, [automated]: true } ]
                    },
                    ...agent.context.slice(-config.keepTail.messages)
                ];
            }

            return { ...e, req: { ...e.req, messages: agent.context } };
        });
    }
} as Plugin;
