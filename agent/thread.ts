export class Thread {
    #promise?: Promise<AbortController>;
    #controller?: AbortController;

    get signal() {
        return this.#controller?.signal;
    }

    abort() {
        this.#promise = undefined;
        this.#controller?.abort();
        this.#controller = undefined;
    }

    queue(f: () => Promise<unknown>) {
        if (this.#promise === undefined) {
            const c = this.#controller = new AbortController();
            this.#promise = Promise.resolve(c);
        }
        this.#promise = this.#promise.then(c => {
            if (!c.signal.aborted)
                return f().then(() => c).catch(() => c);
            return c;
        });
    }
}
