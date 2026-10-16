// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC only. This is not the production text collector.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {traceNativeDecoration,bindNativeDecoration,verifyNativeDecorationEnvelope} from './source-decoration.prototype.mjs';

export const SOURCE_KIND='DECLARED_SYNTHETIC';
export const COLLECTOR_POLICY='PROTOTYPE_VISIBLE_DOM_RUN_CONCATENATION_OR_EXPLICIT_TEST_ORIGINS_V1';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const tracerSourceSHA256=sha(readFileSync(new URL('./source-decoration.prototype.mjs',import.meta.url)));
export const collectorSourceSHA256=sha(readFileSync(new URL('./source-fixtures.mjs',import.meta.url)));
export const origin=(run,start,end,decodedStart=0,decodedEnd=run.decoded_text.length,normalization='EXACT_DECODED')=>({normalized_start:start,normalized_end:end,sources:[{run_id:run.id,decoded_start:decodedStart,decoded_end:decodedEnd}],normalization});

/** Explicit synthetic source strings only; no file paths, caches or corpus loader. */
export function bindSynthetic(raw,{id='SYNTHETIC_INLINE',normalizedText,segments}={}) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>2097152||!/^SYNTHETIC_[A-Z0-9_]+$/u.test(id))throw new Error('Bounded explicitly synthetic fixture required');
  const trace=traceNativeDecoration(raw,{maxRawBytes:2097152,maxNodes:20000,maxDecodedCharacters:2097152,maxWorkUnits:268435456,maxMemoryBytes:1073741824});
  let collectorSegments;
  if(segments){if(typeof normalizedText!=='string'||typeof segments!=='function')throw new Error('Explicit test normalization and origin function required');collectorSegments=segments(trace);}
  else {
    normalizedText=trace.runs.map(run=>run.decoded_text).join('');let cursor=0;
    collectorSegments=trace.runs.map(run=>{const start=cursor;cursor+=run.decoded_text.length;return origin(run,start,cursor);});
  }
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256,collectorSourceSHA256});
  verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedTracerSourceSHA256:tracerSourceSHA256,expectedCollectorSourceSHA256:collectorSourceSHA256});
  return Object.freeze({id,source_kind:SOURCE_KIND,collector_policy:COLLECTOR_POLICY,raw,normalizedText,trace,envelope,tracerSourceSHA256,collectorSourceSHA256});
}

export function jointWhitespaceFixture(){
  return bindSynthetic('<p>X<b> \t</b><i>\n </i>Y</p>',{id:'SYNTHETIC_JOINT_WHITESPACE',normalizedText:'X Y',segments:trace=>[
    origin(trace.runs[0],0,1),
    {normalized_start:1,normalized_end:2,sources:trace.runs.slice(1,3).map(run=>({run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'},
    origin(trace.runs[3],2,3)
  ]});
}

export function zeroFixture(){
  return bindSynthetic('<b>\u200b</b><i>A</i><strong>\ufeff</strong><u>B</u><em>\u200b</em>',{id:'SYNTHETIC_ZERO_BOUNDARIES',normalizedText:'AB',segments:trace=>[
    origin(trace.runs[0],0,0,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[1],0,1),
    origin(trace.runs[2],1,1,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[3],1,2),
    origin(trace.runs[4],2,2,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1')
  ]});
}

export function governingFixture({emphasis='b',paddingWords=160}={}){
  if(!['b','strong','i','em'].includes(emphasis)||!Number.isSafeInteger(paddingWords)||paddingWords<80||paddingWords>3000)throw new Error('Finite source-free fixed-fact fixture parameters required');
  // These are declared fictional facts. Tests check availability, not answers.
  const governor='DECLARED SYNTHETIC 11. A fictional operator must not export a record without prior approval.';
  const filler=' A neutral fictional record describes a shelf.'.repeat(Math.ceil(paddingWords/8));
  const focal='The operator requests export of record Q.';
  const exception='A later fictional exception permits an approved export during the stated window.';
  const raw=`<p><${emphasis}>${governor}</${emphasis}></p>\n<p>${filler}</p>\n<p>${focal}</p>\n<p><em>${exception}</em></p>`;
  const fixture=bindSynthetic(raw,{id:`SYNTHETIC_GOVERNING_${emphasis.toUpperCase()}`});
  // Synthetic author position is construction-derived, never text-search origin mapping.
  const start=governor.length+1+filler.length+1,end=start+focal.length;
  if(fixture.normalizedText.slice(start,end)!==focal)throw new Error('Synthetic construction offset differs');
  return {fixture,unit:{id:'SYNTHETIC_FOCAL_Q',start,end},parent:{id:'SYNTHETIC_PARENT_Q',start:0,end:fixture.normalizedText.length},availability:{governor,exception,focal},author_expectations_withheld_from_model:true};
}
