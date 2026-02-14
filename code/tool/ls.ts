import { pathResolve, tool, Type } from "@tame/agent";
import { see, state } from "../state.ts";
import { promises as fs } from "node:fs";

export const ls = tool({
    def: {
        name: "ls",
        description: "list directory contents. returns entries sorted alphabetically, with '/' suffix for directories.",
        parameters: Type.Object({
            path: Type.Optional(Type.String({ description: "path to the directory (relative or absolute)" }))
        })
    },
    run: async (args, agent) => {
        const s = state(agent);
        const path = pathResolve(s.cwd, args.path || ".");
        try { await fs.access(path, fs.constants.R_OK) } catch {
            throw new Error(`${path} does not exist`)
        }
        if (!(await fs.stat(path)).isDirectory())
            throw new Error(`${path} is not a directory`)

        const entries = await fs.readdir(path, { withFileTypes: true });
        const names = entries.map(e => e.isDirectory() ? e.name + "/" : e.name);
        names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        return names.join("\n");
    },
    see
});

