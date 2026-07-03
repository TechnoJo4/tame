import { tool, Type, type IAgent, type IHarness, type Plugin } from "@tame/sdk";
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
	): Promise<{ stdout: string; stderr: string; exit: "timeout" | "abort" | number }>;
}

const dynamicEnvKey = Type.Union([
	Type.Literal("MODEL"),
	Type.Literal("AGENT_ID"),
	Type.Literal("AGENT_SYSTEM"),
]);

export const configSchema = Type.Object({
	maxLines: Type.Number({ default: 2000 }),
	defaultLines: Type.Number({ default: 200 }),
	maxBytes: Type.Number({ default: 50 * 1024 }),
	maxReadBytes: Type.Number({ default: 50 * 1024 * 1024 }),
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
		exec: Type.Optional(Type.Boolean({ default: false })),
		bash: Type.Optional(Type.Boolean({ default: true })),
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

	localEnv: Env;

	constructor(config: OpsConfig) {
		this.config = config;

		this.localEnv = {
			read: async (path) => {
				const resolved = resolve(path);
				try {
					await fs.access(resolved, fs.constants.R_OK);
				} catch {
					throw new Error(`${resolved}: access failed`);
				}
				const stat = await fs.stat(resolved);
				if (stat.size > config.maxReadBytes) {
					throw new Error(
						`${resolved}: file too large (${stat.size} bytes, max ${config.maxReadBytes})`,
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
					env: { ...process.env, ...config.env?.static, ...opts.env }
				});

				const stdout: string[] = [];
				const stderr: string[] = [];
				const decoder = new TextDecoder();
				proc.stdout.on("data", (data) => stdout.push(decoder.decode(data, { stream: true })));
				proc.stderr.on("data", (data) => stderr.push(decoder.decode(data, { stream: true })));

				let abortReason: "abort" | "timeout" | undefined = undefined;
				const onAbort = (reason: "abort" | "timeout") => {
					if (proc.pid && proc.exitCode === null) killTree(proc.pid);
					abortReason = reason;
				};
				const abortListener = () => onAbort("abort");
				if (opts.signal?.aborted) onAbort("abort");
				else opts.signal?.addEventListener("abort", abortListener, { once: true });

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
			},
		};
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

	async edit(
		agent: IAgent,
		path: string,
		fn: (content: string) => string,
	): Promise<string> {
		const env = getEnv(agent);
		const data = await env.read(path);
		const oldContent = new TextDecoder().decode(data);
		const newContent = fn(oldContent);

		await env.write(path, { type: "text", text: newContent });
		return "ok";
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
				const env = getEnv(agent);
				const data = await env.read(args.path);
				let text: string;
				try {
					text = new TextDecoder().decode(data);
				} catch {
					return "[binary data]";
				}

				const lines = text.split("\n");
				const numLines = Math.min(args.limit ?? this.config.defaultLines, this.config.maxLines);
				const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;
				const endLine = Math.min(startLine + numLines, lines.length);

				text = lines.slice(startLine, endLine).join("\n");
				const notice = [
					`showing lines ${startLine + 1}-${endLine}`,
					endLine >= lines.length
						? `end of file reached`
						: `use offset=${endLine + 1} to continue`,
				];
				text += `\n\n[${notice.join(". ")}]`;

				return text;
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
				const env = getEnv(agent);
				let existed = false;
				try { await env.read(args.path); existed = true; } catch { /* ignore */ }
				await env.write(args.path, { type: "text", text: args.content });
				return existed ? "ok" : `${args.path}: successfully created.`;
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
			desc: `Run a command. Returns stdout and stderr.
- Always set the workdir param. Do not cd unless absolutely necessary.
- Arguments will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].`,
			args: Type.Object({
				command: Type.Array(Type.String(), {
					description: "Command line for the new process (passed directly to execvp)",
					minItems: 1,
				}),
				workdir: Type.Optional(Type.String({ description: "Working directory to execute the command in" })),
				timeout: Type.Number({ description: "Timeout for the command in milliseconds" }),
			}),
			exec: async (args, agent) => {
				const env = getEnv(agent);
				const res = await env.exec(args.command, {
					workdir: args.workdir,
					timeout: args.timeout,
					env: {
						...(this.config.env?.static ?? {}),
						...this.resolveDynamicEnv(agent),
					},
				});
				return [
					res.exit !== 0 ? typeof res.exit === "string" ? `killed by ${res.exit}.` : `exited with code ${res.exit}.` : "",
					res.stdout ? `stdout:\n${res.stdout}` : "",
					res.stderr ? `stderr:\n${res.stderr}` : "",
				].filter((s) => s !== "").join("\n\n") || "ok";
			},
			view: {
				compact: ({ command }) => {
					return `exec ${getExecName(command)}`;
				},
				web: ({ command, workdir }) => {
					const cmd = stripShell(command);
					return {
						tag: "tame-ops-exec",
						props: { command: cmd.join(" "), workdir: workdir ? contractHome(workdir) : undefined },
					};
				},
				acp: ({ command }, result) => {
					if (!command) return;
					const cmd = stripShell(command);
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
		bash: tool({
			name: "bash",
			desc: `Execute a bash command. Returns stdout and stderr. If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
			args: Type.Object({
				command: Type.String({ description: "Bash command to execute" }),
				workdir: Type.Optional(Type.String({ description: "Working directory to execute the command in" })),
				timeout: Type.Number({ description: "Timeout for the command in milliseconds" }),
			}),
			exec: async (args, agent) => {
				const command = [...this.config.shell, args.command];
				const env = getEnv(agent);
				const res = await env.exec(command, {
					workdir: args.workdir,
					timeout: args.timeout,
					env: {
						...(this.config.env?.static ?? {}),
						...this.resolveDynamicEnv(agent),
					},
				});
				return [
					res.exit !== 0 ? typeof res.exit === "string" ? `killed by ${res.exit}.` : `exited with code ${res.exit}.` : "",
					res.stdout ? `stdout:\n${res.stdout}` : "",
					res.stderr ? `stderr:\n${res.stderr}` : "",
				].filter((s) => s !== "").join("\n\n") || "ok";
			},
			view: {
				compact: ({ command }) => {
					return `exec ${getExecName([command])}`;
				},
				web: ({ command, workdir }) => {
					return {
						tag: "tame-ops-exec",
						props: { command, workdir: workdir ? contractHome(workdir) : undefined },
					};
				},
				acp: ({ command }, result) => {
					if (!command) return;
					const content = [{
						"type": "content",
						"content": {
							"type": "text",
							"text": command.includes("`")
								? "```\n" + command + "\n```\n"
								: "`" + command + "`",
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
						title: getExecName([command]),
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
			enabled.bash !== false ? this.#tools.bash : null,
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
		setEnv(agent, this.localEnv);
	}
}
