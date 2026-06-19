import { Type, type Static } from "typebox";
import { type Plugin, type IAgent, type IHarness, type AssistantMessage, type Usage } from "@tame/sdk";
import { call, rpcMethod } from "@tame/rpc-sdk";
import type { RPCPlugin } from "@tame/plugin-rpc/index";
import { getAgentHistory, type HistoryPlugin } from "@tame/plugin-history/index";

// ---- types ----

export interface TokenStatsSnapshot {
	/** Raw usage from the last assistant message, null if no completions yet. */
	context: Usage | null;
	/** Running session aggregate. */
	session: {
		turnCount: number;
		inputTokens: number;
		outputTokens: number;
		cacheCreationInputTokens: number;
		cacheReadInputTokens: number;
	};
}

/** Persisted alongside history so sessions survive restarts. */
export interface TokenStatsSaved {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	turnCount: number;
}

// ---- config ----

export const configSchema = Type.Object({});

export type TokenStatsConfig = Static<typeof configSchema>;

// ---- rpc ----

export const rpcSchema = {
	getTokenStats: rpcMethod({
		input: Type.Object({ sessionId: Type.String() }),
		output: Type.Object({
			context: Type.Union([
				Type.Null(),
				Type.Object({
					input_tokens: Type.Number(),
					output_tokens: Type.Number(),
					cache_creation_input_tokens: Type.Number(),
					cache_read_input_tokens: Type.Number(),
					service_tier: Type.String(),
				}),
			]),
			session: Type.Object({
				turnCount: Type.Number(),
				inputTokens: Type.Number(),
				outputTokens: Type.Number(),
				cacheCreationInputTokens: Type.Number(),
				cacheReadInputTokens: Type.Number(),
			}),
		}),
	}),
};

// ---- plugin ----

const dataKey = Symbol("tame:token-stats:data");
const historyHookKey = "token-stats";

function getData(agent: IAgent): TokenStatsSaved {
	if (!agent.pluginData.has(dataKey)) {
		agent.pluginData.set(dataKey, {
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			turnCount: 0,
		});
	}
	return agent.pluginData.get(dataKey) as TokenStatsSaved;
}

export class TokenStatsPlugin implements Plugin {
	id = "token-stats" as const;

	#rpc: RPCPlugin | undefined;
	#history: HistoryPlugin | undefined;

	constructor(_config: TokenStatsConfig) {}

	async init(harness: IHarness) {
		this.#rpc = harness.getPlugin<RPCPlugin>("rpc");
		this.#history = harness.getPlugin<HistoryPlugin>("history");

		this.#history?.addHook<TokenStatsSaved>(historyHookKey, {
			save: (agent) => getData(agent),
			load: (agent, data) => {
				agent.pluginData.set(dataKey, data);
			},
		});

		this.#rpc?.register("token-stats", {
			getTokenStats: call({
				...rpcSchema.getTokenStats,
				call: async ({ sessionId }) => {
					const agent = harness.getAgent(sessionId);
					if (!agent) throw new Error(`session ${sessionId} not found`);

					return this.#computeStats(agent);
				},
			}),
		});
	}

	newAgent(agent: IAgent) {
		agent.after("assistantMessage", async (e) => {
			const data = getData(agent);
			const u = e.msg.usage;
			data.inputTokens += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
			data.outputTokens += u.output_tokens;
			data.cacheCreationInputTokens += u.cache_creation_input_tokens;
			data.cacheReadInputTokens += u.cache_read_input_tokens;
			data.turnCount++;
			return e;
		});
	}

	#computeStats(agent: IAgent): TokenStatsSnapshot {
		// if this session predates the plugin, scan context once to seed totals
		this.#seedFromHistory(agent);

		const data = getData(agent);

		const lastAssistant = agent.context.findLast((m) => "usage" in m) as
			| AssistantMessage
			| undefined;

		return {
			context: lastAssistant?.usage ?? null,
			session: { ...data },
		};
	}

	/** One-time scan of full history to compute initial totals for pre-plugin sessions. */
	#seedFromHistory(agent: IAgent) {
		const data = getData(agent);
		if (data.turnCount > 0) return;

		const hist = getAgentHistory(agent);
		for (const m of hist.history) {
			if ("usage" in m) {
				const u = (m as AssistantMessage).usage;
				data.inputTokens += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
				data.outputTokens += u.output_tokens;
				data.cacheCreationInputTokens += u.cache_creation_input_tokens;
				data.cacheReadInputTokens += u.cache_read_input_tokens;
				data.turnCount++;
			}
		}
	}
}
