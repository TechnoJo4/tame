import { Emitter, tool, Type, type IAgent, type IHarness, type Plugin } from "@tame/sdk";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "@std/path";
import type { Static } from "typebox";
import type { WebPlugin } from "@tame/plugin-web/index";

export type Content =
	| { type: "text"; text: string }
	| { type: "bytes"; data: Uint8Array };

export interface Env {
	read(path: string): Promise<Uint8Array>;
	write(path: string, content: Content): Promise<void>;
	exec(
		command: string[],
		opts: { workdir?: string; timeout: number; signal?: AbortSignal; env?: Record<string, string> },
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ReadEvent {
	agent: IAgent;
	path: string;
	offset?: number;
	limit?: number;
	result?: Content;
}

export interface WriteEvent {
	agent: IAgent;
	path: string;
	content: Content;
	result?: string;
}

export interface ExecEvent {
	agent: IAgent;
	command: string[];
	workdir?: string;
	timeout: number;
	env?: Record<string, string>;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

export interface OpsEvents {
	read: ReadEvent;
	write: WriteEvent;
	exec: ExecEvent;
}

const dynamicEnvKey = Type.Union([
	Type.Literal("MODEL"),
	Type.Literal("AGENT_ID"),
	Type.Literal("AGENT_SYSTEM"),
]);

export const configSchema = Type.Object({
	maxLines: Type.Number({ default: 2000 }),
	maxBytes: Type.Number({ default: 50 * 1024 }),
	timeout: Type.Number({ default: 120_000 }),
	shell: Type.Array(Type.String(), { default: ["bash", "-lc"] }),
	env: Type.Optional(Type.Object({
		static: Type.Optional(Type.Object({}, { additionalProperties: Type.String() })),
		dynamic: Type.Optional(Type.Object({}, { additionalProperties: dynamicEnvKey })),
	})),
	tools: Type.Optional(Type.Object({
		read: Type.Optional(Type.Boolean({ default: true })),
		write: Type.Optional(Type.Boolean({ default: true })),
		edit: Type.Optional(Type.Boolean({ default: true })),
		exec: Type.Optional(Type.Boolean({ default: true })),
	})),
});

export type OpsConfig = Static<typeof configSchema>;

export const envKey = Symbol("tame:ops:env");

export function getEnv(agent: IAgent): Env {
	return agent.pluginData.get(envKey) as Env;
}

export function setEnv(agent: IAgent, env: Env) {
	agent.pluginData.set(envKey, env);
}

const home = process.env.HOME ?? "";

const contractHome = (path: string) => {
	if (path === home) return "~";
	if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
	return path;
};

const stripShell = (args: string[]): string[] => {
	let i = 0;
	while (args[i]?.endsWith("sh")) {
		++i;
		while (args[i]?.startsWith("-")) ++i;
	}
	return args.slice(i);
};

const getExecName = (args: string[]): string => {
	const a = stripShell(args);
	const s = a[0].indexOf(" ");
	return s === -1 ? a[0] : a[0].slice(0, s);
};

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

export class OpsPlugin implements Plugin {
	id = "ops" as const;

	config: OpsConfig;
	emitter = new Emitter<OpsEvents>();

	#localEnv: Env;

	constructor(config: OpsConfig) {
		this.config = config;

		this.#localEnv = {
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
					env: { ...process.env, ...config.env?.static, ...opts.env },
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
					stdout: stripAnsi(stdout.join("")),
					stderr: stripAnsi(stderr.join("")),
					exitCode: proc.exitCode ?? 1,
				};
			},
		};

		this.emitter.after("read", async (e) => {
			if (e.result) return e;
			const env = getEnv(e.agent);
			const data = await env.read(e.path);
			e.result = { type: "bytes", data };
			return e;
		});

		this.emitter.after("read", async (e) => {
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

		this.emitter.after("write", async (e) => {
			if (e.result) return e;
			const env = getEnv(e.agent);
			let existed = false;
			try { await env.read(e.path); existed = true; } catch { /* ignore */ }
			await env.write(e.path, e.content);
			e.result = existed ? "ok" : `${e.path}: successfully created.`;
			return e;
		});

		this.emitter.before("exec", async (e) => {
			e.env = {
				...(config.env?.static ?? {}),
				...this.resolveDynamicEnv(e.agent),
				...e.env,
			};
			return e;
		});

		this.emitter.after("exec", async (e) => {
			if (e.stdout !== undefined || e.exitCode !== undefined) return e;
			const env = getEnv(e.agent);
			const res = await env.exec(e.command, {
				workdir: e.workdir,
				timeout: e.timeout,
				env: e.env,
			});
			e.stdout = res.stdout;
			e.stderr = res.stderr;
			e.exitCode = res.exitCode;
			return e;
		});
	}

	resolveDynamicEnv(agent: IAgent): Record<string, string> {
		const env: Record<string, string> = {};
		if (!this.config.env?.dynamic) return env;
		for (const [key, source] of Object.entries(this.config.env.dynamic)) {
			switch (source) {
				case "model":
					env[key] = agent.llm.defaultModel ?? "unknown";
					break;
				case "id":
					env[key] = agent.id;
					break;
				case "system":
					env[key] = agent.system.split("\n")[0] ?? agent.system;
					break;
			}
		}
		return env;
	}

	normalizeCommand(command: string | string[]): string[] {
		if (typeof command === "string") return [...this.config.shell, command];
		return command;
	}

	async edit(
		agent: IAgent,
		path: string,
		fn: (content: string) => string,
	): Promise<string> {
		const env = getEnv(agent);
		const data = await env.read(path);
		const oldContent = new TextDecoder().decode(data);
		const newContent = fn(oldContent);

		const e = await this.emitter.do("write", {
			agent,
			path,
			content: { type: "text", text: newContent },
		});
		return e.result ?? "ok";
	}

	#tools = {
		read: tool({
			name: "read",
			desc: "Read a file",
			args: Type.Object({
				path: Type.String({ description: "Path to the file (relative or absolute)" }),
				offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
				limit: Type.Optional(Type.Number({ description: "Max number of lines to read" }))
			}),
			exec: async (args, agent) => {
				const e = await this.emitter.do("read", {
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
				web: (args) => ({
					tag: "tame-ops-read",
					props: { path: contractHome(args.path), offset: args.offset, limit: args.limit },
				}),
				acp: (args, result) => ({
					title: `Read ${contractHome(args.path)}`,
					content: result ? [ {
						"type": "content",
						"content": {
							"type": "text",
							"text": result.content.includes("```")
								? result.content
								: "```\n" + result.content + "\n```\n"
						},
					} ] : [],
				}),
			},
		}),
		write: tool({
			name: "write",
			desc: "Write a file. Creates a file if it does not exist, overwrites if it does. Automatically creates parent directories.",
			args: Type.Object({
				path: Type.String({ description: "Path to the file (relative or absolute)" }),
				content: Type.String({ description: "Text to write into the file" }),
			}),
			exec: async (args, agent) => {
				const e = await this.emitter.do("write", {
					agent,
					path: args.path,
					content: { type: "text", text: args.content },
				});
				return e.result ?? "ok";
			},
			view: {
				compact: (args) => `Write ${args.path}`,
				web: (args) => ({
					tag: "tame-ops-write",
					props: { path: contractHome(args.path), content: args.content },
				}),
				acp: (args) => ({
					kind: "edit",
					title: `Write ${contractHome(args.path)}`,
					content: [ {
						"type": "content",
						"content": {
							"type": "text",
							"text": args.content.includes("```")
								? args.content
								: "```\n" + args.content + "\n```\n"
						},
					} ],
				}),
			},
		}),
		edit: tool({
			name: "edit",
			desc: "Replace a string in an existing file (use for precise, surgical edits)",
			args: Type.Object({
				path: Type.String({ description: "Path to the file (relative or absolute)" }),
				oldString: Type.String({ description: "Text to find and replace (must match exactly, including whitespace)" }),
				newString: Type.String({ description: "Text to put in its place" }),
			}),
			exec: async (args, agent) => {
				return await this.edit(agent, args.path, (content) => {
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
				web: (args) => ({
					tag: "tame-ops-edit",
					props: { path: contractHome(args.path), oldString: args.oldString, newString: args.newString },
				}),
				acp: (args) => ({
					title: `Edit ${contractHome(args.path)}`,
				}),
			},
		}),
		exec: tool({
			name: "exec",
			desc: `Run a shell command and returns its output.
- Always set the workdir param. Do not cd unless absolutely necessary.
- Array arguments will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].`,
			args: Type.Object({
				command: Type.Union([
					Type.Array(Type.String(), {
						description: "Command line for the new process (passed directly to execvp)",
						minItems: 1,
					}),
					Type.String({ description: "Shell command to run" }),
				]),
				workdir: Type.Optional(Type.String({ description: "Working directory to execute the command in" })),
				timeout: Type.Number({ description: "Timeout for the command in milliseconds" }),
			}),
			exec: async (args, agent) => {
				const command = this.normalizeCommand(args.command);
				const e = await this.emitter.do("exec", {
					agent,
					command,
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
				compact: ({ command }) => {
					const cmd = this.normalizeCommand(command);
					return `exec ${getExecName(cmd)}`;
				},
				web: ({ command, workdir }) => {
					const cmd = stripShell(this.normalizeCommand(command));
					return {
						tag: "tame-ops-exec",
						props: { command: cmd.join(" "), workdir },
					};
				},
				acp: ({ command }, result) => {
					if (!command) return;
					const cmd = stripShell(this.normalizeCommand(command));
					const display = cmd.join(" ");
					const content = [{
						"type": "content",
						"content": {
							"type": "text",
							"text": display.includes("`")
								? "```\n" + display + "\n```\n"
								: "`" + display + "`",
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
						title: getExecName(cmd),
						content,
					};
				},
			},
		}),
	};

	async init(harness: IHarness) {
		const enabled = this.config.tools ?? {};
		const tools = [
			enabled.read !== false ? this.#tools.read : null,
			enabled.write !== false ? this.#tools.write : null,
			enabled.edit !== false ? this.#tools.edit : null,
			enabled.exec !== false ? this.#tools.exec : null,
		].filter((t): t is NonNullable<typeof t> => t !== null);
		harness.addTools(...tools);

		// register web components
		const web = harness.getPlugin("web") as WebPlugin | undefined;
		if (web) {
			const dir = import.meta.dirname!;
			web.register("ops", [
				{ tag: "tame-ops-read", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-write", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-edit", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-exec", src: web.resolve(dir, "./web/ops.ts") },
			], [], web.resolve(dir, "./web/ops.css"));
		}

	}

	newAgent(agent: IAgent) {
		setEnv(agent, this.#localEnv);
	}
}


