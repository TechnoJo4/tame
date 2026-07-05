import { Type, type Static } from "typebox";

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
    env: Type.Optional(Type.Object({
        static: Type.Optional(Type.Object({}, { additionalProperties: Type.String() })),
        dynamic: Type.Optional(Type.Object({}, { additionalProperties: dynamicEnvKey })),
    })),
    tools: Type.Optional(Type.Object({
        read: Type.Optional(Type.Boolean({ default: true })),
        write: Type.Optional(Type.Boolean({ default: true })),
        edit: Type.Optional(Type.Boolean({ default: true })),
        exec: Type.Optional(Type.Boolean({ default: false })),
        bash: Type.Optional(Type.Boolean({ default: true })),
    })),
});

export type OpsConfig = Static<typeof configSchema>;
