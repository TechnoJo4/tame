import { tool, Type } from "../../agent/tool.ts";

export const web_fetch = tool({
	name: "web_fetch",
	desc: "Fetch and convert a URL to markdown using the Jina Reader API",
	args: Type.Object({
		url: Type.String({ description: "URL to fetch and convert" }),
		max_tokens: Type.Optional(Type.Number({ description: "Maximum number of tokens in the response" }))
	}),
	exec: async (args, agent) => {
		const apiKey = Deno.env.get("JINA_API_KEY");
		if (!apiKey)
			throw new Error(`User did not provide a Jina AI API key. Tell the user to set the JINA_API_KEY environment variable.`);

		const headers: Record<string, string> = {
			"Accept": "application/json",
			"Content-Type": "application/json",
			"Authorization": "Bearer "+apiKey
		};
		if (args.max_tokens)
			headers["X-Token-Budget"] = String(args.max_tokens);

		const req = await fetch("https://r.jina.ai/", {
			method: "POST",
			signal: agent.signal,
			body: JSON.stringify({ url: args.url }),
			headers
		});

		type JinaResponse = {
			code: number;
			status: number;
			data: {
				title: string;
				url: string;
				content: string;
			};
		};

		const res: JinaResponse = await req.json();
		if (!req.ok || res.code !== 200)
			throw new Error(`Jina API returned ${req.status}, code ${res.code}, status: ${res.status}`);
		return res.data.content;
	},
	view: {
		acp: ({ url }, result) => ({
			kind: "fetch",
			title: `Fetch ${url}`,
			content: result && !result.is_error ? [{
				"type": "content",
				"content": {
					"type": "text",
					"text": result.content
				}
			}] : []
		})
	}
});

export default [ web_fetch ];
