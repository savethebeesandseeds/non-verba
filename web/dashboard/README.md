# Non Verba project dashboard

## Open the dashboard

Open [index.html](index.html) directly in your browser. It contains the interface
and a validated snapshot of the Hero JSONs, so it opens populated without a file
picker, webserver, Docker, Node or Java. Repository documentation and evidence
links expect the original workspace location.

The separate Hero JSONs are the source of truth. A browser opening `file://`
cannot automatically fetch adjacent JSONs; the dashboard shows the snapshot
included by the last refresh. Editing JSON alone does not change that snapshot.

## Coverage of this record

The dashboard contains confirmed, evidence-backed checkpoints and explicitly
recorded requests. Unconfirmed task breakdowns are left empty. The Priors Hero
retains the record reviewed by its working session. Local prototypes and bounded
validation results retain their stated limits.

Empty Heroes have no recorded Goals or Milestones. A Hero or Goal marked
**Recorded complete** has all its listed Milestones done; its wider scope may
still be undefined. Completion bars measure the listed entries. The
[workstream outline](../../docs/notes/WORKSTREAMS.md) keeps the broad directions
available for later refinement.

## Explore the project

The dashboard starts at the project overview with no Hero or Goal selected.
Overview state counts filter the Hero map. Select one Hero to see its header and
the navigation list, where a small state dot beside each Hero number matches
that Hero's recorded milestone summary and colors. The selected Hero shows
compact choices for all its Goals. Each keeps its original number, a
done/total completion ring, recorded milestone state dots, clear selected styling
and a fixed chevron cue. Action text remains available to screen readers. Select
one Goal to show only its details and Milestones
in the adjacent desktop panel. Desktop choices use a taller, bounded vertical
scroll area with compact buttons; phones use a short swipeable strip above the
detail panel. Pale olive/sage surrounds ivory/sage choices. Surfaces stay within
the cream, sage and earthy sand theme; semantic milestone colors retain their
meaning.

Clicking or using the keyboard keeps the Goal choices and button focus in place,
updates only the detail panel and does not scroll the document automatically.
**Goals overview** clears the Goal selection while preserving position and
returning focus to the previous choice. **Project overview** clears both selections.
Current-work and dependency links select the target's actual Hero and Goal, then
jump directly to the explicitly requested Milestone.

Filters show matching counts without removing Goal choices or clearing the
selected Goal. Full-scope progress stays unchanged, and zero matches offer a
filter reset. Reset keeps the selected Hero and Goal. Search and navigation do
not automatically expand every Hero or every Goal.

Milestone headers use a translucent earthy sand wash with dark ink. Status rails, markers and
badges emphasize each Milestone's actual recorded state. Headers show their
original number, state, recorded metadata counts and
a two-line description preview. Opening a row reveals the complete description
once in its header. Below it, soft sage criteria and warm parchment evidence
surfaces present numbered acceptance criteria and evidence cards with labels and
filenames; dependencies show their actual states. Open details stay open as
filters change.
Active filters reveal matching Milestones; clearing them restores the Goal's normal
hide/show choice. Unknown dates are omitted.

Hero, Goal and project completion indicators count recorded Milestone states. They do
not estimate effort or launch readiness. Goal totals describe all their recorded
Milestones; filtered visible counts are separate. Acceptance criteria describe the
required outcome, rather than independent completed checklist items.

## Update progress

1. Read [SCHEMA.md](SCHEMA.md) and edit the relevant Hero file beside
   `index.html`, such as `01-sensors.json`. Keep stable IDs and preserve
   concurrent changes.
2. Record the actual milestone outcome, status, acceptance and evidence, then
   update the Hero's date.
3. From the repository root, run:

```powershell
./web/dashboard/refresh.ps1
```

From Windows Git Bash or WSL with PowerShell 7 available, the shell equivalent is:

```sh
bash web/dashboard/refresh.sh
```

It delegates to the same Windows snapshot/copy-back helper. Inside the managed
Debian container, `refresh.sh` validates and updates `index.html` in the current
source snapshot; that container-side invocation does not copy it to Windows.
Use `--check` and `--browser-check` for the equivalent shell options.

