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

if a plugin needs the shell to do something (like switch to a different agent), the plugin owns that interaction end-to-end. the shell provides generic capabilities — `switchAgent(id)` is fine because it doesn't encode knowledge of *how* sessions are stored. but the shell calling `client.call("history", "load", ...)` inside `switchAgent` is a violation: now the shell knows sessions are loaded through a plugin called "history".

calling `client.call("@tame", ...)` is fine — core tame is always present, and the shell needs to interact with the agent harness (get context, abort, etc.).

### 2. every visible element maps to a placement or a shell built-in

the shell owns these things directly (they appear in `shell-app.ts`):
- the layout grid (sidebar + main column)
- the top bar with left/center/right slots
- the thread area (`<tame-thread>`)
- the composer (`<tame-composer>`)
- the markdown renderer (`<tame-markdown>`)
- the tool fallback view (`<tame-tool-fallback>`)

everything else must arrive via `web.register()` from the plugin that owns the concept. if you're adding a new piece of ui, ask: which plugin owns this concept? add the component there, then register it with a placement. if it's truly shell-level (e.g. a resize handle, a theme toggle, a keyboard shortcut handler), it belongs in `static/` and must not depend on any plugin.

### 3. custom element naming: `tame-{plugin}-thing`

all custom element tag names follow the pattern `tame-{plugin}-{thing}`. the plugin prefix is mandatory — it prevents collisions and makes ownership obvious in the dom:

```
tame-history-session-title  ✓
tame-ops-read                ✓
tame-session-title           ✗ (which plugin owns this?)
tame-read                    ✗ (too generic, will collide)
```

the shell's own components use bare `tame-{thing}` without a plugin prefix: `tame-shell`, `tame-sidebar`, `tame-thread`, `tame-message`, `tame-composer`, `tame-markdown`, `tame-tool-view`, `tame-tool-fallback`. these are reserved.

### 4. components and attributes above divs and classes

lit elements render into the light dom (`createRenderRoot() { return this; }`). this means the dom is flat — no shadow boundaries. that's intentional: it lets themes style everything from one place.

because there's no shadow dom, css scoping is done by **component tag name**, not by class:

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

### 5. never style inline, never use value-classes

no `style=` attributes in html. no class names that embed design values like `padding-4`, `margin-small`, `color-danger`, `text-lg`. these make themes powerless.

every component must use **css custom properties** exclusively for colors. a custom theme should be able to replace variables on `:root` and have the entire ui follow — not just swap a palette, but radically restyle. if a component uses a hardcoded color, it breaks this contract.

### 6. plugin-owned concepts stay in the plugin

if plugin-history owns the concept of "an agent has a title," then:
- the `tame-history-session-title` component lives in `plugin-history/web/`
- the css for it lives in `plugin-history/web/history.css`
- no other plugin references it, subscribes to its events, or calls its RPC methods

**the theme does not know about plugin components.** plugin components carry their own minimal structural css (display, basic layout) in their plugin's css file. themes provide variables and can optionally style plugin components by tag name — but the *default* styles for a plugin component must live in that plugin's css file, not in the theme. if a theme rule targets a plugin-specific tag name, that component's styles break when the plugin is disabled.

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
tame-my-plugin-thing { display: block; }
tame-my-plugin-thing .some-internal-class { color: var(--tame-text); }
tame-my-plugin-thing[data-loading] { opacity: 0.6; }

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

## reference

### placement locations

| location | where it renders |
|----------|-----------------|
| `panel:sidebar` | the sidebar panel |
| `topbar:left` | left side of the top bar |
| `topbar:center` | center of the top bar |
| `topbar:right` | right side of the top bar |

### theme variables

the default theme sets these on `:root`. all components (shell and plugin) must use them for colors — never hardcode a value:

```css
:root {
  --tame-bg: #111;
  --tame-surface: #1a1a2e;
  --tame-surface-alt: #0a0a14;
  --tame-border: #333;
  --tame-border-light: #444;
  --tame-text: #eee;
  --tame-text-secondary: #ccc;
  --tame-text-faint: #aaa;
  --tame-text-muted: #888;
  --tame-text-dim: #666;
  --tame-danger: #f66;
  --tame-success: #6f6;
}
```

### registration api

```ts
web.register(
  pluginId: string,
  components: { tag: string; src: string }[],
  placements: { location: string; tag: string; props?: Record<string, unknown> }[],
  css?: string,  // path to css file, served and injected automatically
): Promise<void>
```

### component contract

every plugin web component receives these properties from the shell:

| property | type | source |
|----------|------|--------|
| `controller` | `WebController` | set by the shell on all placed components |
| `result` | `string \| null` | set by `tame-tool-view` on tool view components |
| `isError` | `boolean` | set by `tame-tool-view` on tool view components |

plus any `props` passed in the placement or tool view descriptor.
