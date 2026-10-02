// SPDX-License-Identifier: AGPL-3.0-only
// Regenerate using the actual shipped WASM and browser policy presets, inside Debian.
// The fixture crosses precisely the JSON.parse/stringify bridge used by the app.
import {writeFile} from 'node:fs/promises';
import {loadShippedCore} from '../../tools/image-requester-session.mjs';
import {locationPolicy} from '../../../web/src/location-policy.js';
const {core, wasmSha256, moduleSha256}=await loadShippedCore();
const nowMs=1790424000000, requests=[];
for (const profile of ['browser-or-native','native-required','native-gnss','raw-gnss']) {
  const wasmJson=core.create_location_request('Boundary test requester','Synthetic camera request',nowMs/1000,60,
    JSON.stringify(locationPolicy(profile)),JSON.stringify({session_id:'camera-boundary-session',purpose:'camera'}));
  const jsJson=JSON.stringify(JSON.parse(wasmJson));
  requests.push({profile,wasm_json:wasmJson,js_json:jsJson});
}
const fixture={version:1,now_ms:nowMs,wasm_sha256:wasmSha256,module_sha256:moduleSha256,requests};
await writeFile(new URL('../../crates/nonverba-core/src/camera_request_boundary_fixture.json',import.meta.url),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({profiles:requests.map(x=>x.profile),wasm_sha256:wasmSha256,
  all_cross_boundary_strings_differ:requests.every(x=>x.wasm_json!==x.js_json)}));
