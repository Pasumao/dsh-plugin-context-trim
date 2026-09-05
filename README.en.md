<p align="center">
  <img src="docs/banner.svg" alt="dsh-plugin-context-trim banner" width="100%">
</p>

# dsh-plugin-context-trim

![npm version](https://img.shields.io/npm/v/dsh-plugin-context-trim)
![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-context-trim)
![License](https://img.shields.io/github/license/Pasumao/dsh-plugin-context-trim)
![Stars](https://img.shields.io/github/stars/Pasumao/dsh-plugin-context-trim?style=social)
![AI Assisted](https://img.shields.io/badge/AI-Assisted-8A2BE2)

[**中文**](./README.md) | [English](./README.en.md)

**The first per-session context-injection gate in the DeepSeek Harness ecosystem**: a NoneBot
task has no use for the dsh plugin-dev knowledge base; a pure chat session has no use for
image tools. This plugin lets you decide **per session** which skills, tools and
system-prompt sections reach the model — the rest stay invisible in that session only.

`3 shadow channels (skill / tool / section) · 5 local routes · 0 deps · 0 config · no core edits`

After installing you will see:

- A **funnel button ("注入" / Inject)** at the bottom-left of the session input bar — green dot
  = full injection, orange = trimmed, gray lock = locked
- A plugin-grouped tree where you can uncheck whole plugins (e.g. all knowledge-base skills);
  the model simply never sees them again
- Thousands of irrelevant schema/skill-description characters saved per step (live estimate
  in the modal footer)
- Zero impact on other sessions; automatic unwind when the agent is destroyed; one click
  back to full injection

## Install

```powershell
dsh plugin --profile web add dsh-plugin-context-trim
```

Or from GitHub:

```powershell
dsh plugin --profile web add github:Pasumao/dsh-plugin-context-trim
```

From source (development / debugging):

```bash
git clone https://github.com/Pasumao/dsh-plugin-context-trim.git
cd dsh-plugin-context-trim
npm install
# mount into the profile via link: (same mechanism as dsh.profile.bundles)
```

Restart dsh (launcher) and refresh the browser. The package ships its own `cordis.patch.yml`
and mounts through `dsh.profile.bundles` — no manual configuration of any kind. Host-side
changes need a dsh restart; client-side changes need a browser reload.

## Quick start

1. Open a session and click the **funnel button** — the tree lists every plugin that can
   influence the model's context;
2. Expand a group you don't want and **batch-uncheck** it with the group checkbox
   (e.g. the whole `dsh-plugin-nonebot-kb` group); the footer shows "trimmed N items,
   roughly X fewer chars per step";
3. Hit **Apply** — effective immediately in this session. **Save as default** stores the
   selection as the workspace template for every new session.

## Features

| Feature | Description |
|---|---|
| Per-session skill trimming | A same-name shadow skill with `modelInvocable:false` masks the original: gone from `<available_skills>`, and loading by name via the `skill` tool is refused |
| Per-session tool / MCP trimming | `tools.restrict({ deny })` hides tools one by one (covers MCP tools); unknown names are skipped automatically against races |
| Per-session prompt-section trimming | Same-name empty section/context shadows dropped by the renderer; sections not attributable to a plugin are locked by default |
| Tree-table modal | Plugin-grouped, tri-state checkboxes, group rows batch-toggle children skipping locked rows, theme-adaptive type badges, draggable & resizable |
| Critical-capability guard | File read/write, console and the `skill` tool carry a ⚠ badge; unchecking asks for confirmation, restoring doesn't |
| Session lock & force change | Once a session has a persisted step it is locked; "Force change" unlocks with hot effect on the next step |
| New-session default template | "Save as default / Reset" manage a workspace-level template applied to every new session |
| Status dot | Green = full / orange = trimmed / gray lock = locked; the button lights up in the brand accent color when unlocked |

## Configuration

**This plugin is zero-config**: install and use — no keys, no accounts, no required fields.
Selections persist automatically to `$DSH_HOME/dsh-plugin-context-trim.json`
(UTF-8 without BOM, atomic writes); manual editing is normally unnecessary. The HTTP routes
listen on the local loopback only and serve only the local GUI.

## How it works

<details>
<summary>Shadow-entry mechanism (why other sessions are never affected)</summary>

For each unchecked entry the plugin stacks a **same-name shadow** in the agent's own scope
layer, masking the global original — the original registrations are never modified:

| Channel | Mechanism | Effect |
|---|---|---|
| skill | `agent.ctx.skills.register(shadow, modelInvocable:false)` | Dropped from the catalog; name loading refused |
| tool / MCP | `agent.ctx.tools.restrict({ deny:[name] })` per tool | Hidden from model requests |
| prompt section | `agent.ctx.systemPrompt.section(same name, text:'')` | Empty sections dropped by the renderer |

Registrations land in the agent scope layer via `agent.ctx.inject([service], …)` child
plugin fibers (cordis guards agent ctx service properties behind the inject whitelist);
when the agent is destroyed the cordis effects unwind automatically — zero residue, zero
cross-session impact. Re-apply disposes the previous generation first (generation token,
idempotent); shadow skills are pre-fetched with their **complete definition** (body
included) from the global view, overriding only `modelInvocable`.

</details>

## Compatibility

- Targets dsh `0.1.2-rc.1` (official documented seams only: `ctx.skills` /
  `ctx.tools.restrict` / `ctx.systemPrompt` / `ctx.webServer` / the slot system)
- Pure plugin (host + client bundle), no core-package edits; Node ≥ 18, zero runtime deps

## Safety & limitations

- Mid-session trimming does not retract older catalog messages from history (the official
  semantics replace the catalog forward only); the model follows the latest
- Tools added by an MCP server after a reconnect are not in the existing deny list
  (low-risk race)
- Scoped tools from dynamic cordis plugins (`cordis_run`) bypass restrict
- Plugins that do not label `provider` have their skills grouped under "runtime skills"
- Shadow install callbacks settle at microtask level, in practice well before the first
  model pre-step
- HTTP routes serve only the local GUI (loopback check), never exposed publicly

## FAQ

**Q: Will content already generated by a gated plugin disappear?**
No. Gating only affects future context assembly; history is preserved as-is.

**Q: Why is a new session green while started sessions are locked?**
Green = identical to the default full injection. Once a session has a persisted model step
it is locked to avoid silent mid-run changes; use "Force change" if you really need to —
hot effect on the next step.

**Q: Can all new sessions start without the KB skills?**
Configure the trimming in any session and hit "Save as default" — every new session in that
workspace applies it automatically.

## Related plugins

Part of the **Pasumao dsh plugin ecosystem**:

| Plugin (npm) | GitHub | Description |
|---|---|---|
| [dsh-notify](https://www.npmjs.com/package/dsh-notify) | [GitHub](https://github.com/Pasumao/dsh-plugin-notify) | Native Windows notifications + tray icon |
| [dsh-plugin-choice-refresh](https://www.npmjs.com/package/dsh-plugin-choice-refresh) | [GitHub](https://github.com/Pasumao/dsh-plugin-choice-refresh) | Choice enhancements: regenerate / more options |
| [dsh-plugin-dev-kb](https://www.npmjs.com/package/dsh-plugin-dev-kb) | [GitHub](https://github.com/Pasumao/dsh-plugin-dev-kb) | dsh plugin-dev knowledge base (full docs mirror + skill) |
| [dsh-plugin-image-tools](https://www.npmjs.com/package/dsh-plugin-image-tools) | [GitHub](https://github.com/Pasumao/dsh-plugin-image-tools) | Image choice cards / inline images / blind-model image saving |
| [dsh-plugin-table-zoom](https://www.npmjs.com/package/dsh-plugin-table-zoom) | [GitHub](https://github.com/Pasumao/dsh-plugin-table-zoom) | Floating viewer for long chat tables |
| [dsh-plugin-windows-guard](https://www.npmjs.com/package/dsh-plugin-windows-guard) | [GitHub](https://github.com/Pasumao/dsh-plugin-windows-guard) | Windows pitfall guard: rules + encoding diagnostics |
| [dsh-plugin-workbench](https://www.npmjs.com/package/dsh-plugin-workbench) | [GitHub](https://github.com/Pasumao/dsh-plugin-workbench) | VS Code-style workspace file explorer |

> See [Pasumao · dsh plugins](https://github.com/Pasumao) for the rest of the series;
> stars are appreciated.

## AI disclosure

Code and docs were AI-assisted (DeepSeek Harness) with human review and self-check
verification (`npm run selfcheck`: package consistency / optimistic-lock persistence /
shadow-apply idempotency / attribution assertions).

## License

[MIT](./LICENSE)
