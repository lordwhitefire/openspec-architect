#!/usr/bin/env node
// architect — the openspec-architect's program.
//
// A composite engine. It installs TWO halves and keeps them distinguishable:
//
//   ours      — the identity, the architect-boundaries skill, this program, the mental model.
//               Baked into this package by `build`, from the kit.
//   openspec's — openspec's skills and commands. NEVER baked here. They come from the
//               openspec installation on this machine, generated at install time by running
//               openspec's own installer. A machine with a newer openspec gets that version's
//               set; ours can never go stale against theirs.
//
// The manifest (.opencode/.architect-manifest.json) records every installed file and which half
// it came from. `check` and `update` read it, so a change is always attributed.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { STAMPED, MODEL } from "../lib/master.mjs"
import { bake } from "../lib/bake.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..")
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const VERSION = PKG.version

const IDENTITY_REL = "agent/openspec-architect.md"
const BOUNDARIES_SKILL_REL = "skills/architect-boundaries/SKILL.md"
const AGENT_DIR = "agent"
const SKILLS_DIR = "skills"
const COMMANDS_DIR = "commands"
const DATA_DIR_NAME = "openspec"
const STAMP_FILE = ".architect-stamp.json"
const MANIFEST_FILE = ".architect-manifest.json"

const STAMP_RE = /^\s*generatedBy:\s*["']?([^"'\n]+)["']?\s*$/m
const NOTE_LINE = `<!-- generatedBy: "${VERSION}" -->\n`

const OURS = [
  { rel: IDENTITY_REL, kind: "stamped" },
  { rel: BOUNDARIES_SKILL_REL, kind: "stamped" },
  ...MODEL.map(([rel]) => ({ rel, kind: "model" })),
]

function usage() {
  console.log(`architect — the openspec-architect's program (v${VERSION})

  architect build                    bake OUR half into this package (openspec's half is never baked)
  architect init [path]              install both halves into a workspace and write the manifest (project)
  architect init --global            write into ~/.config/opencode (global, every project)
  architect update [path]            refresh each half from its own source, reporting them separately
  architect update --global          same, for the global install
  architect check [path]             report drift per half
  architect check --global           same, for the global install
  architect --version                the program version, and what is installed here
`)

  // File layout — exactly what each install scope writes.
  console.log(`
  File layout

  project — architect init /path/to/project
    /path/to/project/
      .opencode/
        agent/openspec-architect.md
        skills/<name>/SKILL.md
        commands/
        .mental-model/architect/
        .architect-stamp.json
      openspec/    (data workspace, empty)

  global — architect init --global
    ~/.config/opencode/
      agent/openspec-architect.md
      skills/<name>/SKILL.md
      commands/
      .mental-model/architect/
      .architect-stamp.json
      (no data workspace)`)
}

/** Resolve the install target from args and flags. */
function resolveTarget(arg, opts) {
  if (opts.global) {
    const configRoot = path.join(os.homedir(), ".config", "opencode")
    return { configRoot, projectRoot: null, scope: "global", display: "~/.config/opencode" }
  }
  const projectRoot = path.resolve(arg ?? process.cwd())
  const configRoot = path.join(projectRoot, ".opencode")
  return { configRoot, projectRoot, scope: "project", display: projectRoot }
}

function stampMarkdown(template, version) {
  const m = template.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) throw new Error("template has no YAML frontmatter to stamp")
  const body = template.slice(m[0].length)
  const lines = m[1].split(/\r?\n/)

  // Build the frontmatter with exactly one generatedBy, under a top-level metadata: block.
  // Rules that matter:
  //   - drop generatedBy at ANY indentation, so a stamp cannot hide inside permission: or
  //     survive from an older metadata block;
  //   - keep the first metadata: block and drop any later one WITH its children, otherwise
  //     those children merge into the first block and duplicate its keys;
  //   - insert the single stamp once, after the metadata: line.
  const out = []
  let metadataAt = -1
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*generatedBy\s*:/.test(line)) { i++; continue }
    if (/^metadata\s*:\s*$/.test(line)) {
      if (metadataAt !== -1) {
        i++
        while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === "")) i++
        continue
      }
      out.push("metadata:")
      metadataAt = out.length - 1
      i++
      continue
    }
    out.push(line)
    i++
  }

  if (metadataAt === -1) {
    out.push("metadata:")
    metadataAt = out.length - 1
  }
  out.splice(metadataAt + 1, 0, `  generatedBy: "${version}"`)

  return `---\n${out.join("\n")}\n---\n${body}`
}

