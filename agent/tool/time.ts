import { tool, Type } from "../tool.ts";

const timeObj = () => ({
    unixMillis: Date.now(),
    isoString: new Date().toISOString()
});

export const time = tool({
    def: {
        name: "currentTime",
        description: "get the time",
        parameters: Type.Any(),
    },
    run: timeObj,
    see: true
});

export const wait = tool({
    def: {
        name: "wait",
        description: "pause execution. you will get a result from this tool only once some time has passed.",
        parameters: Type.Object({
            duration: Type.Number({ description: "time to wait in milliseconds" })
        })
    },
    run: args => new Promise(r => setTimeout(() => r(timeObj()), args.duration)),
    see: true
});

export const waitUntil = tool({
    def: {
        name: "waitUntil",
        description: "pause execution. you will get a result from this tool only once a date-time has been reached.",
        parameters: Type.Object({
            unixMillis: Type.Number({ description: "date-time to wait for" })
        })
    },
    run: args => {
        const now = Date.now();
        if (args.unixMillis < now)
            throw new Error(`${args.unixMillis} is in the past (current time: ${now})`);
        return new Promise(r => setTimeout(() => r(timeObj()), args.unixMillis - now));
    },
    see: true
});
