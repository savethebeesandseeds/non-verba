# Development guide

Use this directory for current public development procedures and implementation
boundaries. Builds, checks and Java run in the managed Linux environment. The
private backend has its own private guide, launcher and container under
`private-source/code/server/`; do not copy its implementation or operations here.

## Current procedures

| Task | Authoritative guide |
| --- | --- |
| Choose the environment and preserve its containers/volumes | [Managed Debian environment](CONTAINER_PLAN.md) |
| Validate this public checkout in the preserved environment | [Source snapshot bridge](CONTAINER_MIGRATION.md) |
| Find an application's UI, shared modules and output boundaries | [Web source map](../../web/README.md) |
| Build and inspect either APK | [Android packaging and build contract](../../code/android/README.md#build-contract) |
| Perform already authorized physical USB checks | [USB transport and semantic control](USB_DEBUGGING.md) |
| Use the independent image requester | [Requester CLI](IMAGE_REQUESTER_CLI.md) |
| Export the public homepage | [Homepage deployment](HOMEPAGE_DEPLOYMENT.md) |

## Client components and integration work

These guides distinguish available isolated components from requirements and
unimplemented integration. They do not establish a connected participant
journey, deployed service or approved identity/privacy policy.

| Component | Guide |
| --- | --- |
| Authentication and work privacy | [Requirements and implementation boundaries](AUTHENTICATION_AND_WORK_PRIVACY.md) |
| Registration | [Current local pipelines and missing account services](REGISTRATION_PIPELINES.md) |
| Operator face continuity | [Selected pipeline and unresolved assurance](OPERATOR_FACE_PIPELINE.md) |
| Maps | [Shared display contract and country pipeline](MAP_COMPONENT.md) |
| Agent workflows | [Workflow boundaries and MCP implementation gates](AGENT_WORKFLOWS_MCP.md) |
| Private services | [Shareable environment checkpoint only](SERVICE_ENVIRONMENT_CHECKPOINT.md) |

## Evidence and document ownership

[Development validation](VALIDATION.md), [sensor validation](../sensors/VALIDATION.md)
and [cooperation validation](../cooperation/VALIDATION.md) retain dated results,
failures and limits. Read them as observations of the named source and
environment, not as current operating instructions. Use focused guides above for
commands and prerequisites; do not infer new physical-device authorization from
an older test record.

Update the owning current guide when behavior changes. Add dated validation
beside the relevant evidence, keep its original scope and preserve referenced
anchors. Keep research questions in the [notes index](../notes/README.md) and
research run history beside its experiment. A dashboard milestone links these
records; it does not replace their instructions or extend their claims.
