import type { Agent } from "../../agent/agent.ts";
import type { Harness } from "../../agent/harness.ts";
import type { Plugin } from "../../agent/plugin.ts";
import { tool, Type, type AnyTool } from "../../agent/tool.ts";
import type { Static } from "typebox";
import { getEnv } from "../ops/index.ts";
import type { SkillsPlugin } from "../skills/index.ts";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, relative, dirname } from "@std/path";
import process from "node:process";

export const configSchema = Type.Object({
	maxLines: Type.Number({ default: 2000 }),
	maxBytes: Type.Number({ default: 50 * 1024 }),
	timeout: Type.Number({ default: 120_000 }),
	shell: Type.Array(Type.String(), { default: ["bash", "-lc"] }),
	tools: Type.Optional(Type.Object({
		read: Type.Optional(Type.Boolean({ default: true })),
		write: Type.Optional(Type.Boolean({ default: true })),
		edit: Type.Optional(Type.Boolean({ default: true })),
		bash: Type.Optional(Type.Boolean({ default: true })),
		glob: Type.Optional(Type.Boolean({ default: true })),
		grep: Type.Optional(Type.Boolean({ default: true })),
		skill: Type.Optional(Type.Boolean({ default: true })),
	})),
});

type ClaudeConfig = Static<typeof configSchema>;

function addLineNumbers(content: string, startLine = 1): string {
	const lines = content.split("\n");
	return lines.map((line, i) => {
		const n = String(startLine + i);
		const pad = "      ".slice(n.length);
		return `${pad}${n}\t${line}`;
	}).join("\n");
}

/**
 * Run a command and return { stdout, stderr, exitCode }.
 */
function execCommand(
	command: string,
	opts: { workdir?: string; timeout: number; signal?: AbortSignal; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		const proc = spawn("bash", ["-lc", command], {
			detached: true,
			cwd: opts.workdir,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...opts.env },
		});

		const stdout: string[] = [];
		const stderr: string[] = [];
		const decoder = new TextDecoder();
		proc.stdout.on("data", (data) => stdout.push(decoder.decode(data, { stream: true })));
		proc.stderr.on("data", (data) => stderr.push(decoder.decode(data, { stream: true })));

		const kill = () => {
			try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* ignore */ }
		};

		if (opts.signal?.aborted) { kill(); return; }
		opts.signal?.addEventListener("abort", kill, { once: true });

		const timeoutId = opts.timeout ? setTimeout(() => {
			if (proc.pid && proc.exitCode === null) kill();
		}, opts.timeout) : undefined;

		proc.once("close", () => {
			if (timeoutId) clearTimeout(timeoutId);
			opts.signal?.removeEventListener("abort", kill);
			resolve({ stdout: stdout.join(""), stderr: stderr.join(""), exitCode: proc.exitCode ?? 1 });
		});
		proc.once("error", (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			opts.signal?.removeEventListener("abort", kill);
			reject(err);
		});
	});
}

/**
 * Simple recursive glob using fs.readdir.
 */
async function globFiles(rootDir: string, pattern: string): Promise<string[]> {
	const results: string[] = [];

	// Convert glob pattern to regex
	const regex = globToRegex(pattern);

	async function walk(dir: string) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = resolve(dir, entry.name);
			const rel = relative(rootDir, full);
			if (entry.isDirectory()) {
				// Skip dot dirs
				if (entry.name.startsWith(".")) continue;
				await walk(full);
			} else if (entry.isFile()) {
				if (regex.test(rel) || regex.test(entry.name)) {
					results.push(rel);
				}
			}
		}
	}

	await walk(rootDir);
	return results.sort();
}

function globToRegex(pattern: string): RegExp {
	// Simple glob → regex: * → .*, ? → .
	let r = "";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === "*") {
			// ** → .* (globstar)
			if (pattern[i + 1] === "*") {
				r += ".*";
				i += 2;
				continue;
			}
			r += "[^/]*";
		} else if (ch === "?") {
			r += "[^/]";
		} else if (ch === ".") {
			r += "\\.";
		} else if ("\\^$+{}[]|()".includes(ch)) {
			r += "\\" + ch;
		} else {
			r += ch;
		}
		i++;
	}
	return new RegExp("^" + r + "$");
}

