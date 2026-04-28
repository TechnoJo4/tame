import { AnthropicMessagesProvider } from "../llm/messages.ts";
import { InferenceProvider } from "../llm/types.ts";
import { PriorityProvider } from "../llm/router.ts";
import { Static, Type } from "typebox";
import { StringEnum } from "../util/string-enum.ts";
import { Ratelimiter } from "../ratelimit/ratelimit.ts";
import { SerialRatelimiter } from "../ratelimit/serial.ts";
import { TokenBucketRatelimiter } from "../ratelimit/bucket.ts";
import { BackoffOnlyRatelimiter } from "../ratelimit/backoff.ts";
import { RatelimitedProvider } from "../llm/ratelimited.ts";
import { ExtraDataProvider } from "../llm/extra-data.ts";

// Schema
export const knownProvider = StringEnum(["openrouter", "opencode", "deepseek"] as const);

export type KnownProvider = Static<typeof knownProvider>;

export const serialRatelimiterConfig = Type.Object({
	type: Type.Literal("serial"),
	minDelay: Type.Optional(Type.Number()),
	errorMin: Type.Optional(Type.Number()),
	errorMax: Type.Optional(Type.Number()),
	errorExp: Type.Optional(Type.Number())
});

export const bucketRatelimiterConfig = Type.Object({
	type: Type.Literal("bucket"),
	rps: Type.Optional(Type.Number()),
	maxBurst: Type.Optional(Type.Number()),
	errorMultiplier: Type.Optional(Type.Number()),
});

export const backoffOnlyRatelimiterConfig = Type.Object({
	type: Type.Literal("backoff-only"),
	errorMin: Type.Optional(Type.Number()),
	errorMax: Type.Optional(Type.Number()),
	errorExp: Type.Optional(Type.Number()),
});

export const ratelimiterConfig = Type.Union([ serialRatelimiterConfig, bucketRatelimiterConfig, backoffOnlyRatelimiterConfig ]);

export type RatelimiterConfig = Static<typeof ratelimiterConfig>;

export const knownProviderConfig = Type.Object({
	type: Type.Literal("provider"),
	provider: knownProvider,
	apiKey: Type.Optional(Type.String()),
	model: Type.String(),
});

export type KnownProviderConfig = Static<typeof knownProviderConfig>;

export const messagesProviderConfig = Type.Object({
	type: Type.Literal("anthropic-messages"),
	apiUrl: Type.String(),
	apiKey: Type.Optional(Type.String()),
	model: Type.String(),
});

export type MessagesProviderConfig = Static<typeof messagesProviderConfig>;

export const providerExtraConfig = Type.Object({
	headers: Type.Optional(Type.Object({}, { additionalProperties: Type.String() })),
	limiter: Type.Optional(ratelimiterConfig),
	extra: Type.Optional(Type.Object({})),
});

export type ProviderExtraConfig = Static<typeof providerExtraConfig>;

export const anyProviderConfig = Type.Intersect([
	Type.Union([ knownProviderConfig, messagesProviderConfig ]),
	providerExtraConfig
]);

export type AnyProviderConfig = Static<typeof anyProviderConfig>;

export const llmConfig = Type.Object({
	type: Type.Literal("priority"),
	providers: Type.Array(anyProviderConfig),
	maxDelay: Type.Number()
});

export type LLMConfig = Static<typeof llmConfig>;

type ProviderType = "anthropic-messages";

type ProviderInfo = {
	type: ProviderType;
	url: string;
	envKey: string;
};

export const knownProviders: Record<KnownProvider, ProviderInfo> = {
	openrouter: {
		type: "anthropic-messages",
		url: "https://openrouter.ai/api/v1/messages",
		envKey: "OPENROUTER_API_KEY",
	},
	opencode: {
		type: "anthropic-messages",
		url: "https://opencode.ai/zen/v1/messages",
		envKey: "OPENCODE_API_KEY",
	},
	deepseek: {
		type: "anthropic-messages",
		url: "https://api.deepseek.com/anthropic/v1/messages",
		envKey: "DEEPSEEK_API_KEY",
	},
};

export const parseLimiter = (o: RatelimiterConfig): Ratelimiter => {
	switch (o.type) {
		case "serial":
			return new SerialRatelimiter(o);		
		case "bucket":
			return new TokenBucketRatelimiter(o);
		case "backoff-only":
			return new BackoffOnlyRatelimiter(o);
	}
}

export const parseExtra = (provider: InferenceProvider, extra: ProviderExtraConfig): InferenceProvider => {
	if (extra.limiter)
		provider = new RatelimitedProvider(provider, parseLimiter(extra.limiter));
	if (extra.extra)
		provider = new ExtraDataProvider(provider, extra.extra);
	return provider;
}

export const parseKnownProvider = (o: KnownProviderConfig & ProviderExtraConfig): InferenceProvider => {
	const p = knownProviders[o.provider];
	const key = o.apiKey ?? Deno.env.get(p.envKey);
	if (!key)
		throw new Error(`no api key for provider ${o.provider}`);

	switch (p.type) {
		case "anthropic-messages":
			return new AnthropicMessagesProvider(p.url, key, o.headers as Record<string, string>, o.model);
	}
};

export const parseMessagesProvider = (o: MessagesProviderConfig & ProviderExtraConfig): InferenceProvider => {
	return new AnthropicMessagesProvider(o.apiUrl, o.apiKey, o.headers as Record<string, string>, o.model);
};

export const parseProvider = (o: AnyProviderConfig): InferenceProvider => {
	switch (o.type) {
		case "provider":
			return parseExtra(parseKnownProvider(o), o);
		case "anthropic-messages":
			return parseExtra(parseMessagesProvider(o), o);
	}
};

export const parseLLM = (o: LLMConfig): InferenceProvider => {
	return new PriorityProvider(o.providers.map(parseProvider), o.maxDelay);
};
