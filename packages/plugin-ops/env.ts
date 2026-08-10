export type Content =
	| { type: "text"; text: string }
	| { type: "bytes"; data: Uint8Array };

export interface ExecOpts {
	workdir?: string;
	timeout: number;
	signal?: AbortSignal;
	env?: Record<string, string>;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exit: "timeout" | "abort" | number;
}

export interface FileEnv {
	path: string;
	read(): Promise<Uint8Array>;
	write(content: Content): Promise<void>;
}

export interface Env {
	readonly defaultWorkdir: string;
	resolvePath(...pathSegments: string[]): string;
	exec(command: string[], opts: ExecOpts): Promise<ExecResult>;
	lock<T>(path: string, f: (env: FileEnv) => Promise<T>): Promise<T>;
	contractPath(path: string): string;
}
