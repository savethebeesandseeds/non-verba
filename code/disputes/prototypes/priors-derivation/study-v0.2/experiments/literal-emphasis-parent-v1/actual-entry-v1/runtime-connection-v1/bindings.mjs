// SPDX-License-Identifier: AGPL-3.0-only
// External identities only. This source set is sealed by an external epoch.
export const ACCEPTED_RUNTIME=Object.freeze({
  manifest:{path:'../runtime/named-service-manifest.json',sha256:'aeba5ce60155b83bef3d87b6a5f9d4014919954ba4f38062d15e622040eac9d0',bytes:19874},
  validation:{path:'../runtime/validation.mjs',sha256:'a9581070eac8f382b878df506e1bcc52c759a39595313f64cd2effef33bd2aa7',bytes:9165},
  io:{path:'../runtime/io.mjs',sha256:'e215ba0ee5dfd433dd198090945b81f18c9d5f3ff668bb4236a85e354990fe64',bytes:6115}
});
export const FIXED_NODE=Object.freeze({path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920,version:'v22.23.3',platform:'linux',architecture:'x64',flags:Object.freeze(['--experimental-vm-modules'])});
export const OWN_FILES=Object.freeze(['bindings.mjs','index.mjs','controls.test.mjs','API.md']);
export const FUTURE_REQUIREMENTS=Object.freeze([
  'ROOT_REVIEWED_COMBINED_SOURCE_EPOCH_AND_EXACT_PHASE_CONFIG',
  'EXPLICIT_FIXED_SERVICE_PACKAGE_ROUTE_RECEIPT_NO_UNDECLARED_ALIAS',
  'OWNED_GUARDIAN_PRIVATE_CAPABILITY_ISSUANCE_AND_RUNTIME_IPC_RECEIVER',
  'EXACT_FROZEN_SELECTED69_STREAMS_AND_INHERITED_COSTS',
  'SEPARATE_ROOT_ACTUAL_PHASE_ADMISSION_AND_REVIEWED_ENTRY_SOURCE_CHANGE'
]);
