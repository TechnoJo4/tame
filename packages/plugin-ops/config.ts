import { type Static, Type } from "typebox";

const dynamicEnvKey = Type.Union([
	Type.Literal("MODEL"),
	Type.Literal("AGENT_ID"),
	Type.Literal("AGENT_SYSTEM"),
]);

export const configSchema = Type.Object({
	maxLines: Type.Number({ default: 2000 }),
	defaultLines: Type.Number({ default: 200 }),
	maxBytes: Type.Number({ default: 50 * 1024 }),
	maxReadBytes: Type.Number({ default: 50 * 1024 * 1024 }),
	timeout: Type.Number({ default: 120_000 }),
	shell: Type.Array(Type.String(), { default: ["bash", "-lc"] }),
	defaultEnv: Type.String({ default: "local" }),
	localEnv: Type.Object({
		workdir: Type.String({ default: "." }),
	}, { default: {} }),
	env: Type.Object({
		static: Type.Object({}, { additionalProperties: Type.String(), default: {} }),
		dynamic: Type.Object({}, { additionalProperties: dynamicEnvKey, default: {} }),
	}, { default: {} }),
	tools: Type.Object({
		read: Type.Boolean({ default: true }),
		write: Type.Boolean({ default: true }),
		edit: Type.Boolean({ default: true }),
		exec: Type.Boolean({ default: false }),
		bash: Type.Boolean({ default: true }),
	}, { default: {} }),
});

export type OpsConfig = Static<typeof configSchema>;
