import { Harness, importPath, loadBaseTools, pathResolve } from "@tame/agent";
import * as code from "@tame/code";
import { type Connector, addConnector, getConnectors, setHarness } from "./connector.ts";

const importConnector = (name: string): Promise<Connector> =>
    importPath(pathResolve(import.meta.dirname!, name, "index.ts")).then(mod => mod.default);

if (Deno.env.has("DISCORD_TOKEN")) {
    addConnector(await importConnector("discord"));
}

const tools = getConnectors().flatMap(c => c.tools);

tools.splice(tools.length, 0, ...await loadBaseTools());
tools.splice(tools.length, 0, ...code.tools);

const harness = new Harness({
    tools,
    inferenceOptions: {
        apiKey: "public"
    },
    model: {
        id: "minimax-m2.5-free",
        name: "MiniMax M2.5 Free",
        api: "openai-completions",
        provider: "opencode",
        baseUrl: "https://opencode.ai/zen/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 204800,
        maxTokens: 131072
    }
});

setHarness(harness);

harness.backgroundLoop();
