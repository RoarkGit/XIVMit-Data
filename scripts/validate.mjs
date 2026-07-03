#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { load as yamlLoad } from 'js-yaml'

const ROOT = process.argv[2] || '.'
const JOBS_DIR   = join(ROOT, 'jobs')
const FIGHTS_DIR = join(ROOT, 'fights')

const VALID_SCOPE   = new Set(['self', 'single', 'party', 'enemy'])
const VALID_TYPE    = new Set(['mitigation', 'shield', 'heal', 'invuln', 'utility'])
const VALID_BA_TYPE = new Set(['raid', 'tb', 'mech', 'enrage', 'note'])
const VALID_LEVELS  = new Set([70, 80, 90, 100])
const TIME_RE = /^(\d+):(\d{2}(?:\.\d+)?)$/

const COLLAPSE_THRESHOLD = 3

function collapseErrors(errors) {
  // Strip index numbers and ability names to get the error "shape"
  const shape = e => e.replace(/\[\d+\](?:\s*\([^)]*\))?/g, '[*]')

  // Count all occurrences of each shape
  const counts = new Map()
  for (const e of errors) counts.set(shape(e), (counts.get(shape(e)) ?? 0) + 1)

  // Emit summary at first occurrence, skip the rest
  const emitted = new Set()
  const out = []
  for (const e of errors) {
    const s = shape(e)
    const count = counts.get(s)
    if (count >= COLLAPSE_THRESHOLD) {
      if (!emitted.has(s)) { out.push(`${s} (×${count} entries)`); emitted.add(s) }
    } else {
      out.push(e)
    }
  }
  return out
}

function relPath(abs) {
  return relative(ROOT, abs)
}

function isValidTime(v) {
  if (typeof v === 'number') return v >= 0
  if (typeof v === 'string') return TIME_RE.test(v)
  return false
}

function parseTime(v) {
  if (typeof v === 'number') return v
  const m = v.match(TIME_RE)
  return parseInt(m[1]) * 60 + parseFloat(m[2])
}

