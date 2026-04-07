import * as acp from "npm:@agentclientprotocol/sdk";
import { Static, TSchema, Type } from "@sinclair/typebox";

import type { Agent, AgentStopReason } from "../../agent/agent.ts";
import * as harness from "../../agent/harness.ts";
import { Plugin } from "../../agent/plugin.ts";
import { readTameConfig } from "../../config/index.ts";
import { InputContent, InputMessage, ToolResult, ToolUse } from "../../llm/types.ts";
import { Tool, tool } from "../../agent/tool.ts";
import { getAgentHistory, default as history } from "../history/index.ts";

const tcpListen = Type.Object({
	transport: Type.Literal("tcp"),
	hostname: Type.String(),
	port: Type.Number()
});

const unixListen = Type.Object({
	transport: Type.Literal("unix"),
	path: Type.String(),
});

export const configSchema = Type.Object({
	listen: Type.Union([tcpListen, unixListen]),
	tools: Type.Boolean({ default: true })
});

export type Config = Static<typeof configSchema>;

const acpToolSystem = `\n\nYou are connected to a user through ACP (Agent Client Protocol).

The ACP user's environment has a separate file system, and may run a different operating system.
Tools which act through ACP may behave differently from your other tools.`;

const stopReasonMap: Record<AgentStopReason, acp.StopReason> = {
	end_turn: "end_turn",
	max_tokens: "max_tokens",
	stop_sequence: "end_turn",
	tool_use: "end_turn",
	pause_turn: "end_turn",
	refusal: "refusal",
	aborted: "cancelled",
	error: "cancelled"
};

export class ACPAdapter implements acp.Agent {
	#config: Config;
	#connection: acp.AgentSideConnection;
	#sessions = new Map<string, Agent>();
	#clientCaps: acp.ClientCapabilities = {};