function stampPlain(content) {
  if (STAMP_RE.test(content)) return content
  return (content.endsWith("\n") ? content : content + "\n") + NOTE_LINE
}

function contentFor(rel, version) {
  if (rel === IDENTITY_REL) return stampMarkdown(STAMPED.IDENTITY, version)
  if (rel === BOUNDARIES_SKILL_REL) return stampMarkdown(STAMPED.BOUNDARIES_SKILL, version)
  const model = MODEL.find(([r]) => r === rel)
  if (model) {
    const [, kind, content] = model
    if (kind === "base64") return Buffer.from(content, "base64")
    return stampPlain(content)
  }
  throw new Error(`no template for ${rel}`)
}

function assertPathWithin(baseDir, target) {
  const base = path.resolve(baseDir)
  const abs = path.resolve(target)
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error(`refusing to write outside the workspace: ${target}`)
  }
  return abs
}

function writeOurs(target, version) {
  fs.mkdirSync(path.join(target.configRoot, AGENT_DIR), { recursive: true })
  fs.mkdirSync(path.join(target.configRoot, SKILLS_DIR, "architect-boundaries"), { recursive: true })
  if (target.projectRoot) {
    fs.mkdirSync(path.join(target.projectRoot, DATA_DIR_NAME), { recursive: true })
  }
  const written = []
  for (const { rel, kind } of OURS) {
    const abs = assertPathWithin(target.configRoot, path.join(target.configRoot, rel))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const content = contentFor(rel, version)
    fs.writeFileSync(abs, content)
    written.push({ rel, half: "ours", kind })
  }
  return written
}

// ─── OpenSpec's half ──────────────────────────────────────────────────────────
//
// Generated, never baked. We run openspec's own installer into the workspace and MEASURE what it
// added — the before/after file sets are the manifest's record of that half, so nothing is assumed
// about which version is installed or what it writes.

function openSpecOnPath() {
  const r = spawnSync("openspec", ["--version"], { encoding: "utf8" })
  if (r.error || r.status !== 0) return null
  return (r.stdout || "").trim() || "unknown"
}

// The whole workspace, not just .opencode/: openspec also writes openspec/config.yaml at the
// workspace root, and a half that is not recorded cannot be checked or updated.
function snapshotWorkspace(ws) {
  const out = new Set()
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.add(path.relative(ws, p))
    }
  }
  walk(ws)
  return out
}

function listTree(root) {
  const out = []
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(path.relative(root, p))
    }
  }
  walk(root)
  return out.sort()
}

function copyTreeInto(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyTreeInto(s, d)
    else fs.copyFileSync(s, d)
  }
}