The refresh command validates the JSONs and generates the HTML inside the
existing managed Debian container through the
[snapshot bridge](../../docs/development/CONTAINER_MIGRATION.md), then copies the
generated `index.html` back. The documented container must be available for this
maintenance step. It installs no host toolchain and starts no webserver.
After a successful refresh, reopen or reload the HTML to see the changes.

The hierarchy is **Heroes → Goals → Milestones**. Each of the eleven Heroes has
one JSON file; Goals group concrete outcomes and Milestones track their state.
Only Milestones store states. Hero and Goal summaries are calculated, including
a distinct Partially complete label.

[SCHEMA.md](SCHEMA.md) defines the minimal example, optional fields, five states
and update rules; [hero.schema.json](schemas/hero.schema.json) is the formal schema
version 2. Completion requires acceptance criteria and evidence. Keep private
captures and credentials outside these authored records. The manifest has no
shared update date and changes only when its Hero file list changes.
[AGENTS.md](../../AGENTS.md#project-progress-dashboard) requires milestone upkeep;
the [Hero outline](../../docs/notes/WORKSTREAMS.md) defines scope.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Generated standalone interface and last validated progress snapshot |
| `01-sensors.json` … `11-services.json` | One maintained JSON per Hero, containing Goals and Milestones |
| `manifest.json` | Ordered Hero file list and project title |
| `SCHEMA.md` | Progress authoring guide |
| `refresh.ps1` | Refreshes through the existing managed container and copies back the generated HTML |
| `refresh.sh` | Shell entry point: delegates from Windows Bash, or refreshes the current managed Debian source snapshot |
| `src/` | Interface template, CSS, browser behavior and shared model |
| `tools/` | Project loader, standalone generator, validator and branding preparation |
| `schemas/` | Formal Hero and manifest schemas, version 2 |
| `assets/branding/` | Small transparent PNG derivatives of the existing project artwork |
| `test/` | Focused model and standalone browser checks |

The root keeps the files used to open the dashboard and maintain progress easy to
find. Hero JSON filenames and refresh commands remain stable. Implementation and
maintenance details are grouped by purpose:

```text
web/dashboard/
  index.html
  README.md, SCHEMA.md
  01-sensors.json ... 11-services.json
  manifest.json, package.json
  refresh.ps1, refresh.sh
  src/                 template.html, dashboard.css, dashboard.js, model.js
  tools/               project.mjs, build-standalone.mjs, validate.mjs, branding.mjs
  schemas/             hero.schema.json, manifest.schema.json
  assets/branding/     prepared PNG artwork
  test/                model.test.mjs, browser.mjs
```

Do not edit generated `index.html` by hand. Preserve stable IDs for confirmed
records and other sessions' reviewed checkpoints. Add tasks only when their
scope and state are supported, following [SCHEMA.md](SCHEMA.md).

## Checks and interface changes

From the repository root, check data validity and HTML freshness without copying
any host changes:

```powershell
./web/dashboard/refresh.ps1 -Check
```

Add `-BrowserCheck` to run the focused model and `file://` browser checks,
including generated-file freshness, in the same managed snapshot:

```powershell
./web/dashboard/refresh.ps1 -Check -BrowserCheck
```

After interface, model, template or schema-code changes, refresh with the focused
checks before delivery:

```powershell
./web/dashboard/refresh.ps1 -BrowserCheck
```

For visual review, set `NONVERBA_DASHBOARD_SCREENSHOTS` to `../reviews/dashboard`
before that command. The browser checks save desktop, phone and detailed-view PNGs
inside the printed container snapshot; they accept no destination outside it.

Opening the finished HTML runs none of these maintenance tools. It makes no HTTP
requests, loads no external assets and activates no sensors. `web/dashboard/`
remains outside homepage, browser-app and Android release exports.

The sprout mark and character artwork originate in [project branding](../site/branding/README.md).
Original artwork remains unchanged. The standalone generator includes small PNG
copies and the SVG mark as data URIs; copying only `index.html` retains the artwork.
If the selected artwork changes, regenerate its transparent thumbnails inside the
managed container with the existing browser runtime, then retain those PNGs and
refresh the HTML:

```sh
NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers node ../web/dashboard/tools/branding.mjs --optimize
```
