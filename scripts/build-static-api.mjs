#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { load as yamlLoad } from 'js-yaml'

const ROOT = process.argv[2] || '.'
const OUT = process.argv[3] || 'static-api'
const JOBS_DIR = join(ROOT, 'jobs')
const FIGHTS_DIR = join(ROOT, 'fights')

function parseTime(v) {
  if (typeof v === 'number') return v
  const m = v.match(/^(\d+):(\d{2}(?:\.\d+)?)$/)
  if (!m) throw new Error(`Invalid time format: ${v}`)
  return parseInt(m[1]) * 60 + parseFloat(m[2])
}

function loadJob(abbr) {
  const path = join(JOBS_DIR, `${abbr}.yaml`)
  const raw = yamlLoad(readFileSync(path, 'utf8'))
  return raw.map(a => {
    delete a._description
    return { ...a, charges: a.charges ?? 1, job: abbr.toUpperCase() }
  })
}

function loadFight(id, path) {
  const raw = yamlLoad(readFileSync(path, 'utf8'))
  return {
    ...raw,
    duration: parseTime(raw.duration),
    phases: (raw.phases ?? []).map(p => ({
      ...p,
      startTime: parseTime(p.startTime),
      endTime: parseTime(p.endTime),
    })),
    bossActions: (raw.bossActions ?? []).map((ba, i) => {
      const time = parseTime(ba.time)
      const castStart = ba.castStart != null ? parseTime(ba.castStart) : undefined
      const { castStart: _, time: __, ...rest } = ba
      return { id: `${id}_ba${i}`, ...rest, type: rest.type ?? 'raid', time, ...(castStart != null ? { castTime: time - castStart } : {}) }
    }),
    mechanics: (raw.mechanics ?? []).map((m, i) => ({
      ...m,
      id: `${id}_m${i}`,
      startTime: parseTime(m.startTime),
      endTime: parseTime(m.endTime),
    })),
  }
}

// Build jobs
const jobsOut = join(OUT, 'api', 'jobs')
mkdirSync(jobsOut, { recursive: true })
for (const file of readdirSync(JOBS_DIR).filter(f => f.endsWith('.yaml'))) {
  const abbr = file.replace('.yaml', '')
  const data = loadJob(abbr)
  writeFileSync(join(jobsOut, `${abbr}.json`), JSON.stringify(data))
  console.log(`  jobs/${abbr}.json (${data.length} abilities)`)
}

// Build fights
const fightsOut = join(OUT, 'api', 'fights')
mkdirSync(fightsOut, { recursive: true })

const groupsFilePath = join(FIGHTS_DIR, '_groups')
const allDirs = readdirSync(FIGHTS_DIR).filter(name => statSync(join(FIGHTS_DIR, name)).isDirectory())
const groupDirs = existsSync(groupsFilePath)
  ? readFileSync(groupsFilePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).filter(d => allDirs.includes(d))
  : allDirs.sort()

const groups = []
for (const dir of groupDirs) {
  const dirPath = join(FIGHTS_DIR, dir)
  const labelPath = join(dirPath, '_label')
  const label = existsSync(labelPath)
    ? readFileSync(labelPath, 'utf8').trim()
    : dir.replace(/-/g, ' ')

  const fightMap = new Map()
  for (const file of readdirSync(dirPath).filter(f => f.endsWith('.yaml'))) {
    const filePath = join(dirPath, file)
    const raw = yamlLoad(readFileSync(filePath, 'utf8'))
    const id = raw.id ?? file.replace('.yaml', '')
    const fight = loadFight(id, filePath)
    fightMap.set(id, fight)
    writeFileSync(join(fightsOut, `${id}.json`), JSON.stringify(fight))
  }

  const orderPath = join(dirPath, '_order')
  const orderedIds = existsSync(orderPath)
    ? readFileSync(orderPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    : [...fightMap.keys()].sort()

  const fights = []
  for (const id of orderedIds) {
    const fight = fightMap.get(id)
    if (fight) {
      const { bossActions: _, mechanics: __, ...meta } = fight
      fights.push(meta)
    }
  }

  const collapsed = existsSync(join(dirPath, '_collapsed')) || undefined
  if (fights.length) groups.push({ label, fights, collapsed })
}

writeFileSync(join(fightsOut, 'index.json'), JSON.stringify(groups))
console.log(`  fights/index.json (${groups.length} groups)`)
console.log('Done.')
