// thin wrapper — re-exports typebox/compile symbols from the combined typebox.js.
// separate file solely so "typebox/compile" has the right default export while
// sharing the same typebox internals as "typebox".
export { Compile, Code, Validator } from "typebox";
import { compileDefault } from "typebox";
export default compileDefault;
