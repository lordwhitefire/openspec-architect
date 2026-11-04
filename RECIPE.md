# BUILD — how to build this engine

For an agent to follow **by hand**. No function runs except where this file says so explicitly. Every path
is relative to this file's folder, so a fresh clone of agentic-frameworks reproduces this engine. If you
find an absolute path in this file, it is a bug — fix it, do not use it.

## What this kit is

A workspace of materials for a **composite** agent. It is never run. The engine is assembled from it, by
an agent, following this recipe.

## The two halves — the design

| half | what it is | where it comes from at install |
|---|---|---|
| **ours** | the identity, the `architect-boundaries` skill (which openspec does not provide), the program, the mental model | **our package** `@lordwhiteire/openspec-architect` |
| **openspec's** | openspec's skills and commands — "the everything" | **openspec itself**: the Fission-AI/OpenSpec npm package installed on that machine, invoked by our program at install time |

**OpenSpec's half is never baked into our package.** It is generated at install by running
`openspec init <workspace> --tools opencode --force`, and the program **measures** what that run added (the
before/after file sets of the whole workspace) rather than assuming a list. A machine with a newer openspec
gets that version's set; ours never goes stale against theirs.

**The manifest keeps the halves distinguishable.** `init` writes
`<workspace>/.opencode/.architect-manifest.json` recording every installed file, its half (`ours` or
`openspec`), openspec's version and its generated file list. `check` and `update` read it, so a change is
always attributed to one half.

## The materials, by name

| material | where it is |
|---|---|
| identity | `live-global/agent/openspec-architect.md` |
| our own skill | `.opencode/skills/architect-boundaries/` |
| our mental model | `mental-models/architect/` (100 files — item files, extraction logs, build reports, sources-text) |
| the program | `engine/bin/architect.mjs`, `engine/lib/bake.mjs` |
| reference library | `intent/knowledge-base/` (144 MB — **stays here**, see below) |

## How to build

1. Create the engine folder outside agentic-frameworks, named `openspec-architect`.
2. **Bump the patch version in `package.json`** — every change gets its own version. It is the only place
   the version is written.
3. Copy `live-global/agent/openspec-architect.md` → `payload/agent/`.
4. Copy `.opencode/skills/architect-boundaries/` → `payload/skills/`.
5. Copy the runtime: `engine/bin/architect.mjs` → `bin/`, `engine/lib/bake.mjs` → `lib/`. **Every file in
   both** — the program imports `../lib/master.mjs` **and** `../lib/bake.mjs`.
6. Assemble the payload into `lib/master.mjs`, **our half only**: `STAMPED` with `IDENTITY` and
   `BOUNDARIES_SKILL`, and `MODEL` as `[rel, "text"|"base64", content]` for every model file, its rel
   `.mental-model/architect/<path>`. Text entries carry an appended
   `<!-- generatedBy: "<version>" -->` note; binary entries are byte for byte.
   **No openspec skill or command may appear in this file** — `architect build` refuses if one does.
7. Write `package.json`: `@lordwhiteire/openspec-architect`, `private: false`, `bin` `architect`, `main`
   `lib/master.mjs`, `files` = `bin/`, `lib/`, `payload/`, `publishConfig.registry` = GitHub Packages,
   `repository`, `license: UNLICENSED`.
8. Write `README.md` naming the composite design, the manifest, what is not shipped (the 144 MB library),
   the stamp, and the missing-openspec behaviour.
9. Add the install stamp: `init` writes `<workspace>/.opencode/.architect-stamp.json` =
   `{engine, version, installedAt}`; `--version` prints it beside the program version.
10. Copy `.github/workflows/publish.yml` in — `v*` tag or `workflow_dispatch`, `permissions: packages:
    write`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
11. `git init`, commit on **`main`**, tag `v1.0.0`.

## What must NOT go in

`intent/knowledge-base/` (144 MB of reference books — the kit's own; `check` reports it as not shipped
rather than pretending), openspec's skills and commands, evidence and run outputs, `.git`, or any absolute
path.

## How this is proved

- no step names a location outside the kit (verified: no absolute path appears);
- this file contains no runnable code;
- reading it on a fresh clone reproduces the same file list;
- the kit's hash before and after the build differs only by this file and `engine/`;
- `init` on a machine with openspec produces **ours + exactly what that openspec generates**, and the
  manifest records both halves with their counts;
- `init` with openspec absent still installs our half, prints a named warning, records the gap in the
  manifest, and `check` reports it;
- the stamp is engine-written, and `--version` prints it.
