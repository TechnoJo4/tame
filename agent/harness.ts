import { complete, type ToolCall, type Model, type ProviderStreamOptions } from "@mariozechner/pi-ai";
import { Ajv, type ValidateFunction } from "ajv";
import type { AnyTool } from "./tool.ts";
import type { Agent } from "./agent.ts";
import { Ratelimiter } from "./ratelimit.ts";

const bootTime = Date.now();

export interface HarnessOptions {
    tools: AnyTool[],
    model: Model<string>,
    inferenceOptions: ProviderStreamOptions
}

export class Harness {
    options: HarnessOptions;

    // tool call argument validation
    schemas = new Map<AnyTool, ValidateFunction<unknown>>();
    ajv = new Ajv({
        allErrors: true,
        strict: false,
        coerceTypes: true,
    });

    constructor(options: HarnessOptions) {
        this.options = options;
        for (const tool of options.tools) {
            this.schemas.set(tool, this.ajv.compile(tool.def.parameters));
        }
    }

    /** Manually wake up the background loop */
    signal: () => void = () => {}

    /** Stop the background loop */
    #stop: boolean = false;
    stop() {
        this.#stop = true;
        this.signal();
    }

    // Agents
    agents: Set<Agent> = new Set();

    /** Add an agent and start its loop */
    async addAgent(agent: Agent, shouldSignal: boolean = true) {
        for (const tool of this.options.tools)
            if (typeof tool.see === "boolean" ? tool.see : tool.see(agent))
                agent.addTool(tool);

        await agent.initCtx();

        this.agents.add(agent);

        if (shouldSignal) this.signal();

        console.debug(`harness: added agent ${agent.id} (tools: ${Array.from(agent.tools.keys()).join(", ")}), now have ${this.agents.size} agents`);
    }

    #ratelimiter = new Ratelimiter();
    #complete(agent: Agent) {
        agent.promise = this.#ratelimiter.wait()
            .then(() => agent.updateCtx())
            .then(() => {
                const options: ProviderStreamOptions = {
                    ...this.options.inferenceOptions,
                    sessionId: `tame-${bootTime}-${agent.id}`,
                    headers: {
                        "X-Title": "Tame",
                        "HTTP-Referer": "https://merkletr.ee/tame",
                    }
                };

                console.debug(`harness: sending completion request for agent ${agent.id}`);
                return complete(this.options.model, agent.ctx, options);
            })
            .then(res => {
                console.debug(res);
                if (res.stopReason !== "error") {
                    agent.ctx.messages.push(res);
                    this.#ratelimiter.success();
                } else {
                    this.#ratelimiter.error();
                }
                agent.promise = undefined;
            }, (err) => {
                this.#ratelimiter.error();
                console.error(err);
                agent.promise = undefined;
            });
    }

    #runToolCalls(agent: Agent, calls: ToolCall[]) {
        console.debug(`harness: running tool calls for agent ${agent.id}`);
        const promises: Promise<void>[] = [];

        for (const call of calls) {
            const tool = agent.tools.get(call.name);
            if (tool === undefined) {
                agent.ctx.messages.push({
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    isError: true,
                    content: [ { type: "text", text: `tool "${call.name}" not found` } ],
                    timestamp: Date.now(),
                });
                continue;
            }

            const val = this.schemas.get(tool)!;
            const args = structuredClone(call.arguments);
            if (!val(args)) {
                const errors = val.errors?.map(err => `- ${err.instancePath || err.params.missingProperty || "root"}: ${err.message}`);

                console.error(`tool error (${tool} argument validation):\n${errors}`);
                agent.ctx.messages.push({
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    isError: true,
                    content: [ { type: "text", text: `invalid args to "${call.name}":\n${errors?.join("\n")}` } ],
                    timestamp: Date.now(),
                });
                continue;
            }

            promises.push(new Promise(resolve => {
                Promise.try(tool.run, args, agent, this).then(res => {
                    agent.ctx.messages.push({
                        role: "toolResult",
                        toolCallId: call.id,
                        toolName: call.name,
                        isError: false,
                        content: [ { type: "text", text: typeof res === "string" ? res : JSON.stringify(res) } ],
                        timestamp: Date.now(),
                    });
                    resolve();
                }).catch(err => {
                    console.error(`tool error (${tool}):\n${err}`);
                    agent.ctx.messages.push({
                        role: "toolResult",
                        toolCallId: call.id,
                        toolName: call.name,
                        isError: true,
                        content: [ { type: "text", text: `error in "${call.name}":\n${err instanceof Error ? err.message : err}` } ],
                        timestamp: Date.now(),
                    });
                    resolve();
                });
            }));
        }

        // Agent can resume once all tools have executed
        const c = () => agent.promise = undefined;
        agent.promise = Promise.all(promises).then(c, c);
    }

    async backgroundLoop(): Promise<undefined> {
        console.log("harness: starting loop");
        while (!this.#stop) {
            const signalPromise = Promise.withResolvers<void>();
            this.signal = signalPromise.resolve;

            await Promise.any([
                ...this.agents.values().map(a => a.promise).filter(p => p),
                signalPromise.promise
            ]);
            console.debug(`harness: woke up, have ${this.agents.size} agents`);

            for (const agent of this.agents) {
                agent.save();
                if (agent.promise !== undefined) {
                    console.debug(`harness: skipping agent ${agent.id}, has promise`);
                    continue;
                }

                const lastMessage = agent.ctx.messages[agent.ctx.messages.length-1];
                if (lastMessage.role === "assistant") {
                    const calls = lastMessage.content.filter(m => m.type === "toolCall");

                    if (calls.length === 0) {
                        if (agent.continuation !== undefined) {
                            const nextPrompt = agent.continuation();
                            if (nextPrompt !== undefined) {
                                agent.ctx.messages.push({
                                    role: "user",
                                    content: nextPrompt,
                                    timestamp: Date.now()
                                });
                            } else {
                                console.debug(`harness: agent ${agent.id} done, continuation returned nothing`);
                                continue;
                            }
                        } else {
                            console.debug(`harness: agent ${agent.id} done, no continuation`);
                            continue;
                        }
                    } else {
                        this.#runToolCalls(agent, calls);
                        continue;
                    }
                }

                if (lastMessage.role === "user" || lastMessage.role === "toolResult") {
                    this.#complete(agent);
                } else {
                    console.debug(`harness: agent ${agent.id} done? what`, );
                }
            }
        }
        this.#stop = false;
        console.log("harness: exited loop");
    }
};
