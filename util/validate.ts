import { Static, TSchema } from "typebox";
import Compile, { Validator } from "typebox/compile";

export const assertSchema = <T extends TSchema>(data: unknown, schema: T, baseError: string, val_?: Validator<any>): Static<T> => {
	const val = (val_ ?? Compile(schema)) as Validator<any, T>;
	data = structuredClone(data);
	data = val.Default(data);
	data = val.Convert(data);
	data = val.Clean(data);
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
	return data;
};
