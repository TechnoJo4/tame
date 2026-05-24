# contributing to plugin-web

plugin-web is tame's browser ui. think of it as a display server, not an application. it renders a chrome (layout, top bar, composer, thread area) and carves out named slots ("placements") that other plugins fill with their own components. it knows nothing about any specific plugin's domain — history, ops, memory, skills, all of those are opaque.

if you come at this like a normal frontend, you'll break the isolation that makes the rest of tame work. this file translates tame's core tenets into concrete web rules.

## the mental model

```
plugin-web:  provides the shell + placement slots + theme variables
plugin-*:    owns a domain concept → provides components, styles, RPC methods
```

plugin-web is the *only* plugin that puts `<div>` on screen unprompted. every other piece of ui arrives because some plugin registered a component at a placement. if you find yourself adding markup or styles for something that isn't a shell concern (layout, composition, routing), stop — it belongs in the plugin that owns that concept.

## rules

### 1. the shell must not know any plugin exists

`rpc-controller.ts` is the shell's brain. it must never call a plugin's RPC methods by name, subscribe to a plugin's events, or reference a plugin's types. `"history"`, `"ops"`, `"memory"` — these strings do not exist from the shell's perspective.

**what to do instead:** if a plugin needs the shell to do something (like switch to a different agent), the plugin owns that interaction end-to-end. the shell provides a generic capability — e.g. `switchAgent(id)` is fine as a controller method because it doesn't encode knowledge of *how* sessions are stored. but the shell calling `client.call("history", "load", ...)` inside `switchAgent` is a violation, because now the shell knows that sessions are loaded through a plugin called "history".

**current violations to fix:**
- `rpc-controller.ts:138`: `client.call("history", "load", { id })` — the shell knows about history's persistence model
- `rpc-controller.ts:141`: `client.call("@tame", "getAgentContext", { id })` — the shell knows about core RPC
- `rpc-controller.ts:168`: `client.call("@tame", "abort", { id })` — same

### 2. every visible element maps to a placement or a shell built-in

the shell owns these things directly (they appear in `shell-app.ts`):
- the layout grid (sidebar + main column)
- the top bar with left/center/right slots
- the thread area (`<tame-thread>`)
- the composer (`<tame-composer>`)
- the markdown renderer (`<tame-markdown>`)
- the tool fallback view (`<tame-tool-fallback>`)

**everything else must arrive via `web.register()` from the plugin that owns the concept.** if you're adding a new piece of ui, ask: which plugin owns this concept? add the component there, then register it with a placement. if it's truly shell-level (e.g. a resize handle, a theme toggle, a keyboard shortcut handler), it belongs in `static/` and must not depend on any plugin.

### 3. components and attributes above divs and classes

lit elements render into the light dom (`createRenderRoot() { return this; }`). this means the dom is flat — no shadow boundaries. that's intentional: it lets themes style everything from one place.

because there's no shadow dom, css scoping is done by **component tag name**, not by class. a style rule like:

```css
/* wrong — bare class leaks across the whole document */
.ops-label { font-size: 12px; }

/* correct — scoped under the custom element */
tame-ops-read .ops-label { font-size: 12px; }
```

classes are for *internal* structure within a single component. they're never utility classes and never cross component boundaries. the rule: if you write a class selector, it must be preceded by the component's tag name.

**prefer attributes over classes for state.** use `data-*` attributes (or `[collapsed]`, `[active]`) for component states — they're cheap to query from theme css and make intent obvious:

```css
tame-sidebar[collapsed] { display: none; }
tame-message[data-role="user"] { background: var(--tame-surface); }
```

### 4. never style inline, never use value-classes

no `style=` attributes in html. no class names that embed design values like `padding-4`, `margin-small`, `color-danger`, `text-lg`. these make themes powerless.

the contract between themes and components is **css custom properties**. the default theme sets variables on `:root`:

```css
:root {
  --tame-bg: #111;
  --tame-surface: #1a1a2e;
  --tame-border: #333;
  --tame-text: #eee;
  --tame-text-muted: #888;
  --tame-danger: #f66;
  --tame-success: #6f6;
}
```

every component, including plugin components, must use these variables exclusively for colors, spacing, and typography. a custom theme should be able to replace `:root` and have the entire ui follow — not just swap a palette, but radically restyle. if a component uses a hardcoded color or a css value that isn't a variable, it breaks this contract.

**current violations to fix:**
- `plugin-ops/web/ops.css` uses `rgba(255,0,0,0.08)`, `rgba(0,255,0,0.06)`, and `#4caf50` — these should be derived from theme variables

### 5. plugin-owned concepts stay in the plugin

if plugin-history owns the concept of "an agent has a title," then:
- the `tame-session-title` component lives in `plugin-history/web/`
- the css for it lives in `plugin-history/web/history.css`
- no other plugin references it, subscribes to its events, or calls its RPC methods

