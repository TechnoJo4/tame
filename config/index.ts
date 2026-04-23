import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Static, TSchema, Type } from "typebox";
import { parseProvider, providerConfig } from "./provider.ts";
import { InferenceProvider } from "../llm/types.ts";
import { readConfig } from "./validate.ts";

export const tameDataFolder = Deno.env.has("TAME_DATA")
	? resolve(Deno.env.get("TAME_DATA")!)
	: resolve(Deno.env.get("HOME") ?? ".", ".tame");

export const configSchema = Type.Object({
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

export const readTameConfig = <T extends TSchema>(path: string, schema: T): Static<T> => {
	return readConfig(resolve(tameDataFolder, path), schema);
};

export const config = parseConfig(readTameConfig("config.json", configSchema));
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
