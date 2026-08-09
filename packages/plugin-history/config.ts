import { type Static, Type } from "typebox";

export const configSchema = Type.Object({
	sidebar: Type.Boolean({ default: true }),
});

export type HistoryConfig = Static<typeof configSchema>;
