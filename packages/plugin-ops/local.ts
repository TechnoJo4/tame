import {dirname, resolve} from "@std/path";
import {spawn} from "node:child_process";
import {promises as fs} from "node:fs";

import type {OpsConfig} from "./config.ts";
import type {Env, ExecOpts, ExecResult, FileEnv} from "./env.ts";

const home = process.env.HOME ?? "";

// deno-fmt-ignore
const stripAnsi = (s: string) => // deno-lint-ignore no-control-regex
    s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\].*?(\x07|\x1b\\)/g, "");

const killTree = (pid: number) => {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// ignore
		}
	}
};

export default class LocalEnv implements Env {
	#lock = new Map<string, Promise<void>>();

	config: OpsConfig;
	readonly defaultWorkdir: string;

	constructor(config: OpsConfig) {
		this.config = config;
		this.defaultWorkdir = this.resolvePath(config.localEnv.workdir);
	}

	resolvePath(...pathSegments: string[]): string {
		return resolve(...pathSegments.map(seg => {
			if (seg === "~") return resolve(home);
			if (seg.startsWith("~/")) return resolve(home, seg.substring(2));
			return seg;
		}));
	}

	async lock<T>(path: string, f: (env: FileEnv) => Promise<T>): Promise<T> {
		const resolved = this.resolvePath(path);
		const fileEnv: FileEnv = {
			path: resolved,
			exists: async () => {
			    try {
				    await fs.stat(resolved);
				    return true;
			    } catch (e) {
				    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
				    throw new Error(`${resolved}: access failed`);
			    }
			},
			read: async () => {
			    let stat;
			    try {
				    stat = await fs.stat(resolved);
			    } catch { throw new Error(`${resolved}: access failed`); }
			    if (stat.size > this.config.maxReadBytes) {
				    throw new Error(
				        `${resolved}: file too large (${stat.size} bytes, max ${this.config.maxReadBytes})`);
			    }
			    return new Uint8Array(await fs.readFile(resolved));
			},
			write: async (content) => {
			    const dir = dirname(resolved);
			    try {
				    await fs.mkdir(dir, { recursive: true });
			    } catch { throw new Error(`${dir}: failed to create directory`); }
			    const data = content.type === "bytes" ? content.data : new TextEncoder().encode(content.text);
			    await fs.writeFile(resolved, data);
			},
		};

		const prev = this.#lock.get(resolved) ?? Promise.resolve();
		const p = Promise.withResolvers<void>();
		this.#lock.set(resolved, p.promise);
		try {
			await prev;
			return await f(fileEnv);
		} finally { p.resolve(); }
	}

	async exec(command: string[], opts: ExecOpts): Promise<ExecResult> {
		if (opts.workdir) {
			opts.workdir = this.resolvePath(opts.workdir);
			try {
				await fs.access(opts.workdir, fs.constants.R_OK);
			} catch { throw new Error(`${opts.workdir}: access failed`); }
		}
		const [name, ...args] = command;
		const proc = spawn(name, args, {
			detached: true,
			cwd: opts.workdir,
			stdio: ["ignore", "pipe", "pipe"],
			env: {...process.env, ...opts.env },
		});

		const stdout: string[] = [];
		const stderr: string[] = [];
		const decoder = new TextDecoder();
		proc.stdout.on("data", (data) => stdout.push(decoder.decode(data, { stream: true })));
		proc.stderr.on("data", (data) => stderr.push(decoder.decode(data, { stream: true })));

		let abortReason: "abort"|"timeout"|undefined = undefined;
		const onAbort = (reason: "abort"|"timeout") => {
			if (proc.pid && proc.exitCode === null) killTree(proc.pid);
			abortReason = reason;
		};
		const abortListener = () => onAbort("abort");
		if (opts.signal?.aborted)
			onAbort("abort");
		else
			opts.signal?.addEventListener("abort", abortListener, { once: true });

		const timeoutId = opts.timeout ? setTimeout(() => onAbort("timeout"), opts.timeout) : undefined;
		await new Promise<void>((resolve, reject) => {
			proc.once("close", () => resolve());
			proc.once("error", reject);
		});

		if (timeoutId) clearTimeout(timeoutId);
		opts.signal?.removeEventListener("abort", abortListener);

		return {
			stdout: stripAnsi(stdout.join("")),
			stderr: stripAnsi(stderr.join("")),
			exit: abortReason ?? proc.exitCode ?? 1,
		};
	}

	contractPath(path: string): string {
		if (path === home) return "~";
		if (home && (path.startsWith(home + "/") || path.startsWith(home + "\\"))) {
			return "~" + path.slice(home.length);
		}
		return path;
	}
}
