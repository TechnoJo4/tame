import { type Static, Type } from "typebox";

const projectSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	workdir: Type.String({ minLength: 1 }),
	files: Type.Array(Type.String({ minLength: 1 }), { default: ["AGENTS.md"] }),
});

export const configSchema = Type.Object({
	projects: Type.Array(projectSchema),
});

export type ProjectConfig = Static<typeof projectSchema>;
export type ProjectsConfig = Static<typeof configSchema>;
