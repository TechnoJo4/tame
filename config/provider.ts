import { AnthropicMessagesProvider } from "../llm/messages.ts";
import { InferenceProvider } from "../llm/types.ts";
import { PriorityProvider } from "../llm/router.ts";
import { Static, Object, Union, Literal, Array, String, Number, Optional, Type } from "@sinclair/typebox";
import { StringEnum } from "../util/string-enum.ts";
import { BackoffRatelimiter, Ratelimiter } from "../util/ratelimit.ts";

// Schema
export const knownProvider = StringEnum(["openrouter", "opencode"] as const);

export type KnownProvider = Static<typeof knownProvider>;

export const backoffRatelimiterConfig = Object({
	type: Literal("backoff"),
	minDelay: Optional(Number()),
	errorMin: Optional(Number()),
	errorMax: Optional(Number()),
	errorExp: Optional(Number())
});

export const ratelimiterConfig = Union([backoffRatelimiterConfig]);

export type RatelimiterConfig = Static<typeof ratelimiterConfig>;

export const knownProviderConfig = Object({
	type: Literal("provider"),
	provider: knownProvider,
	apiKey: Optional(String()),
	model: String(),
	headers: Optional(Object({}, { additionalProperties: String() })),
	limiter: Optional(ratelimiterConfig),
});

export type KnownProviderConfig = Static<typeof knownProviderConfig>;

export const autoProviderConfig = Object({
	type: Type.Literal("priority"),
	providers: Array(knownProviderConfig),
	maxDelay: Type.Number()
});

export const providerConfig = Union([knownProviderConfig, autoProviderConfig]);

export type ProviderConfig = Static<typeof providerConfig>;

// Parsing
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
};

export const parseLimiter = (o: RatelimiterConfig): Ratelimiter => {
	switch (o.type) {
		case "backoff":
			return new BackoffRatelimiter(o);
	}
}

export const parseKnownProvider = (o: KnownProviderConfig): InferenceProvider => {
	const p = knownProviders[o.provider];
	const key = o.apiKey ?? Deno.env.get(p.envKey);
	if (!key)
		throw new Error(`no api key for provider ${o.provider}`);

	switch (p.type) {
		case "anthropic-messages":
			return new AnthropicMessagesProvider(p.url, key, o.headers, o.model);
	}
};

export const parseProvider = (o: ProviderConfig): InferenceProvider => {
	switch (o.type) {
		case "provider":
			return parseKnownProvider(o);
		case "priority":
			return new PriorityProvider(o.providers.map(parseProvider), o.maxDelay)
	}
};