**the theme should not know about plugin components either.** `default.css` currently has:

```css
tame-session-title { display: block; }
tame-session-title > .session-title { ... }
```

this is a violation — the theme knows about a history-owned component. if history is disabled, `tame-session-title` doesn't exist, and these rules are dead code (violating the "no feature-flag-like dead code" tenet).

the fix: plugin components should carry their own minimal structural css (display, basic layout). themes provide variables and can optionally style plugin components by tag name — but the *default* styles for a plugin component must live in that plugin's css file, not in the theme.

### 6. register early, register completely

in your plugin's `init()`:

```ts
const web = harness.getPlugin("web") as WebPlugin | undefined;
if (web) {
  const dir = import.meta.dirname!;
  web.register("my-plugin", [
    { tag: "tame-my-component", src: web.resolve(dir, "./web/my-component.ts") },
  ], [
    { location: "panel:sidebar", tag: "tame-my-component" },
  ], web.resolve(dir, "./web/my-component.css"));
}
```

three arguments: components, placements, css. all are optional but you almost always want at least one component and one placement. the css file is served automatically and injected into `<head>` when the shell loads — no manual `<link>` tags.

**available placement locations:**
- `panel:sidebar` — the sidebar panel
- `topbar:left` — left side of the top bar
- `topbar:center` — center of the top bar
- `topbar:right` — right side of the top bar

### 7. components talk to their own plugin, not to other plugins

a plugin's web component gets a `controller` property (the `WebController` interface). through `controller.client`, it can call RPC methods and subscribe to events — but only for its *own* plugin:

```ts
// inside tame-history component — correct
this.#unsub = client.subscribe(
  { plugin: "history", event: "sessionsChanged" },
  handler
);
const result = await client.call("history", "list", {});

// inside tame-history component — wrong
const result = await client.call("ops", "read", {});  // don't cross plugin boundaries
```

if two plugins need to interoperate in the ui, they do it through the shell's placement system or through data passed as props at registration time — never through cross-plugin RPC calls from the frontend.

### 8. no framework, no build step for plugin components

plugin components are lit elements. the shell bundles lit, typebox, and the rpc client as pre-built js files served from `/static/`. plugin `.ts` components are transpiled at startup by rollup+swc (see `index.ts:#transpile`). no extra tooling needed — write a `.ts` file, register it, it gets served.

this means plugin components must keep imports minimal. external dependencies beyond lit, typebox, and `@tame/web-sdk` require updating `build-config.ts` and the import map in `index.html`. avoid it unless you have a very good reason.

### 9. css file structure

a plugin's css file should look like this:

```css
/* every rule scoped under the component's tag name */
tame-my-component { display: block; }
tame-my-component .some-internal-class { color: var(--tame-text); }
tame-my-component[data-loading] { opacity: 0.6; }

/* no bare classes. no hardcoded values. use theme variables for everything. */
```

checklist:
- [ ] every selector starts with a custom element tag name
- [ ] all colors come from `var(--tame-*)`
- [ ] all spacing uses theme variables or structural defaults (don't inline `margin: 12px`)
- [ ] no `style=` attributes in component render methods
- [ ] no class names like `red`, `big`, `pad-4`, `flex-row`

### 10. tool views: register components, not templates

when a plugin defines a tool, it can provide a `view` function that returns a component descriptor for `"web"`:

```ts
// in plugin-ops/index.ts — the tool definition
tool({
  name: "read",
  // ...
  views: {
    web: (args) => ({
      tag: "tame-ops-read",
      props: { path: args.path, offset: args.offset, limit: args.limit },
    }),
  },
})
```

`tame-tool-view` resolves the tag, loads the component module if needed, and creates the element. after creation it sets `.result` and `.isError` on the element — so every tool view component must accept those properties.

the component itself lives in the plugin's `web/` directory and is registered with `web.register()`:

```ts
// plugin-ops/web/ops.ts
export class TameOpsRead extends LitElement {
  static properties = {
    path: { type: String },
    result: { type: String },    // set by tame-tool-view after tool execution
    isError: { type: Boolean },  // set by tame-tool-view after tool execution
  };
  // ...
}
```

the component must handle the case where `result` is `null`/`undefined` (tool hasn't executed yet — show a loading state or just the input).

## places to look

- `static/components/shell-app.ts` — the shell layout and placement rendering
- `static/lib/rpc-controller.ts` — the bridge between ui and backend (needs cleanup per rule 1)
- `static/themes/default.css` — the theme contract (needs cleanup per rule 5)
- `../plugin-history/web/` — reference implementation of plugin web components
- `../plugin-ops/web/` — another example, with a few violations (bare classes, hardcoded colors)
- `../web-sdk/` — shared types for components and controller interface
