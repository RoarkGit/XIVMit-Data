#!/usr/bin/env node
// Flags ability ids that existed at a base git ref but are gone on HEAD - i.e. renamed or
// removed. Assignments in saved plans reference abilities by id only (client/src/types.ts),
// looked up live against the current job YAML - a vanished id doesn't error, it just silently
// drops that block from every plan that used it (see Timeline.tsx / CondensedView.tsx
// `abMap[assign.abilityId]` lookups). This check exists to surface that risk in review, before
// merge, since nothing else catches it.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { load as yamlLoad } from 'js-yaml'

const ROOT = process.argv[2] || '.'
const BASE_REF = process.argv[3]
const JOBS_DIR = join(ROOT, 'jobs')

if (!BASE_REF) {
  console.error('Usage: check-renamed-ids.mjs <data-dir> <base-git-ref>')
  process.exit(2)
}

function idsFromYaml(content) {
  const raw = yamlLoad(content)
  const ids = new Set()
  if (!Array.isArray(raw)) return ids
  for (const ab of raw) {
    if (ab && typeof ab === 'object' && typeof ab.id === 'string' && ab.id) ids.add(ab.id)
  }
  return ids
}

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null // didn't exist at that ref
  }
}

function baseJobFiles(ref) {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'jobs'], { cwd: ROOT, encoding: 'utf8' })
    return out.split('\n').map(l => l.trim()).filter(l => l.endsWith('.yaml')).map(l => l.replace(/^jobs\//, ''))
  } catch {
    return []
  }
}

function run() {
  const headFiles = new Set(readdirSync(JOBS_DIR).filter(f => f.endsWith('.yaml')))
  const allFiles = new Set([...baseJobFiles(BASE_REF), ...headFiles])
  const removed = []

  for (const file of allFiles) {
    const oldContent = gitShow(BASE_REF, `jobs/${file}`)
    const oldIds = oldContent ? idsFromYaml(oldContent) : new Set()
    let newIds = new Set()
    if (headFiles.has(file)) {
      try { newIds = idsFromYaml(readFileSync(join(JOBS_DIR, file), 'utf8')) } catch { /* invalid YAML - validate.mjs already reports this */ }
    }
    for (const id of oldIds) if (!newIds.has(id)) removed.push({ file, id })
  }

  if (removed.length === 0) {
    console.log(`## Ability ID Rename Check\n\n✅ No ability ids removed or renamed relative to \`${BASE_REF}\`.`)
    return
  }

  const lines = [
    '## Ability ID Rename Check',
    '',
    `⚠️ **${removed.length} ability id${removed.length !== 1 ? 's' : ''} removed or renamed** relative to \`${BASE_REF}\`:`,
    '',
    ...removed.map(({ file, id }) => `- \`${file}\`: \`${id}\``),
    '',
    'Saved plans reference abilities by this id only, resolved live against the current YAML. If any of these were **renamed** rather than intentionally deleted, undo the rename (or keep the old id and add a new one instead) - otherwise every existing plan using it will silently lose that block on next load, with no error shown to the user. If this removal is intentional, this warning can be ignored.',
  ]
  console.log(lines.join('\n'))
  process.exit(1)
}

run()
