import { pathResolve, tool, Type } from "@tame/agent";
import { see, state } from "../state.ts";
import { DEFAULT_MAX_LINES, getLineIndices } from "../truncate.ts";
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

        return `${selected.join("\n")}\n\n[${notice.join(". ")}]`;
    },
    see
});

export const edit = tool({
    def: {
        name: "fileEdit",
        description: "replace a string in an existing file (use for precise, surgical edits)",
        parameters: Type.Object({
            path: Type.String({ description: "path to the file (relative or absolute)" }),
            oldString: Type.String({
                description: "text to find and replace (must match exactly, including whitespace)"
            }),
            newString: Type.String({
                description: "text to put in its place"
            })
        })
    },
    run: async (args, agent) => {
        const s = state(agent);
        const path = pathResolve(s.cwd, args.path);
        try { await fs.access(path, fs.constants.R_OK | fs.constants.W_OK) } catch {
            throw new Error(`${path}: access denied`)
        }

        const content = await fs.readFile(path, { encoding: "utf-8" });
        const newContent = content.replace(args.oldString, args.newString);

        if (newContent.includes(args.oldString))
            throw new Error(`${path} contains ${JSON.stringify(args.oldString)} more than once`);

        // TODO: hooks

        await fs.writeFile(path, newContent, { encoding: "utf-8" });

        const editStart = content.indexOf(args.oldString);
        const editEnd = editStart + args.newString.length;
        const lineIndices = getLineIndices(newContent);

        const lineStart = Math.max(lineIndices.findIndex(i => i <= editStart) - 1, 0);
        const lineEnd = Math.min(lineIndices.findLastIndex(i => i >= editEnd) + 1, lineIndices.length-1);

        const snippet = newContent.substring(lineIndices[lineStart]+1, lineIndices[lineEnd])
        const notice = [
            `result: success`,
            `showing lines ${lineStart+1}-${lineEnd} of updated file`
        ];

        return `${snippet}\n\n[${notice.join(". ")}]`;
    },
    see: true
});
