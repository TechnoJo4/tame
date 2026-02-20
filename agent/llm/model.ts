import { getModels as getKnownModels, type KnownProvider, type Model } from "@mariozechner/pi-ai";
import { fetchOpenrouterModels } from "./openrouter.ts";
import db from "../db.ts";

const cacheGet = db.db.prepare("SELECT models,time FROM modelCache WHERE provider = ?");
const cacheSet = db.db.prepare("INSERT OR REPLACE INTO modelCache (provider,models,time) VALUES (?, ?, ?)");

const FORCE_RECACHE_TIME = 7*24*60*60*1000;

export async function getModel(provider: KnownProvider, modelId: string): Promise<Model<string> | undefined> {
    const c = cacheGet.value<[string,number]>(provider);
    if (c) {
        const [json,t] = c;
        const models: Model<string>[] = JSON.parse(json);
        const model = models.find(m => m.id === modelId);
        if (model && (Date.now()-t) < FORCE_RECACHE_TIME) return model;
    }

    switch (provider) {
        case "openrouter": {
            const models = await fetchOpenrouterModels();
            cacheSet.run(provider, JSON.stringify(models), Date.now());
            return models.find(m => m.id === modelId);
        }
    }

    const models = getKnownModels(provider) as Model<string>[];
    return models.find(m => m.id === modelId);
}
