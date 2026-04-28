import { Emitter } from "../../util/emitter.ts";
import type { Agent } from "../../agent/agent.ts";
import type { Plugin } from "../../agent/plugin.ts";
import * as harness from "../../agent/harness.ts";
import { tool, Type } from "../../agent/tool.ts";
import { readTameConfig } from "../../config/index.ts";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "@std/path";

export type Content =
	| { type: "text"; text: string }
	| { type: "bytes"; data: Uint8Array };

export interface Env {
	read(path: string): Promise<Uint8Array>;
	write(path: string, content: Content): Promise<void>;
	exec(
		command: string[],
		opts: { workdir?: string; timeout: number; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ReadEvent {
	agent: Agent;
	path: string;
	offset?: number;
	limit?: number;
	result?: Content;
}

export interface WriteEvent {
	agent: Agent;
	path: string;
	content: Content;
	result?: string;
}

export interface ExecEvent {
	agent: Agent;
	command: string[];
	workdir?: string;
	timeout: number;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

export interface OpsEvents {
	read: ReadEvent;
	write: WriteEvent;
	exec: ExecEvent;
}

const configSchema = Type.Object({
	maxLines: Type.Number({ default: 2000 }),
	maxBytes: Type.Number({ default: 50 * 1024 }),
	timeout: Type.Number({ default: 120_000 }),
});

const config = readTameConfig("ops.json", configSchema);

export const envKey = Symbol("tame:ops:env");

export function getEnv(agent: Agent): Env {
	return agent.pluginData.get(envKey) as Env;
}

export function setEnv(agent: Agent, env: Env) {
	agent.pluginData.set(envKey, env);
}

const home = process.env.HOME ?? "";

const contractHome = (path: string) => {
	if (path === home) return "~";
	if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
	return path;
};

const stripShell = (args: string[]) => {
	let i = 0;
	while (args[i]?.endsWith("sh")) {
		++i;
		while (args[i]?.startsWith("-")) ++i;
	}
	return args.slice(i);
};

const getExecName = (args: string[]) => {
	const a = stripShell(args);
	const s = a[0].indexOf(" ");
	return s === -1 ? a[0] : a[0].slice(0, s);
};

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

const localEnv: Env = {
	read: async (path) => {
		const resolved = resolve(path);
		try {
			await fs.access(resolved, fs.constants.R_OK);
		} catch {
			throw new Error(`${resolved}: access failed`);
		}
		const stat = await fs.stat(resolved);
		if (stat.size > config.maxBytes) {
			throw new Error(
				`${resolved}: file too large (${stat.size} bytes, max ${config.maxBytes})`,
			);
		}
		return new Uint8Array(await fs.readFile(resolved));
	},

	write: async (path, content) => {
		const resolved = resolve(path);
		const dir = dirname(resolved);
		try {
			await fs.mkdir(dir, { recursive: true });
		} catch {
			throw new Error(`${dir}: failed to create directory`);
		}
		const data = content.type === "bytes"
			? content.data
			: new TextEncoder().encode(content.text);
		await fs.writeFile(resolved, data);
	},

	exec: async (command, opts) => {
		if (opts.workdir) {
			try {
				await fs.access(opts.workdir, fs.constants.R_OK);
			} catch {
				throw new Error(`${opts.workdir}: access failed`);
			}
		}
		const [name, ...args] = command;
		const proc = spawn(name, args, {
			detached: true,
			cwd: opts.workdir,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const stdout: string[] = [];
		const stderr: string[] = [];
		const decoder = new TextDecoder();
		proc.stdout.on(
			"data",
			(data) => stdout.push(decoder.decode(data, { stream: true })),
		);
		proc.stderr.on(
			"data",
			(data) => stderr.push(decoder.decode(data, { stream: true })),
		);

		const onAbort = () => {
			if (proc.pid) killTree(proc.pid);
		};
		if (opts.signal?.aborted) onAbort();
		else opts.signal?.addEventListener("abort", onAbort, { once: true });

		const timeoutId = opts.timeout
			? setTimeout(() => {
				if (proc.pid && !proc.exitCode) killTree(proc.pid);
			}, opts.timeout)
			: undefined;

		await new Promise<void>((resolve, reject) => {
			proc.once("close", () => resolve());
			proc.once("error", reject);
		});

		if (timeoutId) clearTimeout(timeoutId);
		opts.signal?.removeEventListener("abort", onAbort);

		return {
			stdout: stdout.join(""),
			stderr: stderr.join(""),
			exitCode: proc.exitCode ?? 1,
		};
	},
};

export const ops = new Emitter<OpsEvents>();

ops.after("read", async (e) => {
	if (e.result) return e;
	const env = getEnv(e.agent);
	const data = await env.read(e.path);
	e.result = { type: "bytes", data };
	return e;
});

ops.after("read", async (e) => {
	if (!e.result || e.result.type !== "bytes") return e;
	let text = new TextDecoder().decode(e.result.data);

	const lines = text.split("\n");
	const startLine = e.offset ? Math.max(0, e.offset - 1) : 0;
	const endLine = Math.min(startLine + (e.limit ?? config.maxLines), lines.length);

	text = lines.slice(startLine, endLine).join("\n");
	const notice = [
		`showing lines ${startLine + 1}-${endLine}`,
		endLine >= lines.length
			? `end of file reached`
			: `use offset=${endLine + 1} to continue`,
	];
	text += `\n\n[${notice.join(". ")}]`;

	e.result = { type: "text", text };
	return e;
});

ops.after("write", async (e) => {
	if (e.result) return e;
	const env = getEnv(e.agent);
	await env.write(e.path, e.content);
	e.result = `${e.path}: successfully created.`;
	return e;
});

ops.after("exec", async (e) => {
	if (e.stdout !== undefined || e.exitCode !== undefined) return e;
	const env = getEnv(e.agent);
	const res = await env.exec(e.command, {
		workdir: e.workdir,
		timeout: e.timeout
	});
	e.stdout = res.stdout;
	e.stderr = res.stderr;
	e.exitCode = res.exitCode;
	return e;
});

export async function edit(
	agent: Agent,
	path: string,
	fn: (content: string) => string,
): Promise<string> {
	const env = getEnv(agent);
	const data = await env.read(path);
	const oldContent = new TextDecoder().decode(data);
	const newContent = fn(oldContent);

	const e = await ops.do("write", {
		agent,
		path,
		content: { type: "text", text: newContent },
	});
	return e.result ?? "ok";
}

const readTool = tool({
	name: "read",
	desc: "Read a file",
	args: Type.Object({
		path: Type.String({ description: "Path to the file (relative or absolute)" }),
		offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
		limit: Type.Optional( Type.Number({ description: "Max number of lines to read" })) }),
	exec: async (args, agent) => {
		const e = await ops.do("read", {
			agent,
			path: args.path,
			offset: args.offset,
			limit: args.limit,
		});
		if (!e.result) throw new Error("no handler processed read");
		if (e.result.type === "text") return e.result.text;
		return "[binary data]";
	},
	view: {
		compact: (args) => `Read ${args.path}`,
		acp: (args) => ({
			title: `Read ${contractHome(args.path)}`,
		}),
	},
});

const writeTool = tool({
	name: "write",
	desc:
		"Write a file. Creates a file if it does not exist, overwrites if it does. Automatically creates parent directories.",
	args: Type.Object({
		path: Type.String({
			description: "Path to the file (relative or absolute)",
		}),
		content: Type.String({ description: "Text to write into the file" }),
	}),
	exec: async (args, agent) => {
		const e = await ops.do("write", {
			agent,
			path: args.path,
			content: { type: "text", text: args.content },
		});
		return e.result ?? "ok";
	},
	view: {
		compact: (args) => `Write ${args.path}`,
		acp: (args) => ({
			kind: "edit",
			title: `Write ${contractHome(args.path)}`,
			content: [ {
				"type": "content",
				"content": {
					"type": "text",
					"text": args.content
				},
			} ],
		}),
	},
});

const editTool = tool({
	name: "edit",
	desc: "Replace a string in an existing file (use for precise, surgical edits)",
	args: Type.Object({
		path: Type.String({ description: "Path to the file (relative or absolute)" }),
		oldString: Type.String({ description: "Text to find and replace (must match exactly, including whitespace)" }),
		newString: Type.String({ description: "Text to put in its place" }),
	}),
	exec: async (args, agent) => {
		return await edit(agent, args.path, (content) => {
			let count = 0;
			let idx = -1;
			while ((idx = content.indexOf(args.oldString, idx + 1)) !== -1) count++;
			if (count === 0)
				throw new Error(`${args.path} does not contain ${JSON.stringify(args.oldString)}`);
			if (count > 1) 
				throw new Error(`${args.path} contains ${JSON.stringify(args.oldString)} more than once (${count} occurrences)`);
			return content.replace(args.oldString, args.newString);
		});
	},
	view: {
		compact: (args) => `Edit ${args.path}`,
		acp: (args) => ({
			title: `Edit ${contractHome(args.path)}`,
		}),
	},
});

const execTool = tool({
	name: "exec",
	desc: `Run a shell command and returns its output.
- The arguments to shell will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the workdir param when using the shell function. Do not cd unless absolutely necessary.`,
	args: Type.Object({
		command: Type.Array(Type.String(), {
			description: "Command line for the new process",
			minItems: 1,
		}),
		workdir: Type.Optional(Type.String({ description: "Working directory to execute the command in" })),
		timeout: Type.Number({ description: "Timeout for the command in milliseconds" }),
	}),
	exec: async (args, agent) => {
		const e = await ops.do("exec", {
			agent,
			command: args.command,
			workdir: args.workdir,
			timeout: args.timeout,
		});
		return [
			e.exitCode !== 0 ? `exited with code ${e.exitCode}.` : "",
			e.stdout ? `stdout:\n${e.stdout}` : "",
			e.stderr ? `stderr:\n${e.stderr}` : "",
		].filter((s) => s !== "").join("\n\n") || "ok";
	},
	view: {
		compact: ({ command }) => `exec ${getExecName(command)}`,
		acp: ({ command }, result) => {
			if (!command) return;
			const cmd = stripShell(command).join(" ");
			const content = [{
				"type": "content",
				"content": {
					"type": "text",
					"text": cmd.includes("`")
						? "```\n" + cmd + "\n```\n"
						: "`" + cmd + "`",
				},
			}];
			if (result && !result.is_error) {
				content.push({
					"type": "content",
					"content": {
						"type": "text",
						"text": result.content.includes("```")
							? result.content
							: "```\n" + result.content + "\n```\n",
					},
				});
			}
			return {
				title: getExecName(command),
				content,
			};
		},
	},
});

export default {
	async init() {
		harness.tools.push(readTool, writeTool, editTool, execTool);
	},
	newAgent(agent: Agent) {
		setEnv(agent, localEnv);
	},
} as Plugin;
