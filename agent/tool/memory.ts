import db from "../db.ts";
import { tool, Type } from "../tool.ts";

// TODO: mutex writes

// TODO: config
const maxBlockSize = 10000;

export const create = tool({
    def: {
        name: "memoryCreate",
        description: "create a new block of memory.",
        parameters: Type.Object({
            block: Type.String({ description: "name of the memory block to create" }),
            content: Type.String({
                description: "initial content of the memory block",
                maxLength: maxBlockSize
            })
        })
    },
    run: async (args, agent) => {
        if (args.block === "self") args.block = agent.selfBlock!;
        if (await db.memory.memoryExists(args.block))
            throw new Error(`block "${args.block}" already exists, rewrite it or use a different block name instead`);
        await db.memory.set(args.block, args.content);
        await db.memory.attach(agent.id, args.block);
        return `result: success.`;
    },
    see: true
});

export const write = tool({
    def: {
        name: "memoryWrite",
        description: "rewrite a block of memory.",
        parameters: Type.Object({
            block: Type.String({ description: "name of the memory block to rewrite" }),
            content: Type.String({
                description: "new content of the memory block",
                maxLength: maxBlockSize
            })
        })
    },
    run: async (args, agent) => {
        if (args.block === "self") args.block = agent.selfBlock!;
        if (!await db.memory.isAttached(agent.id, args.block))
            throw new Error(`block "${args.block}" must exist and be attached before it can be modified`);
        await db.memory.set(args.block, args.content);
        return `result: success.`;
    },
    see: true
});

export const replace = tool({
    def: {
        name: "memoryReplace",
        description: "replace a string in a block of memory.",
        parameters: Type.Object({
            block: Type.String({ description: "name of the memory block to edit" }),
            oldString: Type.String({
                description: "the text to remove. must appear only once in the block (use memoryWrite for bulk edits)"
            }),
            newString: Type.String({
                description: "the text to put in its place."
            })
        })
    },
    run: async (args, agent) => {
        if (args.block === "self") args.block = agent.selfBlock!;
        if (!await db.memory.isAttached(agent.id, args.block))
            throw new Error(`block "${args.block}" must exist and be attached before it can be modified`);
        const oldBlock = await db.memory.get(args.block);
        const newBlock = oldBlock.replace(args.oldString, args.newString);
        if (oldBlock.includes(newBlock))
            throw new Error(`block "${args.block}" contains ${JSON.stringify(args.oldString)} more than once`);
        if (newBlock.length > maxBlockSize)
            throw new Error(`max block size limit (${maxBlockSize}) would be exceeded`);
        await db.memory.set(args.block, newBlock);
        return `result: success.`;
    },
    see: true
});

export const attach = tool({
    def: {
        name: "memoryAttach",
        description: "attach a block of memory.",
        parameters: Type.Object({
            block: Type.String({ description: "name of the memory block to attach" })
        })
    },
    run: async (args, agent) => {
        if (args.block === "self") args.block = agent.selfBlock!;
        if (!await db.memory.memoryExists(args.block))
            throw new Error(`block "${args.block}" does not exist`);
        if (await db.memory.isAttached(agent.id, args.block))
            throw new Error(`block "${args.block}" is already attached to this agent`);
        await db.memory.attach(agent.id, args.block);
        return `result: success.`;
    },
    see: true
});

export const detach = tool({
    def: {
        name: "memoryDetach",
        description: "detach a block of memory.",
        parameters: Type.Object({
            block: Type.String({ description: "name of the memory block to detach" })
        })
    },
    run: async (args, agent) => {
        if (args.block === "self") args.block = agent.selfBlock!;
        if (!await db.memory.isAttached(agent.id, args.block))
            throw new Error(`block "${args.block}" is not attached to this agent`);
        await db.memory.detach(agent.id, args.block);
        return `result: success.`;
    },
    see: true
});
