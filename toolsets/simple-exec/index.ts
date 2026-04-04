import { spawn } from "node:child_process";
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

export const exec = tool({
    name: "exec",
    desc: `Run a shell command and returns its output.
- The arguments to shell will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the workdir param when using the shell function. Do not cd unless absolutely necessary.`,
    args: Type.Object({
        command: Type.Array(Type.String(), { description: "Command line for the new process", minItems: 1 }),
        workdir: Type.String({ description: "Working directory to execute the command in" }),
        timeout: Type.Number({ description: "Timeout for the command in milliseconds" })
    }),
    exec: async (args, agent) => {
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
            stdout.push(decoder.decode(data, { stream: true }));
        });

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
        ].join("\n\n");
    }
});

export default [ exec ];
