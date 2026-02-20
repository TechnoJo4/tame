import type { Model } from "@mariozechner/pi-ai";

export async function fetchOpenrouterModels(): Promise<Model<string>[]> {
	const response = await fetch("https://openrouter.ai/api/v1/models");
	const data = await response.json();

	const models: Model<string>[] = [];
	for (const model of data.data) {
		if (!model.supported_parameters?.includes("tools")) continue;
		models.push({
			id: model.id,
			name: model.name,
			api: "openai-completions",
			baseUrl: "https://openrouter.ai/api/v1",
			provider: "openrouter",
			reasoning: model.supported_parameters?.includes("reasoning") || false,
			input: model.architecture?.modality?.includes("image") ? ["text", "image"] : ["text"],
			cost: {
				input: parseFloat(model.pricing?.prompt || "0") * 1_000_000,
				output: parseFloat(model.pricing?.completion || "0") * 1_000_000,
				cacheRead: parseFloat(model.pricing?.input_cache_read || "0") * 1_000_000,
				cacheWrite: parseFloat(model.pricing?.input_cache_write || "0") * 1_000_000,
			},
			contextWindow: model.context_length || 4096,
			maxTokens: model.top_provider?.max_completion_tokens || 4096,
		});
	}

	return models;
}
