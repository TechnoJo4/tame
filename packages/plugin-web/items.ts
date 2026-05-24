import type { InputMessage, ToolUse, ToolResult, IAgent } from "@tame/sdk";
import type { ThreadItem, MessageItem, ToolCallItem, TextOrThinking } from "@tame/web-sdk";

// ---- context → items conversion ----

/** Convert an agent's full context to ThreadItem[] with pre-resolved web views.
 *  Uses the agent's viewToolCall to resolve view metadata for each tool_use block.
 *  Keys are stable: tool calls use their id, messages use "msg-{contextIdx}". */
export function contextToItems(agent: IAgent): ThreadItem[] {
	const items: ThreadItem[] = [];
	let msgIdx = 0;

	for (const msg of agent.context) {
		if (msg.role === "user") {
			for (const block of msg.content) {
				if (block.type === "text") {
					items.push({
						type: "message",
						role: "user",
						content: [{ type: "text", text: block.text }],
						key: `msg-${msgIdx}`,
					});
				} else if (block.type === "tool_result") {
					// attach result to the matching tool_call item
					for (let i = items.length - 1; i >= 0; i--) {
						const item = items[i];
						if (item.type === "tool_call" && item.id === block.tool_use_id) {
							item.result = block.content;
							item.isError = block.is_error;
							break;
						}
					}
				}
			}
		} else {
			// assistant message: text/thinking blocks → message item,
			// tool_use blocks → tool_call items with pre-resolved views
			const textBlocks: TextOrThinking[] = [];

			for (const block of msg.content) {
				if (block.type === "tool_use") {
					if (textBlocks.length > 0) {
						items.push({
							type: "message",
							role: "assistant",
							content: [...textBlocks],
							key: `msg-${msgIdx}`,
						});
						textBlocks.length = 0;
					}
					// find matching result for view resolution
					let result: ToolResult | undefined;
					for (const m of agent.context) {
						for (const c of m.content) {
							if (c.type === "tool_result" && c.tool_use_id === block.id) {
								result = c;
								break;
							}
						}
						if (result) break;
					}
					const view = agent.viewToolCall("web", block, result) as
						{ tag: string; props: Record<string, unknown> } | undefined;
					const toolItem: ToolCallItem = {
						type: "tool_call",
						id: block.id,
						name: block.name,
						input: block.input,
						key: block.id,
					};
					if (view?.tag) toolItem.view = view;
					// attach result if already present
					if (result) {
						toolItem.result = result.content;
						toolItem.isError = result.is_error;
					}
					items.push(toolItem);
				} else if (block.type === "text") {
					textBlocks.push({ type: "text", text: block.text });
				} else if (block.type === "thinking") {
					textBlocks.push({ type: "thinking", thinking: block.thinking });
				} else if (block.type === "tool_result") {
					// tool_results in assistant messages shouldn't happen,
					// but handle just in case: attach to matching tool_call
					for (let i = items.length - 1; i >= 0; i--) {
						const item = items[i];
						if (item.type === "tool_call" && item.id === block.tool_use_id) {
							item.result = block.content;
							item.isError = block.is_error;
							break;
						}
					}
				}
			}

			if (textBlocks.length > 0) {
				items.push({
					type: "message",
					role: "assistant",
					content: [...textBlocks],
					key: `msg-${msgIdx}`,
				});
			}
		}
		msgIdx++;
	}

	return items;
}

/** Convert a single assistant message's content blocks to items with pre-resolved views.
 *  Used for live assistantMessage events. */
export function assistantBlocksToItems(
	blocks: InputMessage["content"],
	agent: IAgent,
): ThreadItem[] {
	const items: ThreadItem[] = [];
	const textBlocks: TextOrThinking[] = [];

	for (const block of blocks) {
		if (block.type === "tool_use") {
			if (textBlocks.length > 0) {
				items.push({
					type: "message",
					role: "assistant",
					content: [...textBlocks],
					key: `msg-live-${block.id}`,
				});
				textBlocks.length = 0;
			}
			// results won't exist yet for live events (tool hasn't executed)
			const view = agent.viewToolCall("web", block) as
				{ tag: string; props: Record<string, unknown> } | undefined;
			const toolItem: ToolCallItem = {
				type: "tool_call",
				id: block.id,
				name: block.name,
				input: block.input,
				key: block.id,
			};
			if (view?.tag) toolItem.view = view;
			items.push(toolItem);
		} else if (block.type === "text") {
			textBlocks.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			textBlocks.push({ type: "thinking", thinking: block.thinking });
		}
	}

	if (textBlocks.length > 0) {
		items.push({
			type: "message",
			role: "assistant",
			content: [...textBlocks],
			key: `msg-live-${items.length > 0 ? (items[0] as ToolCallItem).id ?? "t" : "t"}`,
		});
	}

	return items;
}

/** Paginate items with 0 = most recent. Returns chronological order (oldest first). */
export function paginateItems(
	items: ThreadItem[],
	offset: number,
	limit: number,
): ThreadItem[] {
	const start = Math.max(0, items.length - offset - limit);
	const end = items.length - offset;
	return items.slice(start, end);
}
