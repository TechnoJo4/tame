import { createContext } from "@lit/context";

/** Context key for the currently displayed agent's ID.
 *  Provided by the shell, consumed by any component that needs
 *  to know which agent is active (history sidebar, session title, etc). */
export const agentIdContext = createContext<string | null>(Symbol("agentId"));
