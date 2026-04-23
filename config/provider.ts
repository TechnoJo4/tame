import { AnthropicMessagesProvider } from "../llm/messages.ts";
import { InferenceProvider } from "../llm/types.ts";
import { PriorityProvider } from "../llm/router.ts";
import { Static, Object, Union, Literal, Array, String, Number, Optional, Type } from "typebox";
import { StringEnum } from "../util/string-enum.ts";
import { BackoffRatelimiter, Ratelimiter } from "../util/ratelimit.ts";
import { RatelimitedProvider } from "../llm/ratelimited.ts";

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
});

export type KnownProviderConfig = Static<typeof knownProviderConfig>;

export const messagesProviderConfig = Object({
	type: Literal("anthropic-messages"),
	apiUrl: knownProvider,
	apiKey: Optional(String()),
	model: String(),
});

export type MessagesProviderConfig = Static<typeof messagesProviderConfig>;

export const providerExtraConfig = Type.Object({
	headers: Optional(Object({}, { additionalProperties: String() })),
	limiter: Optional(ratelimiterConfig),
});

export type ProviderExtraConfig = Static<typeof providerExtraConfig>;

export const anyProviderConfig = Type.Intersect([
	Type.Union([ knownProviderConfig, messagesProviderConfig ]),
	providerExtraConfig
]);

export const autoProviderConfig = Object({
	type: Type.Literal("priority"),
	providers: Array(knownProviderConfig),
	maxDelay: Type.Number()
});

export const providerConfig = Union([ anyProviderConfig, autoProviderConfig ]);

export type ProviderConfig = Static<typeof providerConfig>;

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

export const parseExtra = (provider: InferenceProvider, extra: ProviderExtraConfig): InferenceProvider => {
	if (extra.limiter)
		provider = new RatelimitedProvider(provider, parseLimiter(extra.limiter));
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

export const parseProvider = (o: ProviderConfig): InferenceProvider => {
	switch (o.type) {
		case "provider":
			return parseExtra(parseKnownProvider(o), o);
		case "anthropic-messages":
			return parseExtra(parseMessagesProvider(o), o);
		case "priority":
			return new PriorityProvider(o.providers.map(parseProvider), o.maxDelay);
	}
};
