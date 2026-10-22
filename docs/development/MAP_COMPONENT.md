# Shared map component

The initial map is an isolated browser component, following the existing
platform/policy/controller/view separation. It does not start GPS, pair a live
session, look up accounts, or request directions. A future requester/operator
screen can compose the same component with its own authorized data adapters.

Open `map.html` from the evidence application's browser inspection link. It
starts with a bundled Norway outline and no external requests. Street tiles
are a deliberate, session-only OpenStreetMap preview option. Example positions
and route geometry are explicitly synthetic. There is no connected operator
tracking service or routing engine.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `web/shared/map/map-country-data.js` | Reviewed mainland/coastal Norway administrative display geometry and provenance |
| `web/shared/map/map-policy.js` | Non-verba deployment catalog and requester/operator visibility |
| `web/shared/map/map-geometry.js` | Web Mercator projection, polygon membership and tile intersection |
| `web/shared/map/map-controller.js` | Bounded, immutable display inputs, access changes and position expiry |
| `web/shared/map/map-tiles.js` | Explicit tile providers, attribution and same-origin URL construction |
| `web/shared/map/map-view.js` | Reusable clipped canvas viewport and tile lifecycle |
| `web/inspections/map/map-ui.js`, `map.html`, `map.css` | Standalone component inspection and accessible text equivalents |

The initial catalog contains Norway mainland and coastal islands, excluding
Svalbard, Jan Mayen and Bouvet. This is component configuration, not a claim that
the repository runs a deployed service in Norway. The production catalog must
come from Non-verba's own deployment authority, and list only deployments that
are currently actively supported. Country availability from a map provider has
no role in this decision.

A requester sees every active catalog entry. An operator sees the intersection
of active entries and independently supplied enabled country codes. Missing
operator grants produce an empty map. Unknown roles and malformed configuration
are rejected. Registration's self-reported country is not a grant. The server
must enforce access independently; client display filtering is not authorization.

## Composition contract

```js
import {MapController} from './map-controller.js';
import {createMapView} from './map-view.js';
import {createSameOriginTileSource} from './map-tiles.js';

const controller = new MapController({
  catalog: deploymentCatalog, // reviewed active deployments + display geometry
  role: 'operator',
  enabledCountries: accountCountryGrants,
});
const view = createMapView({canvas, controller, onStatus});

// Configure only after the corresponding service is provisioned and reviewed.
controller.setTileSource(createSameOriginTileSource({
  baseUrl: '/map-tiles', origin: location.origin,
  attribution: '© OpenStreetMap contributors',
}));
controller.setPositions(authorizedPositionUpdates);
controller.setRoutes(suppliedRouteGeometry);
// On grant/deployment changes, previous overlays are discarded immediately.
controller.setAccess({role: 'operator', enabledCountries: newGrants});
// On screen teardown:
view.destroy();
```

Positions contain `id`, `label`, `country_code`, `latitude`, `longitude`,
`accuracy_m`, `observed_at_ms` and `source`. The controller copies just these
display fields; it does not retain evidence files or account records. Batches
are limited to 500 positions and reject duplicate IDs and malformed values
atomically. Out-of-scope, outside-outline, expired and excessively future-dated
positions are omitted. The default display age is 60 seconds, with at most five
seconds of future clock tolerance. This is a display freshness rule, not
cryptographic assurance. Sources and timestamps remain visible in the text list.

Routes contain `id`, `label`, `country_code` and at least two `points`, each with
`latitude` and `longitude`. At most 100 routes / 10,000 points are accepted per
batch. All points must lie in the enabled display geometry; every drawn segment
is clipped as well. Rendering a supplied line does not establish a traversable
road, calculate directions, estimate arrival, or authorize crossing a border.

Snapshots re-evaluate position age using an injected clock. A composed screen
must call `refresh()` at the next position expiry and when returning to the
foreground; the inspection page does this with one expiry timer, without polling
sensors or a server. Supplied routes persist until cleared or replaced. Expired
positions are never relabeled as live. Access/catalog changes clear all overlays
rather than retaining hidden account data for later reappearance.

