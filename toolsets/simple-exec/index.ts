import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tool, Type } from "../../agent/tool.ts";
import process from "node:process";

export const killTree = (pid: number) => {
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

export const stripShell = (args: string[]) => {
	let i = 0;
	while (args[i].endsWith("sh")) {
		++i;
		while (args[i].startsWith("-")) ++i;
	}
	return args.slice(i);
};

export const getExecName = (args: string[]) => {
	args = stripShell(args);
	let arg = args[0];
	if (arg.startsWith("cd"))
		arg = arg.replace(/cd [^ ]+(&&|;|\s)*/, "");
	const s = args[0].indexOf(" ");
	return s === -1 ? args[0] : args[0].slice(0, s);
};

export const exec = tool({
	name: "exec",
	desc: `Run a shell command and returns its output.
- The arguments to shell will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the workdir param when using the shell function. Do not cd unless absolutely necessary.`,
	args: Type.Object({
		command: Type.Array(Type.String(), { description: "Command line for the new process", minItems: 1 }),
		workdir: Type.Optional(Type.String({ description: "Working directory to execute the command in" })),
		timeout: Type.Number({ description: "Timeout for the command in milliseconds" }) // TODO: implement
	}),
	exec: async (args, agent) => {
		if (args.workdir) {
			try { await fs.access(args.workdir, fs.constants.R_OK) } catch {
				throw new Error(`${args.workdir}: access failed`)
			}
		}

		const name = args.command.shift()!;
		const proc = spawn(name, args.command, {
			detached: true,
			cwd: args.workdir,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const stdout: string[] = [];
		const stderr: string[] = [];

		const decoder = new TextDecoder();
		proc.stdout.on("data", (data) => {
			stdout.push(decoder.decode(data, { stream: true }));
		});
		proc.stderr.on("data", (data) => {
			stderr.push(decoder.decode(data, { stream: true }));
		});

		// TODO: report
		const onAbort = () => {
			if (proc.pid) killTree(proc.pid);
		};
		const signal = agent.signal!;
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });

		await new Promise<void>((resolve, reject) => {
			proc.once("close", () => resolve());
			proc.once("error", (e) => reject(e));
		});

		return [
			proc.exitCode !== 0 ? `exited with code ${proc.exitCode}.` : "",
			stdout.length > 0 ? `stdout:\n${stdout.join("")}` : "",
			stderr.length > 0 ? `stderr:\n${stderr.join("")}` : "",
		].filter(s => s !== "").join("\n\n");
	},
	view: {
		compact: ({ command }) => `exec ${getExecName(command)}`,
		acp: ({ command }, result) => {
			if (result?.is_error) return;

			const args = stripShell(command);
			const content = [ {
				"type": "content",
				"content": {
					"type": "text",
					"text": "```\n"+args.join(" ")+"\n```\n"
				}
			} ];

			if (result)
				content.push({
					"type": "content",
					"content": {
						"type": "text",
						"text": "\n```\n"+result.content+"\n```"
					}
				});

			return {
				// N.B. Not setting kind: execute because zed can't render it right
				title: getExecName(args),
				content
			};
		}
	}
});

export default [ exec ];
