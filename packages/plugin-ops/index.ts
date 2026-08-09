import {
	type IAgent,
	type IHarness,
	type Plugin,
	tool,
	type ToolExecResult,
	Type,
} from "@tame/sdk";
import type { WebPlugin } from "@tame/plugin-web/index";
import type { CommandsPlugin } from "@tame/plugin-commands/index";
import type { Env } from "./env.ts";
import type { OpsConfig } from "./config.ts";
import LocalEnv from "./local.ts";

type ViewMeta = { path: string };
type ExecViewMeta = { workdir?: string };

export const envKey = Symbol("tame:ops:env");
export const workdirKey = Symbol("tame:ops:workdir");

export function getEnv(agent: IAgent): Env {
	return agent.pluginData.get(envKey) as Env;
}

export function setEnv(agent: IAgent, env: Env) {
	agent.pluginData.set(envKey, env);
	setWorkdir(agent, env.defaultWorkdir);
}

export function getWorkdir(agent: IAgent): string {
	return agent.pluginData.get(workdirKey) as string;
}

export function setWorkdir(agent: IAgent, workdir: string) {
	agent.pluginData.set(workdirKey, workdir);
}

function resolvePath(agent: IAgent, path: string): string {
	const env = getEnv(agent);
	return env.resolvePath(path, getWorkdir(agent));
}

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

const formatExecResult = (
	res: { stdout: string; stderr: string; exit: "timeout" | "abort" | number },
): string =>
	[
		res.exit !== 0
			? typeof res.exit === "string"
				? `killed by ${res.exit}.`
				: `exited with code ${res.exit}.`
			: "",
		res.stdout ? `stdout:\n${res.stdout}` : "",
		res.stderr ? `stderr:\n${res.stderr}` : "",
	].filter((s) => s !== "").join("\n\n") || "ok";

export class OpsPlugin implements Plugin {
	id = "ops" as const;

	#envs = new Map<string, Env>();
	localEnv: Env;

	config: OpsConfig;

	constructor(config: OpsConfig) {
		this.config = config;

		this.localEnv = new LocalEnv(config);
		this.#envs.set("local", this.localEnv);
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
	): Promise<ToolExecResult<ViewMeta>> {
		const env = getEnv(agent);
		const resolved = resolvePath(agent, path);
		return await env.lock(resolved, async (f) => {
			const data = await f.read();
			const oldContent = new TextDecoder().decode(data);
			const newContent = fn(oldContent);

			await f.write({ type: "text", text: newContent });
			return { content: "ok", meta: { path: env.contractPath(f.path) } };
		});
	}

