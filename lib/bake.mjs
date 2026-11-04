// bake — builds OUR half only, from the kit.
//
// Source of truth is the kit, passed explicitly (`architect build --kit <path>`, or ARCHITECT_KIT).
// No default path, no machine-wide config root: an absolute path in this file would break the moment
// the kit is cloned elsewhere, which is the whole reason the kit is the source.
//
// Reads, from the kit:
//   live-global/agent/openspec-architect.md        -> STAMPED.IDENTITY
//   .opencode/skills/architect-boundaries/SKILL.md -> STAMPED.BOUNDARIES_SKILL
//   mental-models/architect/**                     -> MODEL
//
// It never reads openspec's installation and never bakes openspec's skills: openspec's half is generated
// at install time from the machine's openspec, and baking it would freeze a copy that goes stale.
import fs from "node:fs"
import path from "node:path"

const IDENTITY_REL = "live-global/agent/openspec-architect.md"
const BOUNDARIES_REL = ".opencode/skills/architect-boundaries/SKILL.md"
const MODEL_SRC = "mental-models/architect"
const MODEL_DEST = ".mental-model/architect"

function isText(buf) {
  try { buf.toString("utf8"); return true } catch { return false }
}

/**
 * Bake our half out of a kit root. Returns { STAMPED, MODEL, files, bytes }.
 * Throws with a hint naming the missing material — it never guesses.
 */
export function bake(kitRoot) {
  const root = path.resolve(kitRoot)
  if (!fs.existsSync(root)) {
    throw Object.assign(new Error(`kit not found: ${root}`), { hint: "pass --kit <path> or set ARCHITECT_KIT" })
  }
  const identityPath = path.join(root, IDENTITY_REL)
  if (!fs.existsSync(identityPath)) {
    throw Object.assign(new Error(`the kit has no identity at ${IDENTITY_REL}`), {
      hint: "copy the live identity into the kit first — the kit holds everything the build needs",
    })
  }
  const boundariesPath = path.join(root, BOUNDARIES_REL)
  if (!fs.existsSync(boundariesPath)) {
    throw Object.assign(new Error(`the kit has no architect-boundaries skill at ${BOUNDARIES_REL}`), {
      hint: "that skill is ours and is not provided by openspec; it must be in the kit",
    })
  }

  const STAMPED = {
    IDENTITY: fs.readFileSync(identityPath, "utf8"),
    BOUNDARIES_SKILL: fs.readFileSync(boundariesPath, "utf8"),
  }

  const modelSrc = path.join(root, MODEL_SRC)
  if (!fs.existsSync(modelSrc)) {
    throw Object.assign(new Error(`the kit has no mental model at ${MODEL_SRC}/`), {
      hint: "the 16 MB model is ours and ships; its absence is a kit problem, not something openspec supplies",
    })
  }
  const MODEL = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(p); continue }
      const rel = `${MODEL_DEST}/${path.relative(modelSrc, p).split(path.sep).join("/")}`
      const data = fs.readFileSync(p)
      if (isText(data)) MODEL.push([rel, "text", data.toString("utf8")])
      else MODEL.push([rel, "base64", data.toString("base64")])
    }
  }
  walk(modelSrc)

  const files = [IDENTITY_REL, BOUNDARIES_REL, ...MODEL.map(([rel]) => rel)]
  const bytes = Buffer.byteLength(JSON.stringify({ STAMPED, MODEL }), "utf8")
  return { STAMPED, MODEL, files, bytes }
}
