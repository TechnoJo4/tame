import type { Message, Content } from "./types.ts";
import { tameMsgMeta, tameContentMeta } from "../util/symbols.ts";

type ContentTypes = Content["type"];

export const contentFields = {
    "text": ["type", "text"],
    "thinking": ["type", "thinking"],
    "redacted_thinking": ["type"],
    "tool_use": ["type", "id", "input", "name", "result"],
    "tool_result": ["type", "is_error", "content"]
} as Record<ContentTypes, string[]>;

export const stripContent = (content: Content): Content => {
    const fields = contentFields[content.type] as (keyof Content)[];
    const extra = structuredClone(content);
    const res: any = { [tameContentMeta]: content[tameContentMeta] ?? {} };
    for (const f of fields) {
        res[f] = extra[f];
        delete extra[f];
    }
    res[tameContentMeta].providerData = extra;
    if (content.type === "tool_use" && content.result !== undefined)
        res.result = stripContent(res.result);
    return res;
};

export const stripMessage = <T extends Message>(msg: T): T => {
    const extra = structuredClone(msg);
    const res: any = { [tameMsgMeta]: msg[tameMsgMeta] ?? {} };
    for (const f of ["role", "content", "stop_reason", "model", "usage"] as (keyof Message)[]) {
        res[f] = extra[f];
        delete extra[f];
    }
    res.content = res.content.map(stripContent);
    res[tameMsgMeta].providerData = extra;
    return res;
};