function validateJobFile(filePath) {
  const errors = []
  let raw
  try {
    raw = yamlLoad(readFileSync(filePath, 'utf8'))
  } catch (e) {
    return [`YAML parse error: ${e.message}`]
  }

  if (!Array.isArray(raw)) return ['Expected top-level array of abilities']

  // Pre-pass: collect every id and chargeGroup name declared in this file, so cross-reference
  // checks below don't care about declaration order (an ability can reference one defined later).
  const allIds = new Set()
  const chargeGroups = new Set()
  for (const ab of raw) {
    if (typeof ab !== 'object' || ab === null) continue
    if (typeof ab.id === 'string' && ab.id) allIds.add(ab.id)
    if (typeof ab.chargeGroup === 'string' && ab.chargeGroup) chargeGroups.add(ab.chargeGroup)
  }

  function checkIdRef(ctx, field, id) {
    if (typeof id !== 'string') { errors.push(`${ctx}.${field}: must be a string`); return }
    if (!allIds.has(id)) errors.push(`${ctx}.${field}: references unknown id "${id}" (not declared in this file - if you renamed it, update this reference too)`)
  }

  function checkIdRefArray(ctx, field, arr) {
    if (!Array.isArray(arr)) { errors.push(`${ctx}.${field}: must be an array`); return }
    for (const id of arr) checkIdRef(ctx, field, id)
  }

  const seenIds = new Set()
  for (let i = 0; i < raw.length; i++) {
    const ab = raw[i]
    const ctx = `abilities[${i}]${ab?.id ? ` (${ab.id})` : ''}`

    if (typeof ab !== 'object' || ab === null) { errors.push(`${ctx}: must be an object`); continue }

    if (typeof ab.id !== 'string' || !ab.id)           errors.push(`${ctx}.id: required string`)
    else if (seenIds.has(ab.id))                        errors.push(`${ctx}.id: duplicate id "${ab.id}"`)
    else                                                seenIds.add(ab.id)

    if (typeof ab.name !== 'string' || !ab.name)        errors.push(`${ctx}.name: required string`)
    if (ab.cooldown !== undefined && ab.cooldown !== null && typeof ab.cooldown !== 'number')
      errors.push(`${ctx}.cooldown: must be number or null`)
    if (ab.duration !== undefined && (typeof ab.duration !== 'number' || ab.duration < 0))
      errors.push(`${ctx}.duration: must be a non-negative number if present (defaults to 0)`)
    if (typeof ab.minLevel !== 'number')                errors.push(`${ctx}.minLevel: required number`)
    if (!VALID_SCOPE.has(ab.scope))
      errors.push(`${ctx}.scope: must be one of ${[...VALID_SCOPE].join('|')}, got ${JSON.stringify(ab.scope)}`)
    if (ab.type !== undefined && !VALID_TYPE.has(ab.type))
      errors.push(`${ctx}.type: must be one of ${[...VALID_TYPE].join('|')}, got ${JSON.stringify(ab.type)}`)
    if (ab.charges !== undefined && (typeof ab.charges !== 'number' || ab.charges < 1 || !Number.isInteger(ab.charges)))
      errors.push(`${ctx}.charges: must be positive integer`)
    if (ab.durationUpgrade != null) {
      if (typeof ab.durationUpgrade !== 'object') errors.push(`${ctx}.durationUpgrade: must be an object`)
      else {
        if (typeof ab.durationUpgrade.minLevel !== 'number') errors.push(`${ctx}.durationUpgrade.minLevel: required number`)
        if (typeof ab.durationUpgrade.duration !== 'number') errors.push(`${ctx}.durationUpgrade.duration: required number`)
      }
    }
    if (ab.cooldownUpgrade != null) {
      if (typeof ab.cooldownUpgrade !== 'object') errors.push(`${ctx}.cooldownUpgrade: must be an object`)
      else {
        if (typeof ab.cooldownUpgrade.minLevel !== 'number') errors.push(`${ctx}.cooldownUpgrade.minLevel: required number`)
        if (typeof ab.cooldownUpgrade.cooldown !== 'number') errors.push(`${ctx}.cooldownUpgrade.cooldown: required number`)
      }
    }
    if (ab.replaces !== undefined) checkIdRef(ctx, 'replaces', ab.replaces)
    if (ab.sharedCharge !== undefined) {
      if (typeof ab.sharedCharge !== 'string') errors.push(`${ctx}.sharedCharge: must be a string (chargeGroup name)`)
      else if (!chargeGroups.has(ab.sharedCharge))
        errors.push(`${ctx}.sharedCharge: no ability in this file declares chargeGroup "${ab.sharedCharge}"`)
    }
    if (ab.requiresWithin != null) {
      if (typeof ab.requiresWithin !== 'object') errors.push(`${ctx}.requiresWithin: must be an object`)
      else {
        if (ab.requiresWithin.abilityId !== undefined) checkIdRef(ctx, 'requiresWithin.abilityId', ab.requiresWithin.abilityId)
        else errors.push(`${ctx}.requiresWithin.abilityId: required string`)
        if (typeof ab.requiresWithin.window !== 'number')    errors.push(`${ctx}.requiresWithin.window: required number`)
      }
    }
    if (ab.quickHeal !== undefined && typeof ab.quickHeal !== 'boolean')
      errors.push(`${ctx}.quickHeal: must be a boolean`)
    if (ab.gauge != null) {
      if (typeof ab.gauge !== 'object') errors.push(`${ctx}.gauge: must be an object`)
      else {
        if (typeof ab.gauge.type !== 'string' || !ab.gauge.type) errors.push(`${ctx}.gauge.type: required string`)
        if (typeof ab.gauge.cost !== 'number') errors.push(`${ctx}.gauge.cost: required number`)
        if (ab.cooldown != null) errors.push(`${ctx}.gauge: set alongside a non-null cooldown - gauge label only shows when cooldown is null`)
      }
    }
    if (ab.blockedDuringActive !== undefined) checkIdRefArray(ctx, 'blockedDuringActive', ab.blockedDuringActive)
    if (ab.canceledBy !== undefined) checkIdRefArray(ctx, 'canceledBy', ab.canceledBy)
    if (ab.kitchenSinkFor !== undefined) checkIdRefArray(ctx, 'kitchenSinkFor', ab.kitchenSinkFor)
  }

  return errors
}

