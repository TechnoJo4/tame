import { state, see } from "../state.ts";
import { tool, Type } from "@tame/agent";

export const send = tool({
    def: {
        name: "discordSend",
        description: "send a message on discord",
        parameters: Type.Object({
            reply_to: Type.Optional(Type.String({ description: "numerical ID of the message to mark this as a reply to" })),
            message: Type.String({ description: "content of the message to send" }),
        }),
    },
    run: async (args, agent) => {
        const discord = state(agent);
        const chan = discord.client.channels.resolve(discord.channelId);
        if (!chan?.isSendable())
            throw new Error("you cannot send messages in this channel.");

        const m = await chan.send({
            content: args.message,
            reply: args.reply_to === undefined ? undefined : {
                messageReference: args.reply_to,
                failIfNotExists: true
            },
            allowedMentions: {
                repliedUser: false,
                roles: [],
            }
        });
        return `result: success. message id: ${m.id}.`;
    },
    see
});
