export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export const getLineIndices = (str: string) => {
    const res = [0];
    for (let i = 0; i !== -1; i = str.indexOf("\n", i))
        res.push(i);
    return res;
};