function generateOpenSpecHalf(target) {
  const version = openSpecOnPath()
  if (!version) return { found: false, version: null, files: [], error: "openspec not found on PATH" }

  // Project scope: openspec writes <project>/.opencode/* — exactly where OpenCode reads it.
  if (target.projectRoot) {
    const ws = target.projectRoot
    const before = snapshotWorkspace(ws)
    const r = spawnSync("openspec", ["init", ws, "--tools", "opencode", "--force"], {
      encoding: "utf8", timeout: 120000,
    })
    if (r.error || r.status !== 0) {
      return { found: true, version, files: [], error: `openspec init failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}` }
    }
    const after = snapshotWorkspace(ws)
    const files = [...after].filter((f) => !before.has(f)).sort()
    return { found: true, version, files, error: null }
  }

  // Global scope: openspec always writes <ws>/.opencode. Running it in ~/.config/opencode would
  // nest the config root as ~/.config/opencode/.opencode, which OpenCode never reads. Run it in a
  // scratch workspace and lift its .opencode/* into the config root at the level OpenCode scans.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-architect-"))
  try {
    const r = spawnSync("openspec", ["init", tmp, "--tools", "opencode", "--force"], {
      encoding: "utf8", timeout: 120000,
    })
    if (r.error || r.status !== 0) {
      return { found: true, version, files: [], error: `openspec init failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}` }
    }
    const produced = path.join(tmp, ".opencode")
    if (!fs.existsSync(produced)) return { found: true, version, files: [], error: null }
    const files = listTree(produced)
    copyTreeInto(produced, target.configRoot)
    return { found: true, version, files, error: null }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Older global installs ran openspec inside the config root and recorded .opencode/<...> paths.
// Remove exactly those recorded files, then prune the empty legacy tree. Unrecorded files are
// left alone rather than deleted blindly.
function pruneLegacyNested(target, manifest) {
  if (target.scope !== "global" || !manifest) return
  const old = manifest.halves?.openspec?.files || []
  const nested = old.filter((rel) => rel.startsWith(".opencode/"))
  if (!nested.length) return
  const nestedRoot = path.join(target.configRoot, ".opencode")
  for (const rel of nested) {
    const abs = assertPathWithin(target.configRoot, path.join(target.configRoot, rel))
    try { fs.unlinkSync(abs) } catch {}
  }
  // Walk up from every removed file to .opencode/, then prune deepest-first so empty
  // intermediate directories (skills/, commands/) go too.
  const dirs = new Set()
  for (const rel of nested) {
    let d = path.dirname(path.join(target.configRoot, rel))
    while (d === nestedRoot || d.startsWith(`${nestedRoot}${path.sep}`)) {
      dirs.add(d)
      if (d === nestedRoot) break
      d = path.dirname(d)
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(d) } catch {}
  }
  if (!fs.existsSync(nestedRoot)) {
    console.log("migrated:      removed the legacy .opencode/.opencode nesting")
  } else {
    console.log("warning:       legacy .opencode/ still holds unrecorded files — left in place")
  }
}

// ─── manifest + stamp ─────────────────────────────────────────────────────────

function writeManifest(target, ours, openspec) {
  const manifest = {
    engine: "openspec-architect",
    version: VERSION,
    installedAt: new Date().toISOString(),
    halves: {
      ours: { source: `@lordwhitefire/openspec-architect@${VERSION}`, files: ours.map((f) => f.rel) },
      openspec: {
        source: openspec.found ? `openspec@${openspec.version}` : null,
        version: openspec.version,
        found: openspec.found,
        files: openspec.files,
        error: openspec.error,
      },
    },
  }
  fs.writeFileSync(assertPathWithin(target.configRoot, path.join(target.configRoot, MANIFEST_FILE)), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

function readManifest(target) {
  try { return JSON.parse(fs.readFileSync(path.join(target.configRoot, MANIFEST_FILE), "utf8")) } catch { return null }
}

function writeStamp(target) {
  const stamp = { engine: "openspec-architect", version: VERSION, installedAt: new Date().toISOString() }
  fs.writeFileSync(assertPathWithin(target.configRoot, path.join(target.configRoot, STAMP_FILE)), `${JSON.stringify(stamp, null, 2)}\n`, "utf8")
  return stamp
}

function readStamp(target) {
  try { return JSON.parse(fs.readFileSync(path.join(target.configRoot, STAMP_FILE), "utf8")) } catch { return null }
}

// ─── verbs ────────────────────────────────────────────────────────────────────

async function cmdBuild(opts) {
  const kit = opts.kit || process.env.ARCHITECT_KIT
  if (!kit) {
    throw new Error("build needs the kit: `architect build --kit <path>` or ARCHITECT_KIT. No default path is baked in.")
  }
  const baked = bake(kit)
  if (baked.MODEL.some(([rel]) => rel.startsWith(".opencode/skills/openspec-"))) {
    throw new Error("refusing to build: an openspec skill is in the payload — openspec's half is never baked into ours")
  }
  // bump the patch version: every change gets its own, so a published version says what did what
  const parts = VERSION.split(".").map(Number)
  while (parts.length < 3) parts.push(0)
  parts[parts.length - 1] += 1
  const next = parts.join(".")
  const pkg = { ...PKG, version: next }
  fs.writeFileSync(path.join(ROOT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8")
  // write the payload, our half only
  const js = (v) => JSON.stringify(v)
  const out = [
    "// lib/master.mjs — OUR half, baked from the kit by `architect build --kit <path>`.",
    `// Version ${next}. openspec's half is NOT here: it is generated at install from the machine's openspec.`,
    "//   STAMPED — identity + our own architect-boundaries skill (which openspec does not provide).",
    "//   MODEL — our mental model, file for file; text entries carry an appended generatedBy note.",
    "",
    "export const STAMPED = {",
    `  IDENTITY: ${js(baked.STAMPED.IDENTITY)},`,
    `  BOUNDARIES_SKILL: ${js(baked.STAMPED.BOUNDARIES_SKILL)},`,
    "}",
    "",
    "export const MODEL = [",
    baked.MODEL.map(([rel, kind, content]) => `  [${js(rel)}, ${js(kind)}, ${js(content)}]`).join(",\n") + ",",
    "]",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(ROOT, "lib", "master.mjs"), out, "utf8")
  console.log(`built our half at ${next}: ${baked.files.length} files, ${Math.round(baked.bytes / 1024)} KB`)
  console.log(`openspec's half is not baked — it is generated at install from the machine's openspec`)
}

function cmdInit(arg, opts) {
  const target = resolveTarget(arg, opts)
  pruneLegacyNested(target, readManifest(target))
  const ours = writeOurs(target, VERSION)
  const openspec = generateOpenSpecHalf(target)
  writeManifest(target, ours, openspec)
  writeStamp(target)

  console.log(`openspec-architect setup complete (v${VERSION}) — ${target.scope}-scoped composite engine`)
  console.log(`  workspace:    ${target.display}`)
  console.log(`  our half:      ${ours.length} files (identity, architect-boundaries, ${MODEL.length} model files)`)
  if (openspec.found) {
    console.log(`  openspec:      v${openspec.version} — ${openspec.files.length} files generated by its own installer`)
  } else {
    console.log(`  openspec:      NOT FOUND — its half was NOT generated. Install openspec and run \`architect update\`.`)
  }
  const manifestShown = target.scope === "global" ? `~/.config/opencode/${MANIFEST_FILE}` : `.opencode/${MANIFEST_FILE}`
  const stampShown = target.scope === "global" ? `~/.config/opencode/${STAMP_FILE}` : `.opencode/${STAMP_FILE}`
  console.log(`  manifest:      ${manifestShown} — every file recorded with its half`)
  console.log(`  stamp:         ${stampShown} — v${VERSION}, written now`)
}

function cmdUpdate(arg, opts) {
  const target = resolveTarget(arg, opts)
  const manifest = readManifest(target)
  if (!manifest) {
    console.log(`No manifest in ${target.display}. Run: architect init${opts.global ? " --global" : ` "${target.projectRoot}"`}`)
    return
  }
  pruneLegacyNested(target, manifest)
  // ours: rewrite only when this program is NEWER than what is installed
  const installed = manifest.version
  const newer = installed !== VERSION
  if (newer) {
    const freshOurs = writeOurs(target, VERSION)
    console.log(`ours:        ${installed} → ${VERSION} — ${freshOurs.length} files rewritten`)
  } else {
    console.log(`ours:        already at ${VERSION} — nothing to rewrite`)
  }
  // openspec's half: refresh from openspec itself, whatever version is now installed
  const openspec = generateOpenSpecHalf(target)
  if (openspec.found) {
    const before = new Set(manifest.halves.openspec.files || [])
    const added = openspec.files.filter((f) => !before.has(f))
    const gone = [...before].filter((f) => !openspec.files.includes(f))
    console.log(`openspec:    v${manifest.halves.openspec.version || "?"} → v${openspec.version} — ${openspec.files.length} files`)
    if (added.length) console.log(`              added: ${added.join(", ")}`)
    if (gone.length) console.log(`              removed: ${gone.join(", ")}`)
    if (!added.length && !gone.length) console.log(`              no change`)
  } else {
    console.log(`openspec:    NOT FOUND on PATH — its half cannot be refreshed`)
  }
  const oursNow = OURS.map(({ rel, kind }) => ({ rel, half: "ours", kind }))
  writeManifest(target, oursNow, openspec)
  writeStamp(target)
}

function cmdCheck(arg, opts) {
  const target = resolveTarget(arg, opts)
  const manifest = readManifest(target)
  if (!manifest) {
    console.log(`NOT RUN — no manifest in ${target.display}; this workspace was not installed by this engine`)
    process.exitCode = 2
    return
  }
  const problems = []
  // ours — these are relative to configRoot (they have .opencode/ prefix)
  for (const rel of manifest.halves.ours.files) {
    const abs = path.join(target.configRoot, rel)
    if (!fs.existsSync(abs)) { problems.push(`ours: missing ${rel}`); continue }
    if (rel === MANIFEST_FILE || rel === STAMP_FILE) continue
    const expected = rel === IDENTITY_REL || rel === BOUNDARIES_SKILL_REL
      ? stampMarkdown(rel === IDENTITY_REL ? STAMPED.IDENTITY : STAMPED.BOUNDARIES_SKILL, manifest.version)
      : (() => { const m = MODEL.find(([r]) => r === rel); return m ? (m[1] === "base64" ? Buffer.from(m[2], "base64") : stampPlain(m[2])) : null })()
    if (expected === null) continue
    const actual = fs.readFileSync(abs)
    if (!actual.equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected))) {
      problems.push(`ours: drifted ${rel}`)
    }
  }
  // openspec's half — these are relative to the workspace root (projectRoot for project, configRoot for global)
  const ops = manifest.halves.openspec
  const openspecBase = target.projectRoot || target.configRoot
  if (!ops.found) {
    console.log(`openspec:    absent at install — its half was never generated here`)
  } else {
    const now = openSpecOnPath()
    if (!now) problems.push(`openspec: was v${ops.version} at install, but openspec is not on PATH now`)
    else if (now !== ops.version) problems.push(`openspec: installed against v${ops.version}, PATH now has v${now} — run architect update`)
    for (const rel of ops.files) {
      if (!fs.existsSync(path.join(openspecBase, rel))) problems.push(`openspec: missing ${rel}`)
    }
    console.log(`openspec:    v${ops.version}, ${ops.files.length} files recorded`)
  }
  if (problems.length) {
    console.log(`DRIFT — ${problems.length} problem(s)`)
    for (const p of problems) console.log(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${target.display} is in sync with both halves (v${VERSION})`)
  }
}

// ─── entry ────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)
const opts = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--kit") { opts.kit = rest[i + 1]; i++ }
  if (rest[i] === "--global") { opts.global = true }
}
try {
  switch (cmd) {
    case "build": await cmdBuild(opts); break
    case "init": cmdInit(rest[0], opts); break
    case "update": cmdUpdate(rest[0], opts); break
    case "check": cmdCheck(rest[0], opts); break
    case "--version":
    case "-v": {
      const here = readStamp({ configRoot: process.cwd() })
      console.log(VERSION)
      if (here) console.log(`installed here: v${here.version} (${here.installedAt})`)
      break
    }
    default: usage()
  }
} catch (err) {
  console.error(`FAILED — ${cmd}: ${err.message}`)
  process.exit(2)
}