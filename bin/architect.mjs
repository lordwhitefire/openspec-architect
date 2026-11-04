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
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { STAMPED, MODEL } from "../lib/master.mjs"
import { bake } from "../lib/bake.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..")
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const VERSION = PKG.version

const IDENTITY_REL = ".opencode/agent/openspec-architect.md"
const BOUNDARIES_SKILL_REL = ".opencode/skills/architect-boundaries/SKILL.md"
const AGENT_DIR = ".opencode/agent"
const SKILLS_DIR = ".opencode/skills"
const COMMANDS_DIR = path.join(".opencode", "commands")
const DATA_DIR_NAME = "openspec"
const STAMP_REL = path.join(".opencode", ".architect-stamp.json")
const MANIFEST_REL = path.join(".opencode", ".architect-manifest.json")

const STAMP_RE = /^\s*generatedBy:\s*["']?([^"'\n]+)["']?\s*$/m
const NOTE_LINE = `<!-- generatedBy: "${VERSION}" -->\n`

const OURS = [
  { rel: IDENTITY_REL, kind: "stamped" },
  { rel: BOUNDARIES_SKILL_REL, kind: "stamped" },
  ...MODEL.map(([rel]) => ({ rel, kind: "model" })),
]

function usage() {
  console.log(`architect — the openspec-architect's program (v${VERSION})

  architect build             bake OUR half into this package (openspec's half is never baked)
  architect init [path]       install both halves into a workspace and write the manifest
  architect update [path]     refresh each half from its own source, reporting them separately
  architect check [path]      report drift per half
  architect --version         the program version, and what is installed here`)
}

function resolveWorkspace(arg) {
  return path.resolve(arg ?? process.cwd())
}

function stampMarkdown(template, version) {
  const m = template.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) throw new Error("template has no YAML frontmatter to stamp")
  const front = m[1]
  const body = template.slice(m[0].length)
  const lines = front.split("\n")
  const out = []
  for (const line of lines) {
    if (STAMP_RE.test(line)) continue
    out.push(line)
  }
  out.push(`  generatedBy: "${version}"`)
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

function modelContent(rel) {
  const m = MODEL.find(([r]) => r === rel)
  return m ? m[2] : null
}

