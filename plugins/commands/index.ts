import type { Agent } from "../../agent/agent.ts";
import { Plugin } from "../../agent/plugin.ts";

export interface Command {
    name: string;
    description: string;
    run(agent: Agent, param?: string): Promise<void>;
};

export class CommandsPlugin implements Plugin {
    id = "commands" as const;

    enabled?: true;

    #registry = new Map<string, Command>();

    add(command: Command) {
        if (this.#registry.has(command.name))
            throw new Error(`attempt to register conflicting command '${command.name}'`);
        this.#registry.set(command.name, command);
    }

    list(): IterableIterator<Command> {
        return this.#registry.values();
    }

    async dispatch(agent: Agent, text: string) {
        const i = text.indexOf(" ");
        const name = text.substring(text.at(0) === "/" ? 1 : 0, i !== -1 ? i : undefined);
        const cmd = this.#registry.get(name);
        if (!cmd) throw new Error(`no command '${name}'`);
        await cmd.run(agent, i !== -1 ? text.substring(i+1) : undefined);
    }
};


