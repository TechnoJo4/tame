import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { Static, TSchema } from "@sinclair/typebox";

const ajv = new Ajv();

export const readConfig = <T extends TSchema>(path: string, schema: T): Static<T> => {
    let data = {};
    try {
        data = JSON.parse(readFileSync(path, { encoding: "utf-8" }));;
    } catch {
        // ignore
    }
    if (!ajv.validate(schema, data))
        throw new Error(`invalid config ${path}:\n${ajv.errors?.join("\n")}`);
    return data;
};
