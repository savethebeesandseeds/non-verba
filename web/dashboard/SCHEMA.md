# Heroes Goals and Milestones schema

Version 2. The hierarchy has exactly three levels:

**Hero → Goal → Milestone**

- **Hero:** a broad area of work, using the previous eleven categories.
- **Goal:** a concrete outcome within that Hero.
- **Milestone:** a checkable step toward the Goal, with its own state.

Edit the relevant Hero JSON beside `index.html` and this schema, such as
`01-sensors.json`. Only Milestones store states. The dashboard calculates Hero
and Goal summaries automatically from its last validated snapshot.

## Record only confirmed scope

This is a partial project record. Add a Goal or Milestone when an explicit owner
request, agreed task record or implementation evidence supports its scope and
state. Broad research notes and missing-feature lists support the Hero outline;
they do not establish a specific task's acceptance criteria, dependencies or
active status. Read the linked evidence before recording an outcome.

Leave `goals: []` when a Hero's breakdown is unconfirmed. A confirmed Goal can
have `milestones: []` until its steps are defined. Empty records mean no
Milestones are recorded, rather than no work exists. Keep known prototypes,
synthetic checks, physical trials and deployment outcomes precisely scoped.
Omit unknown dates and ownership. A done record completes only its stated scope.

## Minimal Hero file

```json
{
  "schemaVersion": 2,
  "id": "sensors",
  "number": 1,
  "title": "Sensor hardening and evidence quality",
  "summary": "Reliable acquisition and usable evidence.",
  "updatedAt": "2026-10-14",
  "goals": [
    {
      "id": "sensors-reliable-capture",
      "title": "Reliable sensor capture",
      "milestones": [
        {
          "id": "sensors-permission-recovery",
          "title": "Handle denied permissions and recovery",
          "status": "proposed"
        }
      ]
    }
  ]
}
```

## Fields

| Level | Required fields | Optional fields |
| --- | --- | --- |
| Hero | `schemaVersion: 2`, `id`, `number`, `title`, `summary`, `updatedAt`, `goals` | None |
| Goal | `id`, `title`, `milestones` | `description` |
| Milestone | `id`, `title`, `status` | `description`, `owner`, `updatedAt`, `completedAt`, `acceptance`, `evidence`, `dependsOn` |

IDs are stable lowercase slugs, unique across all Heroes, Goals and Milestones.
Prefix Goal and Milestone IDs with their Hero ID. Titles, descriptions and
criteria use ordinary text. `goals` and `milestones` are arrays; there is no
recursive `children` field. Do not put `status` on a Hero or Goal.

Dates use `YYYY-MM-DD`. Update the Hero's `updatedAt` when changing its file.
Milestone dates are optional; a recorded completion date must be known, belong
to a done Milestone and not follow its update date (or the Hero's update date).
Unknown completion dates can be omitted or `null`. `owner` is optional text or
`null`. Missing arrays are treated as empty.

## Milestone states

| JSON value | Dashboard color | Meaning |
| --- | --- | --- |
| `proposed` | Gray | Scope or approach needs definition or agreement |
| `ready` | Blue | Defined, with prerequisites resolved; available to start |
| `in_progress` | Amber | Work has begun, supported by the current record |
| `blocked` | Red | A specific unresolved dependency prevents progress |
| `done` | Green | Acceptance criteria are achieved and evidence is linked |

A blocked Milestone requires a `description` explaining the blocker. A done
Milestone requires nonempty `acceptance` and `evidence` arrays:

```json
{
  "id": "sensors-permission-recovery",
  "title": "Handle denied permissions and recovery",
  "status": "done",
  "completedAt": "2026-10-14",
  "acceptance": ["The agreed denial and recovery cases pass."],
  "evidence": [
    {"label": "Recorded validation", "path": "docs/sensors/VALIDATION.md"}
  ]
}
```

Each evidence entry has a `label` and a repository-relative file `path`, with an
optional heading anchor. Link authored records supporting the actual outcome.
`dependsOn`, if used, is an array of other Milestone IDs. Dependencies must exist
and cannot form a cycle; they cannot point to a Hero or Goal.

Hero and Goal summaries count their Milestones once: all done means done, an
unresolved blocker takes precedence, active work means in progress, and a mixture
of completed and proposed/ready work is labelled **Partially complete**. Otherwise
they show ready or proposed. Counts describe tracked Milestones, not effort or
production readiness. Empty Goals are allowed while planning.

## Updating a milestone

1. Read this schema and the relevant Hero JSON; preserve other sessions' changes.
2. Update the Milestone's state and description. For done, add its actual
   acceptance criteria and evidence; for blocked, explain the blocker.
3. Update the Hero date. Add optional Milestone dates, owner or dependencies when
   useful. Keep existing IDs when moving a Milestone between Goals.
4. From the repository root, refresh the standalone dashboard:

```powershell
./web/dashboard/refresh.ps1
```

Windows Bash can use `bash web/dashboard/refresh.sh` instead. It delegates to
the same snapshot/copy-back workflow. Inside the managed Debian container, the
shell helper updates only that source snapshot's HTML. Shell options are
`--check` and `--browser-check`.

The refresh command validates the source JSONs and regenerates `index.html` in
the existing managed container through the snapshot bridge, then copies the HTML
back. Hero JSONs remain the source of truth. Preserve concurrent changes and do
not hand-edit the generated HTML.

The adjacent `manifest.json` needs an edit only when adding/removing a Hero or
changing its file/ID/order, and has no shared update date. Ordinary progress work
edits one Hero JSON and refreshes the generated HTML.

Open [index.html](index.html) directly in a browser after a successful refresh.
It opens populated without a picker or server. Browser file-open security prevents
automatic fetching of adjacent JSONs, so the HTML includes the last validated
snapshot. JSON edits become visible only after refresh and reopening/reloading
the HTML. `./web/dashboard/refresh.ps1 -Check` validates data and HTML freshness
without host writes; add `-BrowserCheck` for focused model and file-open checks.

The formal definitions are [hero.schema.json](schemas/hero.schema.json) and
[manifest.schema.json](schemas/manifest.schema.json). Runtime validation also checks real
calendar dates, date ordering, global ID uniqueness, dependency references/cycles
and existing evidence files. See [opening instructions](README.md#open-the-dashboard).