	async #runExec(
		agent: IAgent,
		command: string[],
		opts: { workdir?: string; timeout: number },
	): Promise<ToolExecResult<ExecViewMeta>> {
		const env = getEnv(agent);
		const workdir = env.resolvePath(
			opts.workdir ?? getWorkdir(agent),
			getWorkdir(agent),
		);
		const res = await env.exec(command, {
			workdir,
			timeout: opts.timeout,
			env: {
				...(this.config.env?.static ?? {}),
				...this.resolveDynamicEnv(agent),
			},
		});
		return {
			content: formatExecResult(res),
			meta: { workdir: env.contractPath(workdir) },
		};
	}

	#tools = {
		read: tool({
			name: "read",
			desc: "Read a file",
			args: Type.Object({
				path: Type.String({
					description: "Path to the file (relative or absolute)",
				}),
				offset: Type.Optional(
					Type.Number({
						description: "Line number to start reading from (1-indexed)",
					}),
				),
				limit: Type.Optional(
					Type.Number({ description: "Max number of lines to read" }),
				),
			}),
			exec: async (args, agent) => {
				const env = getEnv(agent);
				const { data, path } = await env.lock(
					resolvePath(agent, args.path),
					async (env) => ({ data: await env.read(), path: env.path }),
				);
				let text: string;
				try {
					text = new TextDecoder().decode(data);
				} catch {
					return "[binary data]";
				}

				const lines = text.split("\n");
				const numLines = Math.min(
					args.limit ?? this.config.defaultLines,
					this.config.maxLines,
				);
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

				return { content: text, meta: { path: env.contractPath(path) } };
			},
			view: {
				compact: (args) => `Read ${args.path}`,
				web: (args, _, meta) => ({
					tag: "tame-ops-read",
					props: {
						path: meta?.path ?? args.path,
						offset: args.offset,
						limit: args.limit,
					},
				}),
				acp: (args, result, meta) => ({
					title: `Read ${meta?.path ?? args.path}`,
					content: result
						? [{
							"type": "content",
							"content": {
								"type": "text",
								"text": result.content.includes("```")
									? result.content
									: "```\n" + result.content + "\n```\n",
							},
						}]
						: [],
				}),
			},
		}),
		write: tool({
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
				const env = getEnv(agent);
				// TODO: re-add existed check without having to do and discard a read
				//let existed = false;
				//try { await env.read(args.path); existed = true; } catch { /* ignore */ }
				const path = await env.lock(
					resolvePath(agent, args.path),
					async (env) => {
						await env.write({ type: "text", text: args.content });
						return env.path;
					},
				);
				return { content: "ok", meta: { path: env.contractPath(path) } }; //existed ? "ok" : `${args.path}: successfully created.`;
			},
			view: {
				compact: (args) => `Write ${args.path}`,
				web: (args, _, meta) => ({
					tag: "tame-ops-write",
					props: { path: meta?.path ?? args.path, content: args.content },
				}),
				acp: (args, _, meta) => ({
					kind: "edit",
					title: `Write ${meta?.path ?? args.path}`,
					content: [{
						"type": "content",
						"content": {
							"type": "text",
							"text": args.content.includes("```")
								? args.content
								: "```\n" + args.content + "\n```\n",
						},
					}],
				}),
			},
		}),
		edit: tool({
			name: "edit",
			desc:
				"Replace a string in an existing file (use for precise, surgical edits)",
			args: Type.Object({
				path: Type.String({
					description: "Path to the file (relative or absolute)",
				}),
				oldString: Type.String({
					description:
						"Text to find and replace (must match exactly, including whitespace)",
				}),
				newString: Type.String({ description: "Text to put in its place" }),
			}),
			exec: async (args, agent) => {
				return await this.edit(agent, args.path, (content) => {
					let count = 0;
					let idx = -1;
					while ((idx = content.indexOf(args.oldString, idx + 1)) !== -1) {
						count++;
					}
					if (count === 0) {
						throw new Error(
							`${args.path} does not contain ${JSON.stringify(args.oldString)}`,
						);
					}
					if (count > 1) {
						throw new Error(
							`${args.path} contains ${
								JSON.stringify(args.oldString)
							} more than once (${count} occurrences)`,
						);
					}
					return content.replace(args.oldString, args.newString);
				});
			},
			view: {
				compact: (args) => `Edit ${args.path}`,
				web: (args, _, meta) => ({
					tag: "tame-ops-edit",
					props: {
						path: meta?.path ?? args.path,
						oldString: args.oldString,
						newString: args.newString,
					},
				}),
				acp: (args, _, meta) => ({
					title: `Edit ${meta?.path ?? args.path}`,
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
					description:
						"Command line for the new process (passed directly to execvp)",
					minItems: 1,
				}),
				workdir: Type.Optional(
					Type.String({
						description: "Working directory to execute the command in",
					}),
				),
				timeout: Type.Number({
					description: "Timeout for the command in milliseconds",
				}),
			}),
			exec: async (args, agent) => {
				return await this.#runExec(agent, args.command, {
					workdir: args.workdir,
					timeout: args.timeout,
				});
			},
			view: {
				compact: ({ command }) => {
					return `exec ${getExecName(command)}`;
				},
				web: ({ command }, _, meta) => {
					const cmd = stripShell(command);
					return {
						tag: "tame-ops-exec",
						props: { command: cmd.join(" "), workdir: meta?.workdir },
					};
				},
			},
		}),
		bash: tool({
			name: "bash",
			desc:
				`Execute a bash command. Returns stdout and stderr. If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
			args: Type.Object({
				command: Type.String({ description: "Bash command to execute" }),
				workdir: Type.Optional(
					Type.String({
						description: "Working directory to execute the command in",
					}),
				),
				timeout: Type.Number({
					description: "Timeout for the command in milliseconds",
				}),
			}),
			exec: async (args, agent) => {
				const command = [...this.config.shell, args.command];
				return await this.#runExec(agent, command, {
					workdir: args.workdir,
					timeout: args.timeout,
				});
			},
			view: {
				compact: ({ command }) => {
					return `exec ${getExecName([command])}`;
				},
				web: ({ command }, _, meta) => {
					return {
						tag: "tame-ops-exec",
						props: { command, workdir: meta?.workdir },
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

		harness.getPlugin<CommandsPlugin>("commands")?.add({
			name: "cd",
			description: "Change the current ops working directory: /cd [path]",
			run: async (agent, param) => {
				const env = getEnv(agent);
				const path = param?.trim();
				const workdir = path
					? env.resolvePath(path, getWorkdir(agent))
					: env.defaultWorkdir;
				await env.validateWorkdir(workdir);
				setWorkdir(agent, workdir);
				return env.contractPath(workdir);
			},
		});

		// register web components
		const web = harness.getPlugin("web") as WebPlugin | undefined;
		if (web) {
			const dir = import.meta.dirname!;
			web.register("ops", [
				{ tag: "tame-ops-read", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-write", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-edit", src: web.resolve(dir, "./web/ops.ts") },
				{ tag: "tame-ops-exec", src: web.resolve(dir, "./web/ops.ts") },
				{
					tag: "tame-ops-settings",
					src: web.resolve(dir, "./web/ops-settings.ts"),
				},
			], [
				{ location: "modal:settings", tag: "tame-ops-settings" },
			], web.resolve(dir, "./web/ops.css"));
		}
	}

	newAgent(agent: IAgent) {
		const env = this.#envs.get(this.config.defaultEnv);
		if (env === undefined) {
			throw new Error(
				`default environment ${this.config.defaultEnv} does not exist`,
			);
		}
		setEnv(agent, env);
	}
}
