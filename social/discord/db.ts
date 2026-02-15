import { db } from "@tame/agent";

db.db.exec(`
CREATE TABLE IF NOT EXISTS discordAgents(
    channel TEXT PRIMARY KEY NOT NULL,
    agent INTEGER NOT NULL,
    FOREIGN KEY (agent) REFERENCES agent (id)
) STRICT;
`);

const getChannelAgent = db.db.prepare("SELECT agent FROM discordAgents WHERE channel = ?");
const setChannelAgent = db.db.prepare("INSERT OR REPLACE INTO discordAgents (channel, agent) VALUES (?, ?)");

export default {
    getChannelAgent: (channel: string) => (getChannelAgent.value<[number]>(channel) ?? [0])[0],
    setChannelAgent: (channel: string, agent: number) => setChannelAgent.run(channel, agent),
};
