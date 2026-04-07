
import { tool, Type } from "../../agent/tool.ts";
import { promises as fs } from "node:fs";
import { resolve, dirname } from "@std/path";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export const getLineIndices = (str: string) => {
    const res = [];
    for (let i = -1; i !== -1; i = str.indexOf("\n", i))
        res.push(i);
    return res;
};

export const read = tool({
    name: "read",
    desc: "Read a file",
    args: Type.Object({
        path: Type.String({ description: "Path to the file (relative or absolute)" }),
        offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
        limit: Type.Optional(Type.Number({ description: "Max number of lines to read" })),
    }),
    exec: async (args) => {
        const path = resolve(args.path);
        try { await fs.access(path, fs.constants.R_OK) } catch {
            throw new Error(`${path}: access failed`)
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
    view: {
        compact: (args) => `Read ${args.path}`,
        acp: (args) => ({
            kind: "read",
            title: `Read ${args.path}`
        })
    }
});

export const edit = tool({
    name: "edit",
    desc: "Replace a string in an existing file (use for precise, surgical edits)",
    args: Type.Object({
        path: Type.String({ description: "Path to the file (relative or absolute)" }),
        oldString: Type.String({ description: "Text to find and replace (must match exactly, including whitespace)" }),
        newString: Type.String({ description: "Text to put in its place" })
    }),
    exec: async (args) => {
        const path = resolve(args.path);
        try { await fs.access(path, fs.constants.R_OK | fs.constants.W_OK) } catch {
            throw new Error(`${path}: access failed`)
        }

        const content = await fs.readFile(path, { encoding: "utf-8" });

        if (!content.includes(args.oldString))
            throw new Error(`${path} does not contain ${JSON.stringify(args.oldString)}`);

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
    view: {
        compact: (args) => `Edit ${args.path}`,
        acp: (args) => ({
            kind: "edit",
            title: `Edit ${args.path}`
            // TODO: diff
        })
    }
});

export const write = tool({
    name: "write",
    desc: "Write a file. Creates a file if it does not exist, overwrites if it does. Automatically creates parent directories.",
    args: Type.Object({
        path: Type.String({ description: "Path to the file (relative or absolute)" }),
        content: Type.String({ description: "Text to write into the file" }),
    }),
    exec: async (args) => {
        const path = resolve(args.path);
        const dir = dirname(path);

        try {
            await fs.mkdir(dir, { recursive: true });
        } catch {
            throw new Error(`${dir}: failed to create directory`);
        }

        try {
            await fs.writeFile(path, args.content, { encoding: "utf-8" });
        } catch {
            throw new Error(`${path}: failed to write file`);
        }

        // TODO: hooks

        return `${path}: successfully created.`;
    },
    view: {
        compact: (args) => `Write ${args.path}`,
        acp: (args) => ({
            kind: "edit",
            title: `Write ${args.path}`
        })
    }
});

export default [ read, write, edit ];
