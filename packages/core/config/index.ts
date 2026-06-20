import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { type Static, Type } from "typebox";
import { parseLLM, llmConfig } from "./provider.ts";
import { type InferenceProvider, readTameConfig, tameDataFolder } from "@tame/sdk";

export const configSchema = Type.Object({
	providers: Type.Object({}, { additionalProperties: llmConfig }),
	defaultProvider: Type.String(),
	plugins: Type.Array(Type.String()),
	pluginSources: Type.Optional(Type.Array(Type.String())),
});

export interface Config {
	providers: Record<string, InferenceProvider>;
	defaultProvider: string;
	plugins: string[];
	pluginSources: string[];
}

export const parseConfig = (o: Static<typeof configSchema>): Config => {
	if (!(o.defaultProvider in o.providers))
		throw new Error(`defaultProvider (${o.defaultProvider}) is not one of the defined providers (${Object.keys(o.providers).join(", ")})`);

	return {
		providers: Object.fromEntries(Object.entries(o.providers).map(([k,llm]) => [k,parseLLM(llm)])),
		defaultProvider: o.defaultProvider,
		plugins: o.plugins,
		pluginSources: o.pluginSources ?? [resolve(tameDataFolder, "plugins")],
	};
};

export const config = parseConfig(readTameConfig("config.json", configSchema));
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
