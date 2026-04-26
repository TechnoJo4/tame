import { Thread } from "./thread.ts";

export const wrapHandler = <T>(f: (x: T) => Promise<T>): ((x: T) => Promise<T>) => {
	return async x => {
		try {
			return await f(x);
		} catch (e) {
			console.error(e);
			return x;
		}
	};
}

export type Handler<Events, K extends keyof Events> = (data: Events[K]) => Promise<Events[K]>;

export class Emitter<Events> {
	protected thread = new Thread();
	protected handlers = new Map<keyof Events, ((e: never) => unknown)[]>();
	protected onceHandlers = new Map<keyof Events, ((e: never) => unknown)[]>();

	get signal() {
		return this.thread.signal;
	}

	/** Promise that resolves on abort. */
	get aborted() {
		return new Promise<void>(r => {
			this.thread.signal?.addEventListener("abort", () => r());
		});
	}
	
	/** Abort processing and clear the queue. */
	abort() {
		this.thread.abort();
	}

	/** Add an event onto the queue. */
	fire<K extends keyof Events>(event: K, data: Events[K]) {
		this.thread.queue(() => {
			let p: Promise<Events[K]> = Promise.resolve(data);
			for (const h of this.onceHandlers.get(event) ?? []) {
				p = p.then(h as Handler<Events, K>);
			}
			this.onceHandlers.delete(event);
			for (const h of this.handlers.get(event) ?? []) {
				p = p.then(h as Handler<Events, K>);
			}
			return p;
		});
	}

	/** Run an event and get the processed event data. */
	do<K extends keyof Events>(event: K, data: Events[K]): Promise<Events[K]> {
		return new Promise(resolve => this.thread.queue(() => {
			let p: Promise<Events[K]> = Promise.resolve(data);
			for (const h of this.onceHandlers.get(event) ?? []) {
				p = p.then(h as Handler<Events, K>);
			}
			this.onceHandlers.delete(event);
			for (const h of this.handlers.get(event) ?? []) {
				p = p.then(h as Handler<Events, K>);
			}
			return p.then(e => resolve(e));
		}));
	}

	/** Add a handler at the start of an event's processing. */
	before<K extends keyof Events>(event: K, f: Handler<Events, K>) {
		if (!this.handlers.has(event))
			this.handlers.set(event, []);
		this.handlers.get(event)!.unshift(wrapHandler(f));
	}

	/** Add a handler at the end of an event's processing. */
	after<K extends keyof Events>(event: K, f: Handler<Events, K>) {
		if (!this.handlers.has(event))
			this.handlers.set(event, []);
		this.handlers.get(event)!.push(wrapHandler(f));
	}

	/** Add a handler for the processing of the single next instance of an event. */
	once<K extends keyof Events>(event: K, f: Handler<Events, K>) {
		if (!this.onceHandlers.has(event))
			this.onceHandlers.set(event, []);
		this.onceHandlers.get(event)!.push(wrapHandler(f));
	}

	/** Promise that resolves with the next instance of an event. */
	waitFor<K extends keyof Events>(event: K): Promise<Events[K]> {
		return new Promise(resolve => {
			this.once(event, async (e) => {
				resolve(e);
				return e;
			});
		});
	}
}
