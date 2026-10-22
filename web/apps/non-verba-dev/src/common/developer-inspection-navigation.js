// SPDX-License-Identifier: AGPL-3.0-only
// Browser inspection routes are not Android documents or native sensor workflows.
for (const link of document.querySelectorAll('[data-browser-inspection]')) {
  if (globalThis.NativeVault) link.remove();
  else link.hidden = false;
}