function writeOurs(workspace, version) {
  fs.mkdirSync(path.join(workspace, AGENT_DIR), { recursive: true })
  fs.mkdirSync(path.join(workspace, SKILLS_DIR, "architect-boundaries"), { recursive: true })
  fs.mkdirSync(path.join(workspace, DATA_DIR_NAME), { recursive: true })
  const written = []
  for (const { rel, kind } of OURS) {
    const abs = assertPathWithin(workspace, path.join(workspace, rel))
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

function generateOpenSpecHalf(ws) {
  const version = openSpecOnPath()
  if (!version) return { found: false, version: null, files: [], error: "openspec not found on PATH" }
  fs.mkdirSync(path.join(ws, ".opencode"), { recursive: true })
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

// ─── manifest + stamp ─────────────────────────────────────────────────────────

function writeManifest(ws, ours, openspec) {
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
  fs.writeFileSync(assertPathWithin(ws, path.join(ws, MANIFEST_REL)), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

function readManifest(ws) {
  try { return JSON.parse(fs.readFileSync(path.join(ws, MANIFEST_REL), "utf8")) } catch { return null }
}

function writeStamp(ws) {
  const stamp = { engine: "openspec-architect", version: VERSION, installedAt: new Date().toISOString() }
  fs.writeFileSync(assertPathWithin(ws, path.join(ws, STAMP_REL)), `${JSON.stringify(stamp, null, 2)}\n`, "utf8")
  return stamp
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

function cmdInit(arg) {
  const ws = resolveWorkspace(arg)
  fs.mkdirSync(ws, { recursive: true })
  const ours = writeOurs(ws, VERSION)
  const openspec = generateOpenSpecHalf(ws)
  writeManifest(ws, ours, openspec)
  writeStamp(ws)

  console.log(`openspec-architect setup complete (v${VERSION}) — a composite engine`)
  console.log(`  workspace:  ${ws}`)
  console.log(`  our half:    ${ours.length} files (identity, architect-boundaries, ${MODEL.length} model files)`)
  if (openspec.found) {
    console.log(`  openspec:    v${openspec.version} — ${openspec.files.length} files generated by its own installer`)
  } else {
    console.log(`  openspec:    NOT FOUND — its half was NOT generated. Install openspec and run \`architect update\`.`)
  }
  console.log(`  manifest:    ${MANIFEST_REL} — every file recorded with its half`)
  console.log(`  stamp:       ${STAMP_REL} — v${VERSION}, written now`)
}

function cmdUpdate(arg) {
  const ws = resolveWorkspace(arg)
  const manifest = readManifest(ws)
  if (!manifest) {
    console.log(`No manifest in ${ws}. Run: architect init "${ws}"`)
    return
  }
  // ours: rewrite only when this program is NEWER than what is installed
  const installed = manifest.version
  const newer = installed !== VERSION
  if (newer) {
    const freshOurs = writeOurs(ws, VERSION)
    console.log(`ours:      ${installed} → ${VERSION} — ${freshOurs.length} files rewritten`)
  } else {
    console.log(`ours:      already at ${VERSION} — nothing to rewrite`)
  }
  // openspec's half: refresh from openspec itself, whatever version is now installed
  const openspec = generateOpenSpecHalf(ws)
  if (openspec.found) {
    const before = new Set(manifest.halves.openspec.files || [])
    const added = openspec.files.filter((f) => !before.has(f))
    const gone = [...before].filter((f) => !openspec.files.includes(f))
    console.log(`openspec:  v${manifest.halves.openspec.version || "?"} → v${openspec.version} — ${openspec.files.length} files`)
    if (added.length) console.log(`            added: ${added.join(", ")}`)
    if (gone.length) console.log(`            removed: ${gone.join(", ")}`)
    if (!added.length && !gone.length) console.log(`            no change`)
  } else {
    console.log(`openspec:  NOT FOUND on PATH — its half cannot be refreshed`)
  }
  const oursNow = OURS.map(({ rel, kind }) => ({ rel, half: "ours", kind }))
  writeManifest(ws, oursNow, openspec)
  writeStamp(ws)
}

function cmdCheck(arg) {
  const ws = resolveWorkspace(arg)
  const manifest = readManifest(ws)
  if (!manifest) {
    console.log(`NOT RUN — no manifest in ${ws}; this workspace was not installed by this engine`)
    process.exitCode = 2
    return
  }
  const problems = []
  // ours
  for (const rel of manifest.halves.ours.files) {
    const abs = path.join(ws, rel)
    if (!fs.existsSync(abs)) { problems.push(`ours: missing ${rel}`); continue }
    if (rel === MANIFEST_REL || rel === STAMP_REL) continue
    const expected = rel === IDENTITY_REL || rel === BOUNDARIES_SKILL_REL
      ? stampMarkdown(rel === IDENTITY_REL ? STAMPED.IDENTITY : STAMPED.BOUNDARIES_SKILL, manifest.version)
      : (() => { const m = MODEL.find(([r]) => r === rel); return m ? (m[1] === "base64" ? Buffer.from(m[2], "base64") : stampPlain(m[2])) : null })()
    if (expected === null) continue
    const actual = fs.readFileSync(abs)
    if (!actual.equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected))) {
      problems.push(`ours: drifted ${rel}`)
    }
  }
  // openspec's half
  const ops = manifest.halves.openspec
  if (!ops.found) {
    console.log(`openspec: absent at install — its half was never generated here`)
  } else {
    const now = openSpecOnPath()
    if (!now) problems.push(`openspec: was v${ops.version} at install, but openspec is not on PATH now`)
    else if (now !== ops.version) problems.push(`openspec: installed against v${ops.version}, PATH now has v${now} — run architect update`)
    for (const rel of ops.files) {
      if (!fs.existsSync(path.join(ws, rel))) problems.push(`openspec: missing ${rel}`)
    }
    console.log(`openspec: v${ops.version}, ${ops.files.length} files recorded`)
  }
  if (problems.length) {
    console.log(`DRIFT — ${problems.length} problem(s)`)
    for (const p of problems) console.log(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${ws} is in sync with both halves (v${VERSION})`)
  }
}

// ─── entry ────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)
const opts = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--kit") { opts.kit = rest[i + 1]; i++ }
}
try {
  switch (cmd) {
    case "build": await cmdBuild(opts); break
    case "init": cmdInit(rest[0]); break
    case "update": cmdUpdate(rest[0]); break
    case "check": cmdCheck(rest[0]); break
    case "--version":
    case "-v": {
      const here = (() => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), STAMP_REL), "utf8")) } catch { return null } })()
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
