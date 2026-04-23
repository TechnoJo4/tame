import { readFileSync } from "node:fs";
import { Static, TSchema } from "typebox";
import { assertSchema } from "../util/validate.ts";

export const readConfig = <T extends TSchema>(path: string, schema: T): Static<T> => {
	let data = {};
	try {
		data = JSON.parse(readFileSync(path, { encoding: "utf-8" }));;
	} catch {
		// ignore
	}
	return assertSchema(data, schema, `invalid config "${path}":`);
};