function validateFightFile(filePath) {
  const errors = []
  let raw
  try {
    raw = yamlLoad(readFileSync(filePath, 'utf8'))
  } catch (e) {
    return [`YAML parse error: ${e.message}`]
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return ['Expected top-level object (fight definition)']

  if (typeof raw.id !== 'string' || !raw.id)     errors.push('id: required string')
  if (typeof raw.name !== 'string' || !raw.name)  errors.push('name: required string')
  if (!isValidTime(raw.duration))                 errors.push(`duration: invalid time value ${JSON.stringify(raw.duration)}`)
  if (typeof raw.maxLevel !== 'number')           errors.push('maxLevel: required number')
  else if (!VALID_LEVELS.has(raw.maxLevel))       errors.push(`maxLevel: expected one of ${[...VALID_LEVELS].join('|')}, got ${raw.maxLevel}`)
  if (raw.phases !== undefined && !Array.isArray(raw.phases))      errors.push('phases: must be an array')
  if (raw.bossActions !== undefined && !Array.isArray(raw.bossActions)) errors.push('bossActions: must be an array')

  if (Array.isArray(raw.phases)) {
    for (let i = 0; i < raw.phases.length; i++) {
      const p = raw.phases[i]
      const ctx = `phases[${i}]`
      if (typeof p !== 'object' || p === null) { errors.push(`${ctx}: must be an object`); continue }
      if (typeof p.name !== 'string')     errors.push(`${ctx}.name: required string`)
      if (!isValidTime(p.startTime))      errors.push(`${ctx}.startTime: invalid time value ${JSON.stringify(p.startTime)}`)
      if (!isValidTime(p.endTime))        errors.push(`${ctx}.endTime: invalid time value ${JSON.stringify(p.endTime)}`)
      if (isValidTime(p.startTime) && isValidTime(p.endTime) && parseTime(p.startTime) >= parseTime(p.endTime))
        errors.push(`${ctx}: startTime must be before endTime`)
    }
  }

  if (Array.isArray(raw.bossActions)) {
    let lastTime = -1
    for (let i = 0; i < raw.bossActions.length; i++) {
      const ba = raw.bossActions[i]
      const ctx = `bossActions[${i}]${ba?.name ? ` (${ba.name})` : ''}`
      if (typeof ba !== 'object' || ba === null) { errors.push(`${ctx}: must be an object`); continue }
      if (typeof ba.name !== 'string')    errors.push(`${ctx}.name: required string`)
      if (!isValidTime(ba.time))          errors.push(`${ctx}.time: invalid time value ${JSON.stringify(ba.time)}`)
      if (ba.type !== undefined && !VALID_BA_TYPE.has(ba.type))
        errors.push(`${ctx}.type: must be one of ${[...VALID_BA_TYPE].join('|')}, got ${JSON.stringify(ba.type)}`)
      if (ba.castStart !== undefined && !isValidTime(ba.castStart))
        errors.push(`${ctx}.castStart: invalid time value ${JSON.stringify(ba.castStart)}`)
      if (isValidTime(ba.time) && isValidTime(ba.castStart) && parseTime(ba.castStart) >= parseTime(ba.time))
        errors.push(`${ctx}.castStart: must be before time`)
      if (isValidTime(ba.time)) {
        const t = parseTime(ba.time)
        if (t < lastTime) errors.push(`${ctx}.time: out of order (${ba.time} before previous entry)`)
        lastTime = t
      }
    }
  }

  return errors
}

function run() {
  const issues = []
  let jobFileCount = 0
  let fightFileCount = 0

  for (const file of readdirSync(JOBS_DIR).filter(f => f.endsWith('.yaml')).sort()) {
    jobFileCount++
    const filePath = join(JOBS_DIR, file)
    const errors = validateJobFile(filePath)
    if (errors.length) issues.push({ file: relPath(filePath), errors })
  }

  const groupsFile = join(FIGHTS_DIR, '_groups')
  const allDirs = readdirSync(FIGHTS_DIR).filter(n => statSync(join(FIGHTS_DIR, n)).isDirectory())
  const groupDirs = existsSync(groupsFile)
    ? readFileSync(groupsFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).filter(d => allDirs.includes(d))
    : allDirs.sort()

  for (const dir of groupDirs) {
    const dirPath = join(FIGHTS_DIR, dir)
    for (const file of readdirSync(dirPath).filter(f => f.endsWith('.yaml')).sort()) {
      fightFileCount++
      const filePath = join(dirPath, file)
      const errors = validateFightFile(filePath)
      if (errors.length) issues.push({ file: relPath(filePath), errors })
    }
  }

  for (const issue of issues) issue.errors = collapseErrors(issue.errors)

  const totalFiles = jobFileCount + fightFileCount
  const errorCount = issues.reduce((n, i) => n + i.errors.length, 0)
  const fileCount  = issues.length

  if (issues.length === 0) {
    console.log(`## YAML Validation\n\n✅ All ${totalFiles} data files valid (${jobFileCount} jobs, ${fightFileCount} fights).`)
  } else {
    const lines = [
      '## YAML Validation',
      '',
      `❌ **${errorCount} error${errorCount !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}** (${totalFiles} files checked)`,
      '',
    ]
    for (const { file, errors } of issues) {
      lines.push(`### \`${file}\``)
      for (const e of errors) lines.push(`- ${e}`)
      lines.push('')
    }
    console.log(lines.join('\n'))
    process.exit(1)
  }
}

run()
