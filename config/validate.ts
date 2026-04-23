import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { Static, TSchema } from "typebox";

const ajv = new Ajv();

export const readConfig = <T extends TSchema>(path: string, schema: T): Static<T> => {
    let data = {};
    try {
        data = JSON.parse(readFileSync(path, { encoding: "utf-8" }));;
    } catch {
        // ignore
    }
    if (!ajv.validate(schema, data)) {
        const errors = ajv.errors?.map(err => `- ${err.instancePath || err.params.missingProperty || "root"}: ${err.message}`);
        throw new Error(`invalid config ${path}:\n${errors?.join("\n")}`);
    }
    return data as Static<T>;
};
