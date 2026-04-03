import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Object, Static, Type } from "@sinclair/typebox";
import { parseProvider, providerConfig } from "./provider.ts";
import { InferenceProvider } from "../llm/types.ts";
import { readConfig } from "./validate.ts";

export const tameDataFolder = resolve(Deno.env.get("TAME_DATA") ?? "~/.tame");

export const tameConfigFile = resolve(tameDataFolder, "config.json");

export const configSchema = Object({
	llm: providerConfig,
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
		llm: parseProvider(o.llm),
		toolsets: o.toolsets,
		plugins: o.plugins,
	};
};

export const config = parseConfig(readConfig(tameConfigFile, configSchema));
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
