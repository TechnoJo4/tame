import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import type { AnyTool, IAgent, IHarness } from "@tame/sdk";
import { CommandsPlugin } from "@tame/plugin-commands/index";
import { getWorkdir, OpsPlugin, setEnv, setWorkdir } from "./index.ts";
import type { Env, ExecOpts, ExecResult, FileEnv } from "./env.ts";
import LocalEnv from "./local.ts";

const config = {
	maxLines: 2000,
	defaultLines: 200,
	maxBytes: 50 * 1024,
	maxReadBytes: 50 * 1024 * 1024,
	timeout: 120_000,
	shell: ["bash", "-lc"],
	workdir: ".",
	defaultEnv: "local",
	tools: { exec: true },
};

const agent = (): IAgent => ({ pluginData: new Map() } as unknown as IAgent);

class MemoryEnv implements Env {
	readonly files = new Map<string, string>();
	readonly execCalls: ExecOpts[] = [];
	readonly invalidWorkdirs = new Set<string>();

	constructor(readonly defaultWorkdir: string) {}

	resolvePath(path: string, base = this.defaultWorkdir): string {
		return path.startsWith("/") ? path : `${base.replace(/\/$/, "")}/${path}`;
	}

	async validateWorkdir(path: string): Promise<void> {
		if (this.invalidWorkdirs.has(path)) {
			throw new Error(`${path}: access failed`);
		}
	}

	async exec(_command: string[], opts: ExecOpts): Promise<ExecResult> {
		this.execCalls.push(opts);
		return { stdout: "", stderr: "", exit: 0 };
	}

	async lock<T>(path: string, f: (env: FileEnv) => Promise<T>): Promise<T> {
		const file: FileEnv = {
			path,
			read: async () => new TextEncoder().encode(this.files.get(path) ?? ""),
			write: async (content) => {
				this.files.set(
					path,
					content.type === "text"
						? content.text
						: new TextDecoder().decode(content.data),
				);
			},
		};
		return await f(file);
	}

	contractPath(path: string): string {
		return `contract:${path}`;
	}
}

Deno.test("local env resolves and validates working directories", async () => {
	const env = new LocalEnv(config);

	assertEquals(
		env.resolvePath("packages", env.defaultWorkdir),
		resolve(env.defaultWorkdir, "packages"),
	);
	await env.validateWorkdir(env.defaultWorkdir);
	await assertRejects(
		() =>
			env.validateWorkdir(
				resolve(env.defaultWorkdir, "definitely-not-a-directory"),
			),
		Error,
		"access failed",
	);
});

Deno.test("working directories belong to individual agents and reset on environment changes", () => {
	const first = agent();
	const second = agent();
	const firstEnv = new LocalEnv({ ...config, workdir: "packages" });
	const secondEnv = new LocalEnv({ ...config, workdir: "scripts" });

	setEnv(first, firstEnv);
	setEnv(second, secondEnv);
	setWorkdir(first, "first/current");

	assertEquals(getWorkdir(first), "first/current");
	assertEquals(getWorkdir(second), secondEnv.defaultWorkdir);
	setEnv(first, secondEnv);
	assertEquals(getWorkdir(first), secondEnv.defaultWorkdir);
});

Deno.test("ops tools and /cd use the agent cwd for local and plugin-provided envs", async () => {
	const testAgent = agent();
	const env = new MemoryEnv("/remote/project");
	const commands = new CommandsPlugin();
	const tools: AnyTool[] = [];
	const harness = {
		addTools: (...added: AnyTool[]) => tools.push(...added),
		getPlugin: <T>(id: string) => id === "commands" ? commands as T : undefined,
	} as unknown as IHarness;

	await new OpsPlugin(config).init(harness);
	setEnv(testAgent, env);

	const tool = (name: string) => tools.find((t) => t.name === name)!;
	await tool("write").exec(
		{ path: "notes.txt", content: "hello" } as never,
		testAgent,
	);
	assertEquals(env.files.get("/remote/project/notes.txt"), "hello");
	const read = await tool("read").exec(
		{ path: "notes.txt" } as never,
		testAgent,
	) as { content: string };
	assertEquals(read.content.includes("hello"), true);
	await tool("edit").exec(
		{ path: "notes.txt", oldString: "hello", newString: "goodbye" } as never,
		testAgent,
	);
	assertEquals(env.files.get("/remote/project/notes.txt"), "goodbye");

	await tool("exec").exec(
		{ command: ["pwd"], timeout: 100 } as never,
		testAgent,
	);
	await tool("exec").exec(
		{ command: ["pwd"], workdir: "child", timeout: 100 } as never,
		testAgent,
	);
	await tool("bash").exec({ command: "pwd", timeout: 100 } as never, testAgent);
	assertEquals(env.execCalls.map((call) => call.workdir), [
		"/remote/project",
		"/remote/project/child",
		"/remote/project",
	]);

	assertEquals(
		await commands.dispatch(testAgent, "/cd child"),
		"contract:/remote/project/child",
	);
	assertEquals(getWorkdir(testAgent), "/remote/project/child");
	env.invalidWorkdirs.add("/remote/project/child/blocked");
	await assertRejects(
		() => commands.dispatch(testAgent, "/cd blocked"),
		Error,
		"access failed",
	);
	assertEquals(getWorkdir(testAgent), "/remote/project/child");
	assertEquals(
		await commands.dispatch(testAgent, "/cd"),
		"contract:/remote/project",
	);
	assertEquals(getWorkdir(testAgent), "/remote/project");
});
