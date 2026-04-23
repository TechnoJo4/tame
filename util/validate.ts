import { Static, TSchema } from "typebox";
import Compile, { Validator } from "typebox/compile";

export const assertSchema = <T extends TSchema>(data: unknown, schema: T, baseError: string, val?: Validator<any>): Static<T> => {
	data = structuredClone(data);
	if (val === undefined)
		val = Compile(schema);

	val.Default(data);
	val.Convert(data);
	val.Clean(data);
	if (!val.Check(data)) {
		const errors = val.Errors(data);
		const s = [baseError];
		for (const err of errors) {
			const path = err.instancePath.replace(/^\//, "").replace(/\//g, ".") || "root";
			if (err.keyword === "required") {
				for (const p of err.params.requiredProperties) {
					s.push(`- ${path}.${p}: required`);
				}
			} else {
				s.push(`- ${path}: ${err.message}`);
			}
		}
		throw new Error(s.join("\n"));
	}
	return data as Static<T>;
};
