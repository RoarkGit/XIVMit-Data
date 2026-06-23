<p align="center">
  <img src="logo.svg" width="64" height="64" alt="XIVMit">
</p>

<h1 align="center">XIVMit Data</h1>

<p align="center">
  Game data for <a href="https://xivmit.app">XIVMit</a> - FFXIV mitigation timeline planner.
</p>

## Structure

```
jobs/           One YAML file per job (ability definitions)
fights/         Fight timelines organized by tier
  _groups       Controls the display order of fight groups (one directory name per line)
  <tier>/       One YAML file per fight
    _label      Plain text group label shown in the UI (e.g. "Current Savage")
    _order      Controls the display order of fights within this group (one fight ID per line)
    _collapsed  If present, the group starts collapsed in the fight selector
```

## Contributing

PRs welcome for job ability data and fight timelines. See existing YAML files for the expected format. If an ability has particularly complex interactions, you can open an issue on the repo with its details and I can try to add backend support for whatever it needs.

### Job abilities

Each job file defines abilities with fields like:

```yaml
- id: war_bloodwhetting
  name: Bloodwhetting
  cooldown: 25
  duration: 8
  minLevel: 82
  scope: self
  type: mitigation       # mitigation | shield | heal | invuln
  charges: 1             # omit if 1 (default)
  replaces: war_raw_intuition
```

Optional fields:

| Field | Purpose |
|---|---|
| `charges` | Number of charges (default 1, only set if > 1) |
| `chargeGroup` | Groups abilities that share charges for conflict detection |
| `replaces` | ID of the ability this one supersedes at higher levels |
| `minLevel` | Minimum level required (ability hidden below this in the palette) |
| `durationUpgrade` | Longer duration at higher levels |
| `cooldownUpgrade` | Shorter cooldown at higher levels |
| `requiresWithin` | Must be used within N seconds of another ability |
| `kitchenSinkFor` | List of ability IDs this "kitchen sink" ability combines |
| `shieldStacks` | Number of shield stacks (for multi-stack shields) |

### Complex examples

**Kitchen Sink** - a virtual ability representing "use all self-mits at once." Not a real in-game ability; `cooldown: null` means no cooldown tracking.

```yaml
- id: war_kitchen_sink
  name: Kitchen Sink
  cooldown: null
  duration: 10
  scope: self
  type: mitigation
  kitchenSinkFor:
  - war_rampart
  - war_vengeance
  - war_damnation
  - war_thrill_of_battle
  - war_raw_intuition
  - war_bloodwhetting
```

**Multi-stack shield** - Panhaima grants 5 shield stacks. The timeline uses `shieldStacks` to calculate truncation from the Nth hit rather than the 1st.

```yaml
- id: sge_panhaima
  name: Panhaima
  cooldown: 120
  duration: 15
  scope: party
  type: shield
  shieldStacks: 5
```

**Shared charge group** - PLD's oath gauge abilities (Sheltron, Holy Sheltron, Cover, Intervention) all draw from the same 25s charge pool. `chargeGroup` links them for conflict detection. Note: these are NOT an upgrade chain, they are separate abilities.

```yaml
- id: pld_holy_sheltron
  name: Holy Sheltron
  cooldown: 25
  duration: 8
  charges: 2
  scope: self
  type: mitigation
  chargeGroup: pld_oath
  replaces: pld_sheltron

- id: pld_intervention 
  name: Intervention
  cooldown: 25
  duration: 8
  charges: 2
  scope: single
  type: mitigation
  chargeGroup: pld_oath
```

**Conditional ability** - SCH Consolation requires Seraph to be  active. `requiresWithin` enforces that Consolation must be placed within 22 seconds after Summon Seraph.

```yaml
- id: sch_consolation
  name: Consolation
  cooldown: 30
  duration: 30
  charges: 2
  scope: party
  type: shield
  requiresWithin:
    abilityId: sch_seraph
    window: 22
```

### Fight timelines

Each fight file defines boss actions on a timeline:

```yaml
id: umad
name: Dancing Mad (Ultimate)
shortName: UMAD
duration: 18:46
maxLevel: 100
phases:
  - name: Kefka
    startTime: 0:00
    endTime: 3:29
bossActions:
  - name: Revolting Ruin III
    time: 0:16
    type: tb
  - name: Hyperdrive
    time: 0:26
    type: raid
    castStart: 0:22.5     # optional, renders as a cast bar
```

All time fields accept `MM:SS` or `MM:SS.d` format.

`maxLevel` controls which abilities appear in the palette:
- Dawntrail savage + FRU + UMAD: `100`
- TOP + DSR: `90`
- TEA: `80`
- UWU + UCOB: `70`
