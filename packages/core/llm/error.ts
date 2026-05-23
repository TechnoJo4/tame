export class InferenceError extends Error {
    response: Response;
    data: object;

    constructor(res: Response, data: object) {
        super();
        this.response = res;
        this.data = data;
    }
}
