// shell entry point — imports and mount only. no implementation.
import "./components/shell-app.ts";
import "./components/sidebar.ts";
import "./components/thread.ts";
import "./components/message.ts";
import "./components/composer.ts";
import "./components/markdown.ts";
import "./components/tool-fallback.ts";
import "./lib/rpc-controller.ts";

document.body.appendChild(document.createElement("tame-shell"));
