import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { Object } from "@sinclair/typebox";
import { providerConfig } from "./provider.ts";

export const tameDataFolder = resolve(Deno.env.get("TAME_DATA") ?? "~/.tame");

export const tameConfigFile = resolve(tameDataFolder, "config.json");

export const configSchema = Object({
	llm: providerConfig
});

const ajv = new Ajv();
const parseConfig = ajv.compile(configSchema);

let configData = {};
try {
	configData = JSON.parse(readFileSync(tameConfigFile, { encoding: "utf-8" }));
} catch {
	// ignore
}

if (!parseConfig(configData))
	throw new Error("invalid config:" + parseConfig.errors?.join("\n"));

export const config = configData;
