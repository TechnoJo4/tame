import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Static, TSchema, Type } from "typebox";
import { parseLLM, llmConfig } from "./provider.ts";
import { InferenceProvider, readTameConfig, tameDataFolder } from "@tame/sdk";

export const configSchema = Type.Object({
	llm: llmConfig,
	plugins: Type.Array(Type.String()),
	pluginSources: Type.Optional(Type.Array(Type.String())),
});

export interface Config {
	llm: InferenceProvider;
	plugins: string[];
	pluginSources: string[];
}

export const parseConfig = (o: Static<typeof configSchema>): Config => {
	return {
		llm: parseLLM(o.llm),
		plugins: o.plugins,
		pluginSources: o.pluginSources ?? [resolve(tameDataFolder, "plugins")],
	};
};

export const config = parseConfig(readTameConfig("config.json", configSchema));
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
