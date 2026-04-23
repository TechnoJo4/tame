import { tool, Type } from "../../agent/tool.ts";

export const web_search = tool({
	name: "web_search",
	desc: "Execute a search query using Tavily Search",
	args: Type.Object({
        query: Type.String({ description: "Search query to execute with Tavily" }),
		max_results: Type.Number({ description: "Maximum number of search results to return", minimum: 1, maximum: 20 })
    }),
	exec: async (args, agent) => {
		const apiKey = Deno.env.get("TAVILY_API_KEY");
		if (!apiKey)
			throw new Error(`User did not provide a Tavily API key. Tell the user to set the TAVILY_API_KEY environment variable.`)

		const req = await fetch("https://api.tavily.com/search", {
			method: "POST",
			signal: agent.signal,
			body: JSON.stringify(args),
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer "+apiKey
			}
		});

		const res = await req.json();
		if (!req.ok)
			throw new Error(`Tavily API returned ${req.status}, error: ${res.detail.error}`);
		return res.results;
	}
});

export default [ web_search ];
