import { type TUnsafe, Type } from "typebox";

export const StringEnum = <T extends readonly string[]>(values: T, options?: { description?: string; default?: T[number] }): TUnsafe<T[number]> =>
    Type.Unsafe<T[number]>({ type: "string", enum: values, ...options });
