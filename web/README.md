# Web UI sources

The two apps each have one HTML, CSS and JavaScript UI source for browser and
Android. The folders follow application identity. Browser versus APK is a
packaging and platform-adapter choice within each app.

| Application | Shared browser/APK UI source | Android host |
| --- | --- | --- |
| [Non-verba-dev](apps/non-verba-dev/README.md) | `apps/non-verba-dev/src/` — developer camera, audio, location, signing-key enrollment and verification tools | `code/android/app/`, package `org.nonverba.camera` |
| [Non-verba](apps/non-verba/README.md) | `apps/non-verba/src/` — participant Requester/Operator workspace; currently a nonbinding preview with drafts and synthetic examples | `code/android/participant/`, package `org.nonverba.participant` |

An APK bundles the selected app's web UI in an Android WebView. Native Android
permissions, acquisition and key storage live in the host and platform adapters.
The browser uses browser capabilities. The [app guide](apps/README.md) maps these
boundaries. The participant preview has no connected accounts, task publication,
signatures or services; existing developer tools do not complete that journey.

| Other directory | Purpose and current boundary |
| --- | --- |
| [shared/](shared/README.md) | Reusable evidence, platform and workflow modules; importing a component does not establish a connected product journey |
| [inspections/](inspections/README.md) | Isolated map, registration and authentication/privacy inspections, with their own integration limits |
| [simulator/](simulator/README.md) | Fictional cooperation scenarios using the cooperation calculation core |
| [site/](../docs/development/HOMEPAGE_DEPLOYMENT.md) | Public homepage and canonical project artwork |

Project progress records and their standalone viewer live in the private
workspace's [dashboard](../../private-source/web/dashboard/README.md), outside
this public web tree. This local link requires the sibling private checkout.

## Source and build boundaries

App presentation lives under `apps/`; reusable modules live under `shared/`.
[assets.json](assets.json)
maps each authored evidence/inspection asset to its flat runtime filename and
declares the application entries. The evidence browser build
still emits the existing flat URLs in `web/dist/`, such as `index.html`,
`audio.html` and `location.html`. Moving an authored file does not change a
bookmark, relative runtime import or test URL. Generated output is ignored;
edit the source directories instead.

The Non-verba-dev Android build uses the generated `web/dist-android/` output.
It selects the developer entries and their dependencies from the same source as
the browser build. Browser-only inspections stay outside that APK. Non-verba
has its own explicit UI/artwork allowlist and is staged separately. Generated
outputs are packaging destinations, not separate UI implementations.

Run builds and checks only in the documented [managed Debian container](../docs/development/CONTAINER_PLAN.md),
using the [snapshot bridge](../docs/development/CONTAINER_MIGRATION.md) for this
checkout. From `code/`, use `node --run build:web` for the evidence browser build
and `node --run serve:developer` (also `serve:web`) for its preview.
`node --run serve:simulator` serves the separate cooperation simulator.
Android and participant staging follow the [Android guide](../code/android/README.md).
The homepage and simulator have separate procedures linked above. Dashboard
maintenance follows its private workspace guide.

## Where new work belongs

Put app presentation and entry pages in `apps/<application>/src/`, reusable
modules in the appropriate `shared/` capability, and isolated demonstrations in
`inspections/`. Implement a participant workflow once for its browser and APK
targets; select shared interfaces and isolate platform differences in adapters.
Keep each application's source and runtime asset selection explicit in the
build configuration.

Document component checks separately from product integration, physical-device
acceptance and deployment. This organization changes source and packaging
boundaries; it does not connect accounts, tasks, agreements or backend services.
