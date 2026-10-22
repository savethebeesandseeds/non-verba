# Application UI sources

Each app has one HTML, CSS and JavaScript implementation for browser and Android.
Choose a source directory by application name; platform packaging does not create
a second UI source tree.

| Application | UI source | Browser | Android APK host |
| --- | --- | --- | --- |
| [Non-verba-dev](non-verba-dev/README.md) | `non-verba-dev/src/` | Developer capture, enrollment and verification tools | `code/android/app/`, package `org.nonverba.camera` |
| [Non-verba](non-verba/README.md) | `non-verba/src/` | Participant Requester/Operator workspace | `code/android/participant/`, package `org.nonverba.participant` |

Android bundles the selected app's web UI and displays it in a WebView. Native
permissions, acquisition and secure key operations belong to the Android host
and its platform adapters. Browser capabilities use browser adapters. Both apps
keep their own purpose, entry points, package identity and private data.

Non-verba currently provides a nonbinding workspace preview. Its draft screens
do not establish connected accounts, task publication, signatures or services.
Non-verba-dev provides evidence tools with the documented sensor and verification
limits. Working developer tools do not establish a complete participant journey.

Use [`../shared/`](../shared/README.md) for reusable modules selected by an app.
Use [`../inspections/`](../inspections/README.md) for isolated component pages
awaiting integration. The simulator and homepage have separate purposes outside
these two app source trees. Project progress lives in the private workspace's
[dashboard](../../../private-source/web/dashboard/README.md); this local link
requires the sibling private checkout.

The [web architecture guide](../README.md) describes generated outputs and build
commands. The [Android guide](../../code/android/README.md) describes native
hosts and APK staging. Run builds and checks in the managed Debian container.
