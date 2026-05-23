import { resolve } from "node:path";
import { TSchema, Static } from "typebox";
import { readConfig } from "./validate.ts";

export const tameDataFolder = Deno.env.has("TAME_DATA")
	? resolve(Deno.env.get("TAME_DATA")!)
	: resolve(Deno.env.get("HOME") ?? ".", ".tame");

export const readTameConfig = <T extends TSchema>(path: string, schema: T): Static<T> => {
	return readConfig(resolve(tameDataFolder, path), schema);
};