	constructor(connection: acp.AgentSideConnection, config: Config) {
		this.#connection = connection;
		this.#config = config;
	}

	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		if (params.clientCapabilities)
			this.#clientCaps = params.clientCapabilities;
		return {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: history.enabled,
				sessionCapabilities: {
					list: history.enabled ? {} : undefined,
				},
			}
		};
	}

	async newSession(_params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		const agent = harness.newAgent();
		this.#setupAgent(agent);
		return { sessionId: agent.id };
	}

	async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		let agent = this.#sessions.get(params.sessionId);
		if (!agent) {
			agent = await history.loadAgent(params.sessionId);
			this.#setupAgent(agent);
		}
		for (const m of agent.context)
			this.#sendMessage(agent.id, m, true);
		return {};
	}

	async listSessions(_params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
		const sessions: acp.SessionInfo[] = [];
		for (const sess of await history.list()) {
			const agent = this.#sessions.get(sess);
			if (agent) {
				const data = getAgentHistory(agent);
				sessions.push({
					sessionId: sess,
					title: data.title,
					cwd: "/", // required by acp
				});
			} else {
				sessions.push({
					sessionId: sess,
					cwd: "/", // required by acp
				});
			}
		}
		return { sessions };
	}

	async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
		return {};
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const agent = this.#sessions.get(params.sessionId);
		if (!agent) throw new Error(`session ${params.sessionId} not found`);

		agent.do("userMessage", {
			msg: {
				role: "user",
				content: this.#contentFromACP(params.prompt)
			}
		});
		const idle = await agent.waitFor("idle");

		if (idle.stopReason === "error") throw new Error("llm request failed");
		return { stopReason: stopReasonMap[idle.stopReason] };
	}

	async cancel(params: acp.CancelNotification): Promise<void> {
		const agent = this.#sessions.get(params.sessionId);
		if (!agent) throw new Error(`session ${params.sessionId} not found`);
		agent.abort();
	}

	#setupAgent(agent: Agent) {
		this.#sessions.set(agent.id, agent);

		if (this.#config.tools) {
			agent.system += acpToolSystem;

			if (this.#clientCaps.fs?.readTextFile) {
				agent.addTool(tool({
					name: "acpRead",
					desc: "Read a text file from the ACP client's environment",
					args: Type.Object({
						path: Type.String({ description: "Absolute path to the file to read" }),
						offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-based)" })),
						limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" }))
					}),
					exec: async (args) => {
						const res = await this.#connection.readTextFile({
							sessionId: agent.id,
							path: args.path,
							line: args.offset,
							limit: args.limit
						});
						return res.content;
					},
					view: {
						acp: (args) => ({
							kind: "read",
							title: `Read ${args.path} (ACP)`
						})
					}
				}));
			}

			if (this.#clientCaps.fs?.writeTextFile) {
				agent.addTool(tool({
					name: "acpWrite",
					desc: "Write a text file in the ACP client's environment",
					args: Type.Object({
						path: Type.String({ description: "Absolute path to the file to read" }),
						content: Type.String({ description: "The text content to write to the file" })
					}),
					exec: async (args) => {
						await this.#connection.writeTextFile({ sessionId: agent.id, ...args });
						return "Success.";
					},
					view: {
						acp: (args) => ({
							kind: "edit",
							title: `Write ${args.path} (ACP)`
						})
					}
				}));
			}
		}

		agent.after("assistantMessage", async (e) => {
			this.#sendMessage(agent.id, e.msg);
			return e;
		});
		agent.after("toolResult", async (e) => {
			this.#sendMessage(agent.id, {
				role: "user",
				content: [ {
					type: "tool_result",
					tool_use_id: e.toolUse,
					content: e.result
				} ]
			});
			return e;
		});
	}

	#sendMessage(sessionId: string, msg: InputMessage, noToolResult: boolean = false) {
		for (const block of msg.content) {
			switch (block.type) {
				case "thinking":
					this.#connection.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "agent_thought_chunk",
							content: {
								type: "text",
								text: block.thinking
							}
						}
					});
					break;
				case "text":
					this.#connection.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: msg.role === "assistant" ? "agent_message_chunk" : "user_message_chunk",
							content: block
						}
					});
					break;
				case "tool_use": {
					const agent = this.#sessions.get(sessionId)!;
					const result = agent.context.flatMap(m => m.content).find(c => c.type === "tool_result" && c.tool_use_id === block.id) as ToolResult | undefined;
					const tool = agent.tools.get(block.name) as Tool<TSchema>;
					const view = tool?.view?.acp?.(block.input, result);
					this.#connection.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call",
							toolCallId: block.id,
							title: block.name,
							status: result
								? result.is_error
									? "failed"
									: "completed"
								: "in_progress",
							rawInput: block.input,
							...(typeof view === "object" ? view : {})
						}
					});
					break;
				}
				case "tool_result": {
					if (noToolResult) break;
					const agent = this.#sessions.get(sessionId)!;
					const call = agent.context.flatMap(m => m.content).find(c => c.type === "tool_use" && c.id === block.tool_use_id) as ToolUse;
					const tool = agent.tools.get(call.name) as Tool<TSchema>;
					const view = tool?.view?.acp?.(call.input, block);
					this.#connection.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: block.tool_use_id,
							status: block.is_error ? "failed" : "completed",
							...(typeof view === "object" ? view : {})
						}
					});
					break;
				}
			}
		}
	}

	#contentFromACP(blocks: acp.ContentBlock[]): InputContent[] {
		let text = "";
		for (const block of blocks) {
			switch (block.type) {
				case "text":
					text += block.text;
					break;
				case "resource_link":
					text += `[${block.name}](${block.uri})`;
					break;
			}
		}
		return [ { type: "text", text } ];
	}
};

export default {
	async init() {
		const config = readTameConfig("acp.json", configSchema);
		let listener: Deno.TcpListener | Deno.UnixListener;
		if (config.listen.transport === "unix") {
			try { await Deno.remove(config.listen.path); } catch {
				// ignore
			}
			listener = Deno.listen(config.listen);
		} else {
			listener = Deno.listen(config.listen);
		}

		for await (const conn of listener) {
			if ("setKeepAlive" in conn) conn.setKeepAlive(true);
			const stream = acp.ndJsonStream(conn.writable, conn.readable);
			new acp.AgentSideConnection((conn) => new ACPAdapter(conn, config), stream);
		}
	},
} as Plugin;
