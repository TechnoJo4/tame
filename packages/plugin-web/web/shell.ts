// shell entry point — imports and mount only. no implementation.
import "./components/composer.ts";
import "./components/markdown.ts";
import "./components/message.ts";
import "./components/placement.ts";
import "./components/setting-checkbox.ts";
import "./components/setting-number.ts";
import "./components/setting-select.ts";
import "./components/settings-modal.ts";
import "./components/settings-section.ts";
import "./components/shell-app.ts";
import "./components/sidebar.ts";
import "./components/thread.ts";
import "./components/tool-fallback.ts";
import "./components/top-bar.ts";

document.body.appendChild(document.createElement("tame-web-shell"));
