// ask-tame.ts — send a message to tame via rpc-ws, wait for the agent
// to finish, then print the last assistant message to stdout.
//
// Usage: deno run -A scripts/ask-tame.ts "your message here"
//        deno run -A scripts/ask-tame.ts --system-file review.txt "your message"
//        echo "your message" | deno run -A scripts/ask-tame.ts --system "you are a reviewer"

const WS_URL = Deno.env.get("TAME_WS_URL") ?? "ws://127.0.0.1:6701";

function parseArgs(args: string[]): { system?: string; message: string } {
	let system: string | undefined;
	const positional: string[] = [];
	let i = 0;
	while (i < args.length) {
		if (args[i] === "--system-file") {
			i++;
			if (i >= args.length) {
				console.error("ask-tame: --system-file requires a path argument");
				Deno.exit(1);
			}
			try {
				system = Deno.readTextFileSync(args[i]);
			} catch (e) {
				console.error(`ask-tame: failed to read system file ${args[i]}: ${e instanceof Error ? e.message : e}`);
				Deno.exit(1);
			}
		} else if (args[i] === "--system") {
			i++;
			if (i >= args.length) {
				console.error("ask-tame: --system requires a string argument");
				Deno.exit(1);
			}
			system = args[i];
		} else {
			positional.push(args[i]);
		}
		i++;
	}
	return { system, message: positional.join(" ") };
}

interface TextContent {
	type: "text";
	text: string;
}

interface ToolUseContent {
	type: "tool_use";
	id: string;
	input: object;
	name: string;
}

type Content = TextContent | ToolUseContent;

interface AssistantMessage {
	role: "assistant";
	content: Content[];
	stop_reason: string;
	model: string;
	usage: Record<string, number>;
}

interface CallResultMessage {
	type: "result";
	id: string;
	error?: string;
	result?: Record<string, unknown>;
}

interface EventMessage {
	type: "event";
	agent_id?: string;
	plugin?: string;
	event: string;
	data?: Record<string, unknown>;
}

type RPCMessage = CallResultMessage | EventMessage;

function resolvers<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

async function main() {
	const { system, message: rawMessage } = parseArgs(Deno.args);
	const message = rawMessage || await readStdin();

	if (!message.trim()) {
		console.error("ask-tame: no message provided (args or stdin)");
		Deno.exit(1);
	}

	const ws = new WebSocket(WS_URL);

	const { promise: open, resolve: onOpen, reject: onOpenErr } = resolvers<void>();
	const { promise: done, resolve: onDone } = resolvers<void>();

	let lastAssistant: AssistantMessage | null = null;
	let agentId: string | null = null;

	ws.onopen = () => onOpen();
	ws.onerror = (e) => onOpenErr(new Error(`WebSocket error: ${e}`));

	ws.onmessage = (event) => {
		let msg: RPCMessage;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return; // skip malformed
		}

		switch (msg.type) {
			case "result": {
				if (msg.id === "new-agent" && msg.result) {
					agentId = (msg.result as { id: string }).id;
					// subscribe to all events from this agent
					ws.send(JSON.stringify({
						type: "subscribe",
						agent_id: agentId,
					}));
					// fire the user message
					ws.send(JSON.stringify({
						type: "event",
						agent_id: agentId,
						event: "userMessage",
						data: {
							msg: {
								role: "user",
								content: [{ type: "text", text: message }],
							},
						},
					}));
				} else if (msg.id === "new-agent" && msg.error) {
					console.error(`ask-tame: failed to create agent: ${msg.error}`);
					Deno.exit(1);
				}
				break;
			}
			case "event": {
				if (msg.event === "assistantMessage" && msg.data) {
					lastAssistant = (msg.data as { msg: AssistantMessage }).msg;
				}
				if (msg.event === "idle") {
					ws.close();
					onDone();
				}
				break;
			}
		}
	};

	ws.onclose = () => {
		// if we never resolved (e.g. connection dropped before idle), bail
		onDone();
	};

	await open;

	// request a new agent
	ws.send(JSON.stringify({
		type: "call",
		id: "new-agent",
		call: "newAgent",
		args: system ? { system } : {},
	}));

	await done;

	// TS can't see through the onmessage callback, so the type is still null here
	const msg = lastAssistant as AssistantMessage | null;
	if (msg) {
		for (const c of msg.content) {
			if (c.type === "text") {
				console.log(c.text);
			}
		}
	} else {
		console.error("ask-tame: no assistant message received");
		Deno.exit(1);
	}

	Deno.exit(0);
}

async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	const buf = new Uint8Array(4096);
	while (true) {
		const n = await Deno.stdin.read(buf);
		if (n === null) break;
		chunks.push(buf.subarray(0, n));
	}
	const total = chunks.reduce((s, c) => s + c.length, 0);
	const merged = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		merged.set(c, off);
		off += c.length;
	}
	return new TextDecoder().decode(merged);
}

main();