Native/browser location acquisition and signed live-location receipt verification
stay in their existing modules. A later adapter may map their selected or
verified results into display fields after the normal consent and verification
steps. The existing live-location pipeline is a bounded evidence collection, not
a continuous tracking feed. Maps must never infer permission to track from
permission to view. Continuous tracking needs its own consent, account scope,
work-privacy lifecycle, transport and retention policy.

## Tiles, clipping and efficiency

The dependency-free renderer uses Canvas 2D. Its country paths are projected once
and reused with native transforms. Immutable geometry uses cached polygon bounds
and latitude-indexed edges for position/route containment. It caps device density at two and total canvas
backing area at 16 million pixels, coalesces draws with animation frames, retains
at most 96 tile images / 512 intersection results, and loads at most four images
concurrently. It requests only tiles intersecting both the current viewport and
allowed country geometry; there is no prefetch, background polling or tile pack
download. Source changes, scope changes, hidden documents and teardown cancel
pending work and release resources. Ordinary browser HTTP caching remains enabled.

Border tiles contain pixels from neighboring countries. Polygon clipping hides
them in the view; it does not remove those pixels from the downloaded tile.
Kartverket's municipality illustration polygons are generalized administrative
coverage, including coastal waters. They are composed as a union, with holes
preserved and municipal interior borders omitted. They include coastal island
positions such as central Tromsø that generalized land-only outlines can omit.
They can differ from street tiles near borders and are suitable for this initial
display foundation, not precise geofencing, operational exclusion or navigation.
Precise country-only rendering needs a reviewed higher-resolution coverage mask.
Canvas is a single selectable DOM element; position text and controls remain DOM
elements for access and review.

The browser preview uses `tile.openstreetmap.org` only after the user enables
streets. It supplies visible attribution and a valid origin Referer through the
image's explicit referrer policy, uses stable URLs, respects normal HTTP caching,
and requests only the visible tiles. Public OSM tile hosting has no service
guarantee and forbids bulk download/prefetch for offline country packs. See the
[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/) and
[OSM attribution and data license](https://www.openstreetmap.org/copyright).

The page has strict scripts and styles, and permits images only from its own
origin and that one preview tile host. No inline style attributes or scripts are
required. Existing evidence page CSP and network policy remain unchanged. The
preview route is excluded from Android staging; Android's bundled-only request
handler and document allowlist have not been extended. Reusable map modules can
be bundled, but the APK does not yet expose maps or fetch external tiles.

## Curated country pipeline for production

1. Non-verba supplies a reviewed, versioned active-deployment catalog and separate
   account country grants. Define operational coverage within each country
   explicitly; a display land polygon is not a support contract.
2. Acquire a licensed OSM regional data extract or contract a suitable tile
   provider. Do not scrape the public OSM tile server for country packs.
3. Build or obtain versioned country tiles, a reviewed detailed display mask,
   zoom limits, attribution/license notices and cache/update rules. If neighboring
   geography must also be absent from fetched data, clip features before tile
   generation; viewport masking alone cannot meet that requirement.
4. Serve tiles on the app's authorized origin with HTTP cache validators and
   access enforcement. Integrate a provider through the tile-source port; do not
   couple provider coverage to the product catalog. Large vector/offline archives
   and their renderer can be evaluated later without changing the access or
   overlay contracts.
5. Compose positions through a deliberate authorized tracking adapter, and route
   geometry through an independently configured routing adapter. Plan Android
   tile delivery and network policy before exposing a native map route.

The current component creates none of these production services. Boundary source,
snapshot date, digest and derivation are recorded in
[the Kartverket notice](../../LICENSES/Kartverket-map-data-notice.txt).

## Validation

Inside the documented managed Linux container, using the source snapshot bridge:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @(
  'bash', '-c',
  'node --test test/unit/map-component-tests.mjs test/unit/test-suites-tests.mjs && NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers node test/browser/map-browser-tests.mjs'
)
```

The browser check serves this component's source directly, uses the provisioned
Playwright runtime, and requires no WASM/Android build. Synthetic tile responses
allow checks of country masking, request scoping, attribution/Referer, caching,
pan/zoom, pending-source cancellation and teardown without relying on OSM uptime.
These checks do not validate an external tile service, live tracking, navigation
or physical-device behavior. Record completed checks in development validation.
