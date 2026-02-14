import { pathResolve, tool, Type } from "@tame/agent";
import { see, state } from "../state.ts";
import { DEFAULT_MAX_LINES } from "../truncate.ts";
import { promises as fs } from "node:fs";

export const read = tool({
    def: {
        name: "fileRead",
        description: "read a file",
        parameters: Type.Object({
            path: Type.String({ description: "path to the file (relative or absolute)" }),
            offset: Type.Optional(Type.Number({ description: "line number to start reading from (1-indexed)" })),
            limit: Type.Optional(Type.Number({ description: "max number of lines to read" })),
        })
    },
    run: async (args, agent) => {
        const s = state(agent);
        const path = pathResolve(s.cwd, args.path);
        try { await fs.access(path, fs.constants.R_OK) } catch {
            throw new Error(`${path}: access denied`)
        }

        const content = await fs.readFile(path, { encoding: "utf-8" });
        const lines = content.split("\n");

        const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;
        const endLine = Math.min(startLine + (args.limit ? args.limit : DEFAULT_MAX_LINES), lines.length);

        const selected = lines.slice(startLine, endLine)
        const notice = [
            `showing lines ${startLine+1}-${endLine}`,
            endLine >= lines.length ? `end of file reached` : `use offset=${endLine+1} to continue`
        ];

        return `${selected}\n\n[${notice.join(". ")}]`;
    },
    see
});

