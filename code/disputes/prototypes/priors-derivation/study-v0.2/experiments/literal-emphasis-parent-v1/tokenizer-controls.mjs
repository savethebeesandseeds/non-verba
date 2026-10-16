// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC tokenizer counts, not model/factual-answer evaluation.
import assert from 'node:assert/strict';
import {openPinnedCounters} from './pinned-tokenizers.mjs';
import {bindSynthetic,jointWhitespaceFixture,zeroFixture,governingFixture,origin,sha} from './source-fixtures.mjs';
import {prospectiveForms} from './parent-stream.mjs';
import {TAGS,JOINT,LAYOUT,featureAtom,decodeModelText,digest} from './finite-codec.mjs';
import {preparePrototypeWindows} from './window-planner.mjs';

export const CONTROL_BUDGET=Object.freeze({source_kind:'DECLARED_SYNTHETIC',max_tokens:256,max_global_tokenizer_calls:60000,max_wall_ms:180000,max_rss_bytes:1073741824,long_parent_characters:1107802,long_parent_tokenizer_calls_per_model:512,model_inference:false,factual_answer_evaluation:false});
const whole=f=>prospectiveForms({fixture:f,parent:{id:'SYNTHETIC_P',start:0,end:f.normalizedText.length},unit:{id:'SYNTHETIC_U',start:0,end:f.normalizedText.length}});
function controls(){
  const simple=[
    ['nine_nested',bindSynthetic(TAGS.map(t=>`<${t}>`).join('')+'Q'+[...TAGS].reverse().map(t=>`</${t}>`).join(''))],
    ['recovered',bindSynthetic('<p><b>A<i>B</b>C</i>D</p>')],
    ['weight_style',bindSynthetic('<span style="font-weight:700;font-style:oblique 12deg">fictional words</span>')],
    ['literal_black_bold',bindSynthetic('<font color="Black"><b>FICTIONAL CAPTION</b></font>')],
    ['joint',jointWhitespaceFixture()],['zero',zeroFixture()],
    ['emoji',bindSynthetic('<b>'+('😀 fictional '.repeat(150))+'</b>')],
    ['cjk',bindSynthetic('<i>'+('虚構記録'.repeat(200))+'</i>')],
    ['long_word',bindSynthetic('<em>'+('abc_'.repeat(1500))+'</em>')],
    ['escaped_markers',bindSynthetic('<strong>[NF b] \\ [/NF] 😀 literal [</strong>')],
    ['long_css',bindSynthetic('<span style="font-weight:700;'+('font-family:Fictional;'.repeat(1000))+'">Q</span>')],
    ['nfc',bindSynthetic('<em>e\u0301😀</em>',{id:'SYNTHETIC_NFC',normalizedText:'é😀',segments:t=>[origin(t.runs[0],0,3,0,t.runs[0].decoded_text.length,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1')]})]
  ].map(([id,fixture])=>({id,forms:whole(fixture)}));
  for(const emphasis of ['b','strong','i','em'])simple.push({id:'governing_'+emphasis,forms:prospectiveForms(governingFixture({emphasis}))});
  return simple;
}

export async function measureSyntheticTokenizers(){
  const started=performance.now(),opened=await openPinnedCounters(),cases=controls();let globalCalls=0,peakRSS=process.memoryUsage().rss;
  const check=()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);if(globalCalls>=CONTROL_BUDGET.max_global_tokenizer_calls||performance.now()-started>CONTROL_BUDGET.max_wall_ms||peakRSS>CONTROL_BUDGET.max_rss_bytes)throw Object.assign(new Error('Declared global synthetic tokenizer budget exhausted'),{code:'PROTOTYPE_CONTROL_RESOURCE_BOUND',retained_failure:true,global_tokenizer_calls:globalCalls,elapsed_ms:performance.now()-started,peak_sampled_rss_bytes:peakRSS});};
  const modelReports=[];
  for(const base of opened.counters){
    const counter={...base,tokenCount:text=>{check();globalCalls++;return base.tokenCount(text);}};
    let atomCases=0,maximumAtomTokens=0;const atomFailures=[];
    for(let mask=0;mask<4096;mask++)if(!(mask&JOINT)||!(mask&511))for(const literal of ['Q','😀','中','[','\\','é']){
      const atom=featureAtom(literal,mask);assert.equal(decodeModelText(atom),literal);const tokens=counter.tokenCount(atom);atomCases++;maximumAtomTokens=Math.max(maximumAtomTokens,tokens);if(tokens>256)atomFailures.push({mask,literal_sha256:sha(literal),tokens});
    }
    const layout=featureAtom(' | ',LAYOUT),layoutTokens=counter.tokenCount(layout);atomCases++;maximumAtomTokens=Math.max(maximumAtomTokens,layoutTokens);if(layoutTokens>256)atomFailures.push({mask:LAYOUT,literal_sha256:sha(' | '),tokens:layoutTokens});
    const rows=[];
    for(const item of cases)for(const form of ['unit','parent']){
      const input=item.forms[form];
      try{const result=preparePrototypeWindows(input,counter);assert.equal(result.windows.map(w=>decodeModelText(w.text)).join(''),input.normalizedText.slice(input.start,input.end));rows.push({case:item.id,form,status:result.status,source_range:result.source_range,descriptor_sha256:digest(item.forms.descriptor),feature_sha256:input.binding.feature_sha256,window_count:result.windows.length,fallback_used:result.fallback_used,maximum_window_tokens:Math.max(...result.windows.map(w=>w.tokens)),encoded_windows_sha256:digest(result.windows.map(w=>({range:w.source_range,sha256:w.sha256,tokens:w.tokens,zero_events:w.zero_events}))),work:result.work,source_literal_coverage:true});}
      catch(error){rows.push({case:item.id,form,status:'RETAINED_FAILURE',code:error.code??'UNEXPECTED_CONTROL_ERROR',error_sha256:sha(error.message),work:error.work??null});}
    }
    // Separate explicitly bounded stress, not a universal full-parent pass.
    const total=CONTROL_BUDGET.long_parent_characters,prefix='DECLARED SYNTHETIC: a prior prohibition is retained as source. ',focal='A fictional focal record near the end.',filler='neutral fictional fact. ',fill=filler.repeat(Math.ceil((total-prefix.length-focal.length)/filler.length)).slice(0,total-prefix.length-focal.length),fixture=bindSynthetic(`<p><b>${prefix}</b>${fill}<i>${focal}</i></p>`,{id:'SYNTHETIC_LONG_PARENT_1107802'}),forms=prospectiveForms({fixture,parent:{id:'SYNTHETIC_LONG_PARENT',start:0,end:total},unit:{id:'SYNTHETIC_LATE_UNIT',start:total-focal.length,end:total}});
    const sameParent=prospectiveForms({fixture,parent:{id:'SYNTHETIC_LONG_PARENT',start:0,end:total},unit:{id:'SYNTHETIC_SECOND_UNIT',start:0,end:20}});
    const stress={source_characters:total,source_sha256:sha(fixture.normalizedText),rich_input_eligibility:fixture.envelope.input_eligibility,parent_source_range:forms.parent.binding.source_range,focal_source_range:forms.unit.binding.source_range,complete_parent_in_descriptor:true,dependency_completeness_verified:false,same_parent_different_focal_encoded_text_sha256_equal:sha(forms.parent.encodeWindow().text)===sha(sameParent.parent.encodeWindow().text),pooling_or_dilution_validated:false,declared_tokenizer_call_budget:CONTROL_BUDGET.long_parent_tokenizer_calls_per_model};
    try{const result=preparePrototypeWindows(forms.parent,counter,{maxTokenizerCalls:CONTROL_BUDGET.long_parent_tokenizer_calls_per_model});Object.assign(stress,{status:result.status,window_count:result.windows.length,work:result.work,source_literal_coverage:result.source_literal_coverage});}
    catch(error){Object.assign(stress,{status:'RETAINED_FAILURE',code:error.code??'UNEXPECTED_CONTROL_ERROR',error_sha256:sha(error.message),work:error.work??null,partial_stream_accepted:false,full_parent_encoding_feasibility_verified:false});}
    modelReports.push({tokenizer_policy:base.policy,tokenizer_policy_sha256:base.policy_sha256,finite_atom_cases:atomCases,maximum_atom_tokens:maximumAtomTokens,atom_failures:atomFailures,controls:rows,large_parent_stress:stress});
  }
  return {schema:'prototype-nine-tag-pinned-tokenizer-controls-v1',status:'SYNTHETIC_MEASUREMENT_ONLY_UNADOPTED',authority:'NONE',budget:CONTROL_BUDGET,bindings:opened.bindings,models:modelReports,elapsed_ms:performance.now()-started,global_tokenizer_calls:globalCalls,peak_sampled_rss_bytes:peakRSS,all_nonstress_controls_fit:modelReports.every(m=>m.atom_failures.length===0&&m.controls.every(r=>r.status!=='RETAINED_FAILURE')),stress_failures_retained:true,source_quality_passed:false,adopted:false,model_inference:false,factual_answer_evaluation:false,corpus_opened:false};
}
