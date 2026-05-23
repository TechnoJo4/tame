import type { Agent } from "../../agent/agent.ts";
import type { Plugin } from "../../agent/plugin.ts";
import { Type } from "../../agent/tool.ts";
import { promises as fs } from "node:fs";
import type { Static } from "typebox";

export const configSchema = Type.Object({
    prepend: Type.Array(Type.String(), { default: [] }),
});

export type Config = Static<typeof configSchema>;

export class SystemLoadPlugin implements Plugin {
    id = "system-load" as const;

    #text: Promise<string>;

    constructor(config: Config) {
        this.#text = Promise.all(config.prepend.map(f => fs.readFile(f, { encoding: "utf-8" }))).then(res => res.join("\n\n"));
    }

    async newAgent(agent: Agent) {
        agent.system = (await this.#text) + agent.system;
    }
}

