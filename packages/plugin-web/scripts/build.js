import {join, resolve} from "@std/path";

import {buildAll} from "../build.ts";

const packageDir = resolve(import.meta.dirname, "..");
const context = {
	rootDir: resolve(packageDir, "..", ".."),
	packageDir,
	staticDir: join(packageDir, "static"),
	buildDir: join(packageDir, ".build"),
};

console.log("bundling...");
await buildAll(context, false);
console.log("build done.");