async function grepFiles(
	pattern: string,
	opts: {
		path?: string;
		glob?: string;
		outputMode?: "content" | "files_with_matches" | "count";
		headLimit?: number;
		caseInsensitive?: boolean;
		workdir?: string;
		signal?: AbortSignal;
	},
): Promise<string> {
	const args: string[] = ["-rn"]; // recursive, line numbers
	if (opts.caseInsensitive) args.push("-i");
	if (opts.outputMode === "files_with_matches" || opts.outputMode === undefined) args.push("-l");
	if (opts.outputMode === "count") args.push("-c");
	if (opts.glob) args.push("--include", opts.glob);

	args.push("--", pattern, opts.path ?? ".");

	const proc = spawn("grep", args, {
		cwd: opts.workdir,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdout: string[] = [];
	const decoder = new TextDecoder();
	proc.stdout.on("data", (data) => stdout.push(decoder.decode(data, { stream: true })));

	let stderr = "";
	proc.stderr.on("data", (data) => stderr += decoder.decode(data, { stream: true }));

	const kill = () => { try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* */ } };
	opts.signal?.addEventListener("abort", kill, { once: true });

	await new Promise<void>((resolve, reject) => {
		proc.once("close", () => resolve());
		proc.once("error", reject);
	});

	opts.signal?.removeEventListener("abort", kill);

	let output = stdout.join("");
	// grep returns exit 1 when no matches found — that's not an error
	if (output === "" && proc.exitCode === 1) return "";

	if (opts.headLimit && opts.headLimit > 0) {
		const lines = output.split("\n");
		output = lines.slice(0, opts.headLimit).join("\n");
	}

	return output;
}

export class ClaudelikePlugin implements Plugin {
	id = "claudelike" as const;

	config: ClaudeConfig;

	constructor(config: ClaudeConfig) {
		this.config = config;
	}

	#tools = {
		read: tool({
			name: "Read",
			desc: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a file path assume that path is valid.

Usage:
- You can optionally specify an offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive a system reminder warning.`,
			args: Type.Object({
				file_path: Type.String({ description: "The absolute path to the file to read" }),
				offset: Type.Optional(Type.Number({ description: "The line number to start reading from. Only provide if the file is too large to read at once" })),
				limit: Type.Optional(Type.Number({ description: "The number of lines to read. Only provide if the file is too large to read at once." })),
			}),
			exec: async (args, agent) => {
				const env = getEnv(agent);
				const resolved = resolve(args.file_path);
				const data = await env.read(resolved);
				const text = new TextDecoder().decode(data);

				const lines = text.split("\n");
				const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;
				const endLine = args.limit
					? Math.min(startLine + args.limit, lines.length)
					: Math.min(startLine + this.config.maxLines, lines.length);

				const sliced = lines.slice(startLine, endLine).join("\n");
				const totalLines = lines.length;
				const numLines = endLine - startLine;

				let content: string;
				if (sliced.length === 0 && totalLines === 0) {
					content = "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>";
				} else if (numLines === 0) {
					content = `<system-reminder>Warning: the file exists but is shorter than the provided offset (${startLine + 1}). The file has ${totalLines} lines.</system-reminder>`;
				} else {
					content = addLineNumbers(sliced, startLine + 1);
					const notice = [
						`showing lines ${startLine + 1}-${endLine}`,
						endLine >= lines.length
							? `end of file reached`
							: `use offset=${endLine + 1} to continue`,
					];
					content += `\n\n[${notice.join(". ")}]`;
				}

				return {
					type: "text",
					file: {
						filePath: args.file_path,
						content,
						numLines,
						startLine: startLine + 1,
						totalLines,
					},
				};
			},
			view: {
				compact: (args) => `Read ${args.file_path}`,
			},
		}),

		write: tool({
			name: "Write",
			desc: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
			args: Type.Object({
				file_path: Type.String({ description: "The absolute path to the file to write (must be absolute, not relative)" }),
				content: Type.String({ description: "The content to write to the file" }),
			}),
			exec: async (args, agent) => {
				const env = getEnv(agent);
				const resolved = resolve(args.file_path);
				const dir = dirname(resolved);
				try { await fs.mkdir(dir, { recursive: true }); } catch { /* ok */ }

				let existed = false;
				try {
					await fs.access(resolved);
					existed = true;
				} catch { /* new file */ }

				await env.write(resolved, { type: "text", text: args.content });

				if (existed) {
					return `The file ${args.file_path} has been updated successfully.`;
				}
				return `File created successfully at: ${args.file_path}`;
			},
			view: {
				compact: (args) => `Write ${args.file_path}`,
			},
		}),

		edit: tool({
			name: "Edit",
			desc: `Performs exact string replacements in an existing file.

Usage:
- You must use the Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the EXACT indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.`,
			args: Type.Object({
				file_path: Type.String({ description: "The absolute path to the file to modify" }),
				old_string: Type.String({ description: "The text to replace" }),
				new_string: Type.String({ description: "The text to replace it with (must be different from old_string)" }),
				replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences of old_string (default false)" })),
			}),
			exec: async (args, agent) => {
				const env = getEnv(agent);
				const resolved = resolve(args.file_path);
				const data = await env.read(resolved);
				const content = new TextDecoder().decode(data);

				if (args.old_string === args.new_string) {
					throw new Error("No changes to make: old_string and new_string are exactly the same.");
				}

				let count = 0;
				let idx = -1;
				while ((idx = content.indexOf(args.old_string, idx + 1)) !== -1) count++;

				if (count === 0) {
					throw new Error(`String to replace not found in file.\nString: ${args.old_string}`);
				}

				if (count > 1 && !args.replace_all) {
					throw new Error(`Found ${count} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${args.old_string}`);
				}

				const newContent = args.replace_all
					? content.replaceAll(args.old_string, args.new_string)
					: content.replace(args.old_string, args.new_string);

				await env.write(resolved, { type: "text", text: newContent });

				if (args.replace_all) {
					return `The file ${args.file_path} has been updated successfully. All occurrences were successfully replaced.`;
				}
				return `The file ${args.file_path} has been updated successfully.`;
			},
			view: {
				compact: (args) => `Edit ${args.file_path}`,
			},
		}),

		bash: tool({
			name: "Bash",
			desc: `Executes a given bash command with a timeout. The command is run in a sandboxed environment.

Usage:
- Never use Bash for file operations (reading, writing, editing, searching, finding files) — use the dedicated tools for that.
- Always set a timeout. Most commands complete quickly; long-running ones should be run in the background.
- When using Bash to run a script, you do NOT need to make it executable first. Just run it directly, e.g. "bash script.sh" or "python script.py".
- When making changes, always group a set of edits together rather than executing them one at a time.`,
			args: Type.Object({
				command: Type.String({ description: "The command to execute" }),
				timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
				description: Type.Optional(Type.String({ description: "Clear, concise description of what this command does in active voice." })),
			}),
			exec: async (args, agent) => {
				const timeout = args.timeout ?? this.config.timeout;
				const result = await execCommand(args.command, {
					timeout,
					workdir: process.cwd(),
					signal: agent.signal,
				});

				let output = "";
				if (result.stdout) output += result.stdout;
				if (result.stderr) {
					if (output) output += "\n";
					output += result.stderr;
				}
				if (result.exitCode !== 0) {
					output += `\nExit code ${result.exitCode}`;
				}
				if (output === "") output = "(No output)";

				return {
					stdout: result.stdout,
					stderr: result.stderr,
					interrupted: agent.signal?.aborted ?? false,
				};
			},
			view: {
				compact: (args) => {
					const desc = args.description ?? args.command.slice(0, 60);
					return `Bash: ${desc}`;
				},
			},
		}),

		glob: tool({
			name: "Glob",
			desc: `Finds files matching a glob pattern.

Usage:
- Use this tool to find files by name patterns (e.g., "*.js", "test*.ts").
- This tool is optimized for pattern-based file search and excludes common directories like node_modules by default.
- Results are limited to 100 files.`,
			args: Type.Object({
				pattern: Type.String({ description: "The glob pattern to match files against" }),
				path: Type.Optional(Type.String({ description: "The directory to search in. If not specified, the current working directory will be used." })),
			}),
			exec: async (args) => {
				const start = Date.now();
				const searchDir = args.path ? resolve(args.path) : process.cwd();
				const files = await globFiles(searchDir, args.pattern);
				const durationMs = Date.now() - start;
				const truncated = files.length > 100;
				return {
					durationMs,
					numFiles: files.length,
					filenames: truncated ? files.slice(0, 100) : files,
					truncated,
				};
			},
			view: {
				compact: (args) => `Glob ${args.pattern}`,
			},
		}),

		grep: tool({
			name: "Grep",
			desc: `Searches for a pattern in files using grep.

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command. The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax, e.g. "log.*Error", "function\\s+\\w+".
- Supports file type filtering, context lines.
- Output modes: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts.`,
			args: Type.Object({
				pattern: Type.String({ description: "The regular expression pattern to search for in file contents" }),
				path: Type.Optional(Type.String({ description: "File or directory to search in. Defaults to current working directory." })),
				glob: Type.Optional(Type.String({ description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")' })),
				output_mode: Type.Optional(Type.Union([
					Type.Literal("content"),
					Type.Literal("files_with_matches"),
					Type.Literal("count"),
				], { description: 'Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts. Defaults to "files_with_matches".' })),
				head_limit: Type.Optional(Type.Number({ description: "Limit output to first N lines/entries. Defaults to 250." })),
				"-i": Type.Optional(Type.Boolean({ description: "Case insensitive search" })),
			}),
			exec: async (args, agent) => {
				const output = await grepFiles(args.pattern, {
					path: args.path,
					glob: args.glob,
					outputMode: args.output_mode,
					headLimit: args.head_limit ?? 250,
					caseInsensitive: args["-i"] ?? false,
					workdir: process.cwd(),
					signal: agent.signal,
				});

				if (output === "") return "(No results)";
				return output;
			},
			view: {
				compact: (args) => `Grep ${args.pattern}`,
			},
		}),
	};

	async init(harness: Harness) {
		const enabled = this.config.tools ?? {};
		const tools: AnyTool[] = [
			enabled.read !== false ? this.#tools.read : null,
			enabled.write !== false ? this.#tools.write : null,
			enabled.edit !== false ? this.#tools.edit : null,
			enabled.bash !== false ? this.#tools.bash : null,
			enabled.glob !== false ? this.#tools.glob : null,
			enabled.grep !== false ? this.#tools.grep : null,
		].filter((t): t is NonNullable<typeof t> => t !== null);

		if (enabled.skill !== false) {
			const skills = harness.getPlugin<SkillsPlugin>("skills");
			if (skills) {
				tools.push(
					tool({
						name: "Skill",
						desc: `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - skill: "pdf" - invoke the pdf skill
  - skill: "commit", args: "-m 'Fix bug'" - invoke with arguments
  - skill: "review-pr", args: "123" - invoke with arguments`,
						args: Type.Object({
							skill: Type.String({ description: 'The skill name. E.g., "commit", "review-pr", or "pdf"' }),
							args: Type.Optional(Type.String({ description: "Optional arguments for the skill" })),
						}),
						exec: async ({ skill: name, args: argsStr }, agent) => {
							const skill = skills.getSkill(name);
							if (!skill) {
								const available = skills.listSkills().map(s => s.name).join(", ");
								throw new Error(`Unknown skill "${name}". Available: ${available}`);
							}

							if (skills.isSkillActivated(agent, name)) {
								return `Skill "${name}" is already active.`;
							}

							// parse "key=value key2=value2" or "value1 value2" → positional $1, $2
							const parsedArgs: Record<string, string> = {};
							if (argsStr && skill.argNames) {
								const tokens = argsStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
								for (let i = 0; i < tokens.length; i++) {
									const tok = tokens[i].replace(/^["']|["']$/g, "");
									if (skill.argNames[i]) {
										parsedArgs[skill.argNames[i]] = tok;
									}
									parsedArgs[String(i + 1)] = tok;
								}
							}

							skills.injectSkillContent(agent, skill, true, Object.keys(parsedArgs).length > 0 ? parsedArgs : undefined);
							return `Activated skill "${name}".`;
						},
						view: {
							compact: ({ skill }) => `Skill ${skill}`,
						},
					}),
				);
			}
		}

		harness.addTools(...tools);
	}

	newAgent(_agent: Agent) {
		// No per-agent state needed — the ops plugin already sets up the Env.
	}
}
