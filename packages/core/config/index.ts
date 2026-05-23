import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Static, TSchema, Type } from "typebox";
import { parseLLM, llmConfig } from "./provider.ts";
import { InferenceProvider, readTameConfig, tameDataFolder } from "@tame/sdk";

export const configSchema = Type.Object({
	llm: llmConfig,
	toolsets: Type.Array(Type.String()),
	plugins: Type.Array(Type.String()),
});

export interface Config {
	llm: InferenceProvider;
	toolsets: string[];
	plugins: string[];
}

export const parseConfig = (o: Static<typeof configSchema>): Config => {
	return {
		llm: parseLLM(o.llm),
		toolsets: o.toolsets,
		plugins: o.plugins,
	};
};

export const config = parseConfig(readTameConfig("config.json", configSchema));
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
