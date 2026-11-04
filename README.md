# openspec-architect

The openspec-architect. A **composite** engine with two clearly separated halves.

- **Ours** — the identity, the `architect-boundaries` skill (which openspec does not provide), this
  program, and the 100-file mental model. Ships in this package, from our private repo.
- **OpenSpec's** — openspec's skills and commands. **Never in this package.** Generated at install by
  running the openspec installed on this machine, so the set follows that machine's openspec version
  (this machine's 1.8.0 generates 6 skills + 6 commands; a newer openspec generates its own set).

`.opencode/.architect-manifest.json` records every installed file and which half it came from, so
`architect check` and `architect update` report the halves separately — a change is always attributed.

- **version 1.0.0** — published 2026-11-03.
- **Not shipped, and reported as not shipped:** the 144 MB reference library (`intent/knowledge-base`)
  stays in the kit. `architect check` says so rather than pretending it is present.
- **The stamp:** `init` writes `.opencode/.architect-stamp.json` (engine, version, install date);
  `--version` prints it beside the program version.
- **If openspec is not installed:** the agent still installs, prints a named warning, records the gap in
  the manifest, and `check` reports it.
