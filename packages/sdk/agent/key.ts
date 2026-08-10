export type Key<T> = symbol & { readonly _: T };

export const key = <T>(description: string): Key<T> => Symbol(description) as Key<T>;
