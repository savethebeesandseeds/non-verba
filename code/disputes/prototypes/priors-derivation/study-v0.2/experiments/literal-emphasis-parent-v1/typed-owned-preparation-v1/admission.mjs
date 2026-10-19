// SPDX-License-Identifier: AGPL-3.0-only
// Only privately issued, frame-owned SOURCE_FREE execution permits exist.
import {checkedConfiguration} from './configuration.mjs';
import {assertTransport} from './transport.mjs';
import {check,fail} from './core.mjs';
const permits=new WeakMap();
export function admitSourceFree(config,transport){const c=checkedConfiguration(config);assertTransport(transport,c);const permit=Object.freeze({source_kind:'SOURCE_FREE_FIXTURE',actual_authority:false});permits.set(permit,{config:c,transport});return permit;}
export function assertPermit(permit,root,phase=null){const s=permits.get(permit);check(s&&s.config.root===root&&(!phase||s.config.phase===phase),'TYPED_OWNED_PERMIT');assertTransport(s.transport,s.config);return s;}
export function actualEntry(){fail('TYPED_OWNED_ACTUAL_ENTRY_CLOSED');}
