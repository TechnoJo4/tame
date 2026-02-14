// load tools/plugins/etc from a folder
import { join, resolve, toFileUrl } from "@std/path";
import { promises as fs } from "node:fs";

export const pathJoin = join;
export const pathResolve = resolve;

export const importPath = async (path: string) => await import(toFileUrl(path).toString());

/** Import all files in a directory. Returns a list of module namespace objects. */
export const importAllInDir = async (dir: string, exts: string[] = [".ts"]): Promise<object[]> => {
    const res = [];
    for (const file of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
        if (file.isFile() && exts.find(e => file.name.endsWith(e))) {
            const exports = await importPath(resolve(file.parentPath, file.name));
            res.push(exports);
        }
    }
    return res;
};

/** Import all files in a directory. Returns a list of all their exports, ungrouped. */
export const importAllInDirFlat = async (dir: string, exts: string[] = [".ts"]): Promise<unknown[]> => {
    return (await importAllInDir(dir, exts)).flatMap(e => Object.values(e));
};
