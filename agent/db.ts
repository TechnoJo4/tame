import { Database } from "@db/sqlite";

const promise = <T>(f: () => T | undefined): Promise<T> => {
    return new Promise((resolve, reject) => {
        try {
            const t = f();
            if (t === undefined) reject();
            else resolve(t);
        } catch (e) {
            reject(e);
        }
    });
};

const promiseV = (f: () => void): Promise<void> => new Promise((resolve, reject) => {
    try { f(); resolve() } catch (e) { reject(e); }
});

const dbLocation = Deno.env.get("TAME_DB") ?? "./data/tame.db";

const db = new Database(dbLocation, { int64: true });

db.exec(`pragma journal_mode = WAL;`);

db.exec(`
CREATE TABLE IF NOT EXISTS config(
    k TEXT PRIMARY KEY NOT NULL,
    v TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent(
    id INTEGER PRIMARY KEY NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS context(
    agent TEXT NOT NULL,
    i INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (agent, i),
    FOREIGN KEY (agent) REFERENCES agent (id)
) STRICT;

CREATE TABLE IF NOT EXISTS memory(
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS attachment(
    agent TEXT NOT NULL,
    memory TEXT NOT NULL,
    PRIMARY KEY (agent, memory),
    FOREIGN KEY (agent) REFERENCES agent (id),
    FOREIGN KEY (memory) REFERENCES memory (id)
) STRICT;
`);

// config
const getConfig = db.prepare("SELECT v FROM config WHERE k = ?");
const setConfig = db.prepare("INSERT OR REPLACE INTO config (k,v) VALUES (?, ?)");

// agent
const newAgent = db.prepare("INSERT INTO agent (id) VALUES (NULL) RETURNING id");

// memory
const getMemory = db.prepare("SELECT content FROM memory WHERE id = ?");
const setMemory = db.prepare("INSERT OR REPLACE INTO memory (id, content) VALUES (?, ?)");
const getAttached = db.prepare("SELECT memory, m.content FROM attachment JOIN memory m ON m.id = memory WHERE agent = ?");
const listMemory = db.prepare("SELECT id FROM memory");
const memoryExists = db.prepare("SELECT EXISTS(SELECT 1 FROM memory WHERE id = ?)");
const isAttached = db.prepare("SELECT EXISTS(SELECT 1 FROM attachment WHERE agent = ? AND memory = ?)");
const attach = db.prepare("INSERT OR REPLACE INTO attachment (agent, memory) VALUES (?, ?)");
const detach = db.prepare("DELETE FROM attachment WHERE agent = ? AND memory = ?");

// context
const getContext = db.prepare("SELECT i, data FROM context WHERE agent = ? ORDER BY i ASC");
const pushContext = db.prepare("INSERT OR REPLACE INTO context (agent, i, data) VALUES (?, ?, ?)");

export default {
    db,
    config: {
        get: (k: string) => promise(() => getConfig.value<[string]>(k) ?? [""]).then(v => v[0]),
        set: (k: string, v: string) => promiseV(() => setConfig.run(k, v)),
    },
    agent: {
        new: () => promise(() => newAgent.value<[number]>()).then(v => v[0]),

        getContext: (agent: number) => promise(() => getContext.values<[number, string]>(agent)).then(r => r.map(c => c[1])),
        pushContext: (agent: number, i: number, data: string) => promiseV(() => pushContext.run(agent, i, data)),
    },
    memory: {
        get: (id: string) => promise(() => getMemory.value<[string]>(id)).then(v => v[0]),
        set: (id: string, content: string) => promiseV(() => setMemory.run(id, content)),
        list: () => promise(() => listMemory.values<[string]>()).then(rows => rows.map(v => v[0])),
        memoryExists: (memory: string) => promise(() => memoryExists.value<[number]>(memory)).then(v => v[0] !== 0),
        getAttached: (agent: number) => promise(() => getAttached.values<[string, string]>(agent)).then(rows => Object.fromEntries(rows)),
        isAttached: (agent: number, memory: string) => promise(() => isAttached.value<[number]>(agent, memory)).then(v => v[0] !== 0),
        attach: (agent: number, block: string) => promiseV(() => attach.run(agent, block)),
        detach: (agent: number, block: string) => promiseV(() => detach.run(agent, block)),
    }
};
