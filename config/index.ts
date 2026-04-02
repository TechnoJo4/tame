import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { Object, Static } from "@sinclair/typebox";
import { parseProvider, providerConfig } from "./provider.ts";
import { InferenceProvider } from "../llm/types.ts";

export const tameDataFolder = resolve(Deno.env.get("TAME_DATA") ?? "~/.tame");

export const tameConfigFile = resolve(tameDataFolder, "config.json");

export const configSchema = Object({
	llm: providerConfig
});

const ajv = new Ajv();
const validateConfig = ajv.compile(configSchema);

let configData = {};
try {
	configData = JSON.parse(readFileSync(tameConfigFile, { encoding: "utf-8" }));
} catch {
	// ignore
}

if (!validateConfig(configData))
	throw new Error("invalid config:" + validateConfig.errors?.join("\n"));

export interface Config {
	llm: InferenceProvider;
}

export const parseConfig = (o: Static<typeof configSchema>): Config => {
	return {
		llm: parseProvider(o.llm)
	};
};

export const config = parseConfig(configData);
export const system = readFileSync(resolve(tameDataFolder, "system.txt"), { encoding: "utf-8" });
