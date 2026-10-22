# Component inspections

These browser pages exercise map, registration and
authentication/work-privacy components independently. They are development
inspections with explicit integration limits, rather than participant screens.

The evidence browser build keeps their existing flat `web/dist/` entry URLs:
`map.html`, `registration.html` and
`authentication-privacy.html`. These entries and dependencies used only by them
are excluded from the developer Android output and participant shell.

Read the component records for [maps](../../docs/development/MAP_COMPONENT.md),
[registration](../../docs/development/REGISTRATION_PIPELINES.md) and
[authentication/privacy](../../docs/development/AUTHENTICATION_AND_WORK_PRIVACY.md).
Their local checks do not establish a connected account or work service.

Build through the managed container as described in the [web guide](../README.md).
