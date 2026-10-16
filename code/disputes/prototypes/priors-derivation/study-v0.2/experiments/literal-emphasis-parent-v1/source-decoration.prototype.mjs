// SPDX-License-Identifier: AGPL-3.0-only
// Standalone prototype. Integration with extraction, readers and model windows
// requires a separately versioned method; this module changes no source text.
import {createHash} from 'node:crypto';
import {Parser} from 'parse5';

export const NATIVE_DECORATION_POLICY = 'PROTOTYPE_LITERAL_EMPHASIS_NATIVE_TRACE_V1_UNADOPTED';
export const NATIVE_DECORATION_INPUT_POLICY = 'PROTOTYPE_RICH_LITERAL_EMPHASIS_WINDOW_V1_UNADOPTED';
export const LEGACY_SGML_PROFILE = 'LEGACY_SEC_SGML_LITERAL_TAGS_V1';
const OMIT = new Set(['head','script','style','template','noscript','svg','canvas','iframe','object','embed']);
const NATIVE = new Set(['strike','s','del','ins','u','b','strong','i','em']);
// This allowlist classifies literal property names for compact model inputs.
// It does not claim their computed appearance, inheritance or legal relevance.
// Unknown syntax/properties, CSS escapes and dynamic values stay in the input.
const NONDECORATION_STYLE_PROPERTIES = new Set(['font-family','font-size','font-variant','font-stretch','line-height','text-align','text-indent','vertical-align','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','width','min-width','max-width','height','min-height','max-height','page-break-before','page-break-after','page-break-inside']);
const DECORATION_PROPERTY = /^text-decoration(?:-[a-z]+)*$/u;
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => sha(canonical(value));
const normalize = value => value.normalize('NFC').replace(/[\u200B\uFEFF]/gu,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu,'').replace(/\s+/gu,' ').trim();
function problem(code,message) {const error=new Error(message);error.code=code;return error;}
function integer(value, low, high, name) {if(!Number.isSafeInteger(value)||value<low||value>high)throw problem('NATIVE_DECORATION_INVALID_COORDINATE',`Invalid ${name}`);return value;}
function range(start,end,length,{empty=false}={}) {integer(start,0,length,'start');integer(end,start+(empty?0:1),length,'end');}
function seal(body) {return {...body,sha256:digest(body)};}
function checkedSeal(value) {const {sha256,...body}=value??{};if(typeof sha256!=='string'||digest(body)!==sha256)throw new Error('Decoration envelope digest differs');return value;}
function boundText(value,source,name) {if(typeof source!=='string'||value.sha256!==sha(source)||value.characters!==source.length||value.bytes!==undefined&&value.bytes!==Buffer.byteLength(source))throw problem('NATIVE_DECORATION_SOURCE_BINDING',`${name} binding differs`);}
function pointBoundary(text,offset) {return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/u.test(text[offset-1])&&/[\uDC00-\uDFFF]/u.test(text[offset]));}
function hidden(attrs) {return attrs.has('hidden')||attrs.get('aria-hidden')==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/iu.test(attrs.get('style')??'');}
function methodIdentity(value,name) {if(value!==undefined&&value!==null&&(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value)))throw problem('NATIVE_DECORATION_INVALID_METHOD_IDENTITY',`Invalid ${name} identity`);return value??null;}
function checkedCollectorIssues(value,rawLength,normalizedLength) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>1000)throw new Error('Bounded collector issues required');
  return value.map(item=>{
    const input=typeof item==='string'?{code:item}:item;
    if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['code','component','raw_range','normalized_range','count'].includes(key))||typeof input.code!=='string'||!/^[A-Z][A-Z0-9_]{2,95}$/u.test(input.code))throw new Error('Machine collector issue code required');
    const result={code:input.code};
    if(input.component!==undefined){if(!['collector','tracer','legacy_profile','identity','normalization'].includes(input.component))throw new Error('Unsupported collector issue component');result.component=input.component;}
    for(const [key,length] of [['raw_range',rawLength],['normalized_range',normalizedLength]])if(input[key]!==undefined){const pair=input[key];if(!pair||Object.keys(pair).some(k=>!['start','end'].includes(k)))throw new Error('Collector issue range required');range(pair.start,pair.end,length,{empty:true});result[key]={start:pair.start,end:pair.end};}
    if(input.count!==undefined)result.count=integer(input.count,0,1000000,'collector issue count');
    return result;
  });
}

// Split declarations without interpreting a cascade or delimiters inside CSS
// comments, quoted strings or functions. Literal values remain source evidence.
function literalDeclarations(style) {
  const pieces=[];let start=0,quote=null,depth=0,comment=false;
  for(let i=0;i<=style.length;i++) {
    const c=style[i],next=style[i+1];
    if(comment){if(c==='*'&&next==='/'){comment=false;i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
    if(c==='/'&&next==='*'){comment=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')depth++;else if(c===')')depth=Math.max(0,depth-1);
    if(c===';'&&!depth){pieces.push(style.slice(start,i));start=i+1;}
  }
  pieces.push(style.slice(start));
  const declarations=pieces.filter(value=>value.trim()).map(literal=>{const m=/^\s*([a-z-]+)\s*:\s*([\s\S]*?)\s*$/iu.exec(literal.replace(/\/\*[\s\S]*?\*\//gu,' '));return {property:m?.[1].toLowerCase()??null,value:m?.[2]??null,literal};});
  return {declarations,syntax_unresolved:Boolean(quote||comment||depth||declarations.some(d=>d.property===null))};
}
function inputRelevance(tag,parsed) {
  if(NATIVE.has(tag))return 'NATIVE_MARK';
  if(parsed.declarations.some(d=>/^(?:font|font-weight|font-style)$/u.test(d.property??'')))return 'LITERAL_EMPHASIS_DECLARATION_EFFECT_UNVERIFIED';
  if(parsed.declarations.some(d=>DECORATION_PROPERTY.test(d.property??'')))return 'DECORATION_DECLARATION';
  if(parsed.syntax_unresolved||parsed.declarations.some(d=>!NONDECORATION_STYLE_PROPERTIES.has(d.property)||/[\\]|\b(?:var|env|expression|url|attr)\s*\(/iu.test(d.value??'')))return 'UNRESOLVED_CSS';
  return 'NONDECORATION_STYLE_METADATA';
}

/** These routing regexes deliberately match the frozen collector, including
 * its exact bare framing-tag test. This is not an HTML detector improvement.
 */
export function legacySgmlProfileApplies(raw,recordFormat='text') {
  if(typeof raw!=='string'||!['html','text'].includes(recordFormat))throw new Error('Literal source and record format required');
  return recordFormat==='text'&&/<DOCUMENT>|<TEXT>|<TABLE>/i.test(raw)&&!/<(?:html|body|p|div|pre|h[1-6]|tr|td|br|img|script|style|template)\b/iu.test(raw);
}

function legacyTrace(raw,rawBinding,maxNodes) {
  if(!legacySgmlProfileApplies(raw))throw problem('NATIVE_DECORATION_LEGACY_ROUTE_MISMATCH','Legacy decoration profile requires the exact frozen collector route');
  const runs=[],ledger=[];let cursor=0,count=0;
  const rawRange=(start,end)=>({start,end,sha256:sha(raw.slice(start,end))});
  const note=entry=>{if(++count>maxNodes)throw problem('NATIVE_DECORATION_LEGACY_LEDGER_BOUND','Legacy decoration ledger bound exceeded; no partial trace emitted');ledger.push(entry);};
  function append(start,end) {
    if(start===end)return;
    const chunk=raw.slice(start,end);
    for(const marker of chunk.matchAll(/<\/?(?:DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE|CAPTION|S|C)\b[^>]*>/giu))note({kind:'LEGACY_FRAMING_TO_NEWLINE',raw:rawRange(start+marker.index,start+marker.index+marker[0].length),output:'LF_BEFORE_SINGLE_PRE_DECODING'});
    const stripped=chunk.replace(/<\/?(?:DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE|CAPTION|S|C)\b[^>]*>/giu,'\n');
    const escaped=stripped.replace(/</gu,'&lt;').replace(/>/gu,'&gt;');
    // Exactly one PRE pass per TABLE-delimited append chunk. Decoding each
    // marker/literal separately would wrongly repeat PRE's first-LF rule.
    const parser=new Parser();parser.tokenizer.write(`<pre>${escaped}</pre>`,true);
    const parts=[],pending=[{node:parser.document,depth:0}];
    while(pending.length){const {node,depth}=pending.pop();if(depth>256)throw problem('NATIVE_DECORATION_LEGACY_DECODER_DEPTH','Legacy decoder depth exceeded');if(OMIT.has(node.tagName))continue;if(node.nodeName==='#text')parts.push(node.value??'');const children=node.childNodes??[];for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],depth:depth+1});}
    const decoded=parts.join(''),interval=rawRange(start,end);
    note({kind:'LEGACY_SINGLE_PRE_DECODE',raw:interval,angle_escape_applied:true,pre_first_lf_rule:'ONCE_PER_TABLE_DELIMITED_CHUNK',decoded_sha256:sha(decoded),decoded_characters:decoded.length});
    runs.push({id:`run:${start}-${end}`,raw:interval,decoded_text:decoded,decoded_sha256:sha(decoded),path_id:null,origin_transform:LEGACY_SGML_PROFILE});
  }
  for(const marker of raw.matchAll(/<\/?TABLE\b[^>]*>/giu)){append(cursor,marker.index);note({kind:'LEGACY_TABLE_APPEND_BOUNDARY',raw:rawRange(marker.index,marker.index+marker[0].length),closing:/^<\//u.test(marker[0]),output:'STRUCTURAL_BOUNDARY_NO_INVENTED_SOURCE_TEXT'});cursor=marker.index+marker[0].length;}
  append(cursor,raw.length);
  return seal({schema:'native-source-decoration-trace-v2',policy:NATIVE_DECORATION_POLICY,format:'legacy-sgml',source_profile:LEGACY_SGML_PROFILE,trace_status:'AVAILABLE_SOURCE_NATIVE_TRACE',raw:rawBinding,sources:[],paths:[],runs,transform_ledger:ledger,unresolved:[],parser_errors:[],source_origin_backend:'EXACT_LEGACY_RAW_CHUNKS_AND_FRAMING_LEDGER_V1',native_markup_interpretation:'UNKNOWN_TAGS_RETAINED_AS_LITERAL_TEXT_NOT_HTML; S_AND_C_ARE_LEGACY_FRAMING',normalized_mapping_status:'UNBOUND_REQUIRES_EXTRACTOR_COLLECTOR_ORIGIN',computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,authority:'NONE'});
}

/** Raw locations are decoded-string UTF16 offsets, never raw byte offsets.
 * DOM recovery/style sources are evidence, not computed display or legal edits.
 * Shared ancestor paths avoid copying ancestry into every text run. Element
 * hashing is bounded by the explicit maximum depth, never an unbounded search.
 */
export function traceNativeDecoration(raw,{format='html',maxRawBytes=4*1024*1024,maxDepth=256,maxNodes=1000000,visibilityProfile='COMPLETE_VISIBLE_DOM_V1',maxDecodedCharacters=maxRawBytes,maxWorkUnits=maxRawBytes*128,maxMemoryBytes=4*1024*1024*1024}={}) {
  if(typeof raw!=='string'||!['html','text','legacy-sgml'].includes(format))throw problem('NATIVE_DECORATION_INVALID_SOURCE','Literal raw source and format required');
  integer(maxRawBytes,1024,64*1024*1024,'raw bound');integer(maxDepth,1,256,'depth bound');integer(maxNodes,1,1000000,'node bound');integer(maxDecodedCharacters,1,64*1024*1024,'decoded character bound');integer(maxWorkUnits,1,16*1024*1024*1024,'work bound');integer(maxMemoryBytes,1,64*1024*1024*1024,'memory bound');
  if(!['COMPLETE_VISIBLE_DOM_V1','COLLECTOR_BODY_RELATIVE_VISIBLE_DEPTH_V1'].includes(visibilityProfile))throw problem('NATIVE_DECORATION_VISIBILITY_PROFILE','Explicit supported visible source profile required');
  if(Buffer.byteLength(raw)>maxRawBytes)throw problem('NATIVE_DECORATION_RAW_BOUND','Decoration source exceeds explicit raw bound');
  let workUnits=0,nextMemoryCheck=0,decodedCharacters=0,documentNodes=0,maxNativeAncestors=0;
  const checkMemory=()=>{if(process.memoryUsage().rss>maxMemoryBytes)throw problem('NATIVE_DECORATION_MEMORY_BOUND','Decoration memory bound exceeded; no partial trace emitted');};
  const finishTrace=body=>{checkMemory();const result=seal(body);checkMemory();return result;};
  const charge=(count=1)=>{workUnits+=count;if(workUnits>maxWorkUnits)throw problem('NATIVE_DECORATION_WORK_BOUND','Decoration work bound exceeded; no partial trace emitted');if(workUnits>=nextMemoryCheck){checkMemory();nextMemoryCheck=workUnits+2048;}};
  charge(raw.length*2+1);
  const sources=[],paths=[],runs=[],unresolved=[],errors=[],pathDepths=new Map();let nodes=0;
  const rawBinding={sha256:sha(raw),characters:raw.length,bytes:Buffer.byteLength(raw),offset_basis:'UTF16_IN_DECODED_RAW_SOURCE_NOT_BYTES'};
  const rawRange=(start,end)=>{range(start,end,raw.length,{empty:true});charge(end-start+1);return {start,end,sha256:sha(raw.slice(start,end))};};
  const artifactRange=(start,end)=>{range(start,end,raw.length,{empty:true});return {start,end,raw_sha256:rawBinding.sha256,binding:'WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'};};
  const resources=()=>({policy:'RAW_NODE_DECODED_WORK_RSS_BOUNDED_NATIVE_TRACE_V1',max_raw_bytes:maxRawBytes,max_nodes:maxNodes,max_decoded_characters:maxDecodedCharacters,max_work_units:maxWorkUnits,max_memory_bytes:maxMemoryBytes,document_nodes:documentNodes,visited_nodes:nodes,decoded_characters:decodedCharacters,charged_work_units:workUnits,element_interval_binding:'WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'});
  if(format==='legacy-sgml'){charge(raw.length*8);const {sha256:ignored,...body}=legacyTrace(raw,rawBinding,maxNodes);decodedCharacters=body.runs.reduce((n,r)=>n+r.decoded_text.length,0);if(decodedCharacters>maxDecodedCharacters)throw problem('NATIVE_DECORATION_DECODED_OUTPUT_BOUND','Decoration decoded output bound exceeded; no partial trace emitted');return finishTrace({...body,resource_profile:resources()});}
  // Track the actual parser token's attribute object. HTML may merge a later
  // BODY/HTML token's attributes into an implicit or earlier element, whose
  // node location therefore cannot identify that attribute's source. Object
  // identity through parse5's adoption preserves exact token provenance; no
  // value/substring/first-occurrence lookup is involved.
  const attributeOrigins=new WeakMap(),tokenOrigins=new WeakMap(),elementOrigins=new WeakMap(),styleDeclarations=new WeakMap(),attributeEvidence=new WeakMap(),sourceRecords=new Map();let tree=null;
  if(format==='html') {
    const parser=new Parser({sourceCodeLocationInfo:true,onParseError:error=>{if(errors.length<1000)errors.push({code:error.code,start:error.startOffset??null,end:error.endOffset??null});}});
    // The pinned parser reconstructs active formatting elements and performs
    // adoption-agency replacements with the ORIGINAL token.attrs array. This
    // includes empty arrays: native U/STRIKE need no style attribute. Capture
    // that object identity at createElement, not a copied/repeated node range.
    const adapter=parser.treeAdapter;
    parser.treeAdapter={...adapter,createElement(tagName,namespaceURI,attrs){charge();const node=adapter.createElement(tagName,namespaceURI,attrs),origin=tokenOrigins.get(attrs);if(origin){elementOrigins.set(node,{origin,reconstructed:origin.elements++>0});}return node;}};
    const original=parser.onStartTag.bind(parser);
    parser.onStartTag=token=>{charge(1+token.attrs.length);let origin=tokenOrigins.get(token.attrs);if(!origin){origin={tag:token.tagName,tag_range:token.location,elements:0};tokenOrigins.set(token.attrs,origin);}for(const attr of token.attrs)attributeOrigins.set(attr,{...origin,token_origin:origin,decoded_value:attr.value,attribute_range:token.location?.attrs?.[attr.name]??null});return original(token);};
    parser.tokenizer.write(raw,true);tree=parser.document;
    const inventory=[tree];while(inventory.length){charge();if(++documentNodes>maxNodes)throw problem('NATIVE_DECORATION_NODE_BOUND','Decoration node bound exceeded; no partial trace emitted');const node=inventory.pop();for(const child of node.childNodes??[])inventory.push(child);if(node.content)inventory.push(node.content);}
  }
  // The literal collector begins at BODY depth zero. Document/HTML ancestors
  // still supply native styles, but do not consume its visible-depth budget.
  // A deeper visible frontier is retained as explicit incomplete evidence;
  // it must not discard every otherwise traceable source run in the document.
  const body=tree?.childNodes?.find(node=>node.tagName==='html')?.childNodes?.find(node=>node.tagName==='body');
  const depthProfile={policy:visibilityProfile,root:body?'PARSED_BODY':'DOCUMENT_FALLBACK',max_visible_depth:visibilityProfile==='COMPLETE_VISIBLE_DOM_V1'?null:maxDepth,structural_ancestor_nodes:body?2:0,max_native_ancestor_sources:1};
  const pending=tree?[{node:tree,depth:0,visibleDepth:body?null:0,path:null,omitted:false,headMetadata:false}]:[];
  if(format==='text'&&raw){decodedCharacters=raw.length;if(decodedCharacters>maxDecodedCharacters)throw problem('NATIVE_DECORATION_DECODED_OUTPUT_BOUND','Decoration decoded output bound exceeded; no partial trace emitted');charge(raw.length);runs.push({id:`run:0-${raw.length}`,raw:rawRange(0,raw.length),decoded_text:raw,decoded_sha256:sha(raw),path_id:null});}
  while(pending.length) {
    charge();const item=pending.pop(),{node,depth,path,omitted,headMetadata}=item,visibleDepth=node===body?0:item.visibleDepth;if(++nodes>maxNodes)throw problem('NATIVE_DECORATION_NODE_BOUND','Decoration node bound exceeded; no partial trace emitted');
    const tag=node.tagName,loc=node.sourceCodeLocation;let evidence=node.attrs&&attributeEvidence.get(node.attrs);if(!evidence){const attrs=new Map((node.attrs??[]).map(a=>[a.name,a.value]));charge(1+attrs.size+(attrs.get('style')?.length??0));evidence={attrs,hidden:hidden(attrs)};if(node.attrs)attributeEvidence.set(node.attrs,evidence);}const attrs=evidence.attrs;
    // Stylesheets are unresolved document evidence, never visible text runs or
    // source-native change annotations. Hidden/inert descendants stay omitted.
    if((!omitted||headMetadata)&&(tag==='style'||tag==='link'&&/\bstylesheet\b/iu.test(attrs.get('rel')??''))&&loc)unresolved.push({kind:'STYLESHEET_CASCADE_NOT_COMPUTED',raw:rawRange(loc.startOffset,loc.endOffset)});
    const isOmitted=omitted||OMIT.has(tag)||evidence.hidden;
    if(isOmitted){if(tag==='head'){const children=node.childNodes??[];for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],depth:depth+1,visibleDepth:null,path:null,omitted:true,headMetadata:true});}continue;}
    if(visibilityProfile==='COLLECTOR_BODY_RELATIVE_VISIBLE_DEPTH_V1'&&visibleDepth!==null&&visibleDepth>maxDepth){const origin=elementOrigins.get(node)?.origin,start=origin?.tag_range??loc?.startTag;unresolved.push({kind:'COLLECTOR_DEPTH_SCOPE_UNTRACED',tag:tag??node.nodeName,body_relative_depth:visibleDepth,max_depth:maxDepth,raw:start?rawRange(start.startOffset,start.endOffset):node.nodeName==='#text'&&loc?rawRange(loc.startOffset,loc.endOffset):null,parser_reported_scope:loc?{start:loc.startOffset,end:loc.endOffset,raw_interval_verified:false}:null,scope:'VISIBLE_FRONTIER_DESCENDANTS_NOT_TRACED_NOT_EXCLUDED_OR_COMPLETE'});continue;}
    let childPath=path;
    const styleObject=(node.attrs??[]).find(attr=>attr.name==='style');let parsed=styleObject&&styleDeclarations.get(styleObject);
    if(!parsed){charge((attrs.get('style')?.length??0)*4+1);parsed=literalDeclarations(attrs.get('style')??'');parsed.decorationDeclarations=parsed.declarations.filter(d=>DECORATION_PROPERTY.test(d.property??''));if(styleObject)styleDeclarations.set(styleObject,parsed);}const declarations=parsed.decorationDeclarations;
    // Keep every literal inline-style source, including unknown/escaped CSS.
    // Recognizing a declaration is not a prerequisite for preserving it.
    if(tag&&(NATIVE.has(tag)||attrs.has('style'))) {
      const origin=styleObject&&attributeOrigins.get(styleObject),elementOrigin=elementOrigins.get(node);
      const sourceToken=origin?.tag===tag&&origin.decoded_value===attrs.get('style')?origin:null;
      const originalToken=sourceToken?.token_origin??(elementOrigin?.origin.tag===tag?elementOrigin.origin:null),reconstructed=Boolean(elementOrigin?.reconstructed);
      const literalStart=sourceToken?.tag_range??originalToken?.tag_range??loc?.startTag;
      if(!literalStart){unresolved.push({kind:'RECOVERED_MARK_WITHOUT_LITERAL_START_TAG',tag});}
      else {
        const start=literalStart.startOffset,end=literalStart.endOffset,id=`mark:${start}-${end}`;
        const attribute=sourceToken?.attribute_range??loc?.attrs?.style,elementLocated=Boolean(loc?.startTag)&&!reconstructed,merged=Boolean(!reconstructed&&sourceToken&&(!elementLocated||start!==loc.startTag.startOffset));
        if(attrs.has('style')&&!attribute)unresolved.push({kind:'STYLE_ATTRIBUTE_WITHOUT_LITERAL_SOURCE_RANGE',tag});
        const scope={id:`scope:${paths.length}`,kind:reconstructed?'PARSER_RECONSTRUCTED_FORMATTING_DOM_DESCENDANTS':elementLocated?'PARSED_DOM_ELEMENT_WITH_RAW_RANGE':'PARSER_RECOVERED_DOM_DESCENDANTS',raw_interval_verified:elementLocated,element:elementLocated?artifactRange(loc.startOffset,loc.endOffset):null,element_start_tag:elementLocated?rawRange(loc.startTag.startOffset,loc.startTag.endOffset):null,end_tag:elementLocated&&loc.endTag?rawRange(loc.endTag.startOffset,loc.endTag.endOffset):null,...(reconstructed?{parser_reported_location:loc?{start:loc.startOffset,end:loc.endOffset,raw_interval_verified:false}:null,source_origin:'PARSE5_ORIGINAL_START_TOKEN_ATTRS_ARRAY_IDENTITY'}:{})};
        let record=sourceRecords.get(id);
        if(record&&(!originalToken||record.originalToken!==originalToken||record.source.tag!==tag))unresolved.push({kind:'RECOVERED_DUPLICATE_RAW_ORIGIN',id});
        else {
          childPath=`path:${paths.length}`;const nativeDepth=(pathDepths.get(path)??0)+1;pathDepths.set(childPath,nativeDepth);maxNativeAncestors=Math.max(maxNativeAncestors,nativeDepth);const link={id:childPath,parent_id:path,source_id:id};paths.push(link);
          if(!record){const source={id,tag,element:scope.element,start_tag:rawRange(start,end),element_start_tag:scope.element_start_tag,start_tag_role:merged?'ATTRIBUTE_ADOPTION_SOURCE_TOKEN':'ELEMENT_START_TAG',element_scope:{kind:scope.kind,raw_interval_verified:elementLocated,attribute_adoption:merged,source_origin:sourceToken?'PARSE5_START_TOKEN_ATTRIBUTE_OBJECT_IDENTITY':'NODE_SOURCE_LOCATION'},end_tag:scope.end_tag,native_tag:NATIVE.has(tag)?tag:null,style_attribute:attribute?{...rawRange(attribute.startOffset,attribute.endOffset),decoded_value:attrs.get('style')}:null,declarations,style_declarations:parsed.declarations,input_relevance:inputRelevance(tag,parsed),computed_style_verified:false,effectiveness_verified:false};sources.push(source);record={source,originalToken,firstScope:scope,firstLink:link};sourceRecords.set(id,record);}
          // One literal token may govern several reconstructed DOM elements.
          // The shared source has NO single verified raw parent interval. Keep
          // each parsed scope, and bind its path to only that DOM occurrence.
          if(reconstructed||record.source.dom_scopes){const source=record.source;if(!source.dom_scopes){source.dom_scopes=[];source.element=null;source.end_tag=null;source.element_scope={kind:'SHARED_LITERAL_SOURCE_WITH_PARSER_RECONSTRUCTED_DOM_SCOPES',raw_interval_verified:false,attribute_adoption:false,source_origin:'PARSE5_ORIGINAL_START_TOKEN_ATTRS_ARRAY_IDENTITY'};source.start_tag_role='SHARED_ORIGINAL_FORMATTING_SOURCE_TOKEN';if(record.firstScope!==scope){source.dom_scopes.push(record.firstScope);record.firstLink.dom_scope_id=record.firstScope.id;}}source.dom_scopes.push(scope);link.dom_scope_id=scope.id;}
        }
      }
    }
    if(node.nodeName==='#text'&&node.value) {
      if(!loc){unresolved.push({kind:'VISIBLE_TEXT_WITHOUT_RAW_LOCATION'});continue;}
      decodedCharacters+=node.value.length;if(decodedCharacters>maxDecodedCharacters)throw problem('NATIVE_DECORATION_DECODED_OUTPUT_BOUND','Decoration decoded output bound exceeded; no partial trace emitted');charge(node.value.length*2+1);
      runs.push({id:`run:${loc.startOffset}-${loc.endOffset}`,raw:rawRange(loc.startOffset,loc.endOffset),decoded_text:node.value,decoded_sha256:sha(node.value),path_id:childPath});
    }
    const children=node.childNodes??[];
    for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],depth:depth+1,visibleDepth:visibleDepth===null?null:visibleDepth+1,path:childPath,omitted:false,headMetadata:false});
  }
  const ids=new Set();for(const item of [...sources,...runs]){if(ids.has(item.id))unresolved.push({kind:'RECOVERED_DUPLICATE_RAW_ORIGIN',id:item.id});ids.add(item.id);}
  depthProfile.max_native_ancestor_sources=Math.max(1,maxNativeAncestors);
  return finishTrace({schema:'native-source-decoration-trace-v2',policy:NATIVE_DECORATION_POLICY,format,trace_status:'AVAILABLE_SOURCE_NATIVE_TRACE',raw:rawBinding,sources,paths,runs,unresolved,parser_errors:errors,depth_profile:depthProfile,resource_profile:resources(),source_origin_backend:'PINNED_PARSE5_START_TOKEN_ATTRIBUTE_AND_FORMATTING_ATTRS_ARRAY_IDENTITY_V2',normalized_mapping_status:'UNBOUND_REQUIRES_EXTRACTOR_COLLECTOR_ORIGIN',computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,authority:'NONE'});
}

/** Collector segments are source-origin statements, not substring searches.
 * {normalized_start, normalized_end, sources:[{run_id,decoded_start,decoded_end}],
 *  normalization:'EXACT_DECODED'|'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'|
 *                'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'|
 *                'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1'}.
 * Multi-run normalization retains joint evidence. Identical-path whitespace
 * has exact shared ancestry; different-path whitespace has a separate complete
 * evidence status and requires ordered origin witnesses before model use.
 * Neither policy chooses an individual surviving source whitespace character.
 */
export function bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256,collectorSourceSHA256,collectorIssues}={}) {
  checkedSeal(trace);boundText(trace.raw,raw,'Raw source');
  if(trace.schema!=='native-source-decoration-trace-v2'||trace.policy!==NATIVE_DECORATION_POLICY||!['AVAILABLE_SOURCE_NATIVE_TRACE','UNAVAILABLE_SOURCE_NATIVE_TRACE'].includes(trace.trace_status)||typeof normalizedText!=='string')throw problem('NATIVE_DECORATION_TRACE_SCOPE','Current trace and normalized source required');
  const tracerIdentity=methodIdentity(tracerSourceSHA256,'tracer'),collectorIdentity=methodIdentity(collectorSourceSHA256,'collector'),issues=checkedCollectorIssues(collectorIssues,raw.length,normalizedText.length);
  const identityStatus=tracerIdentity&&collectorIdentity?'CURRENT_METHOD_BINDINGS_SUPPLIED':'UNBOUND_MISSING_CURRENT_METHOD_IDENTITIES';
  if(collectorSegments!==undefined&&!Array.isArray(collectorSegments))throw new Error('Collector source segments must be an array');
  const byId=new Map(trace.runs.map(run=>[run.id,run])),ordinals=new Map(trace.runs.map((run,i)=>[run.id,i])),coverage=new Map(),segments=[],unmappedNormalized=[];let priorEnd=0,priorOrdinal=-1,priorDecodedEnd=0;
  for(const segment of collectorSegments??[]) {
    const {normalized_start:start,normalized_end:end,sources,normalization}=segment;
    range(start,end,normalizedText.length,{empty:true});if(start<priorEnd||!pointBoundary(normalizedText,start)||!pointBoundary(normalizedText,end)||!Array.isArray(sources)||!sources.length)throw problem('NATIVE_DECORATION_NORMALIZED_RANGE','Collector normalized ranges overlap or split a codepoint');if(!/^[\s|]*$/u.test(normalizedText.slice(priorEnd,start)))unmappedNormalized.push({start:priorEnd,end:start});priorEnd=end;
    if(!['EXACT_DECODED','EXTRACTOR_NFC_FILTER_WHITESPACE_V1','EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1','EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1'].includes(normalization))throw problem('NATIVE_DECORATION_NORMALIZATION_PROFILE','Unknown collector normalization');
    const origins=sources.map(part=>{const run=byId.get(part.run_id);if(!run)throw problem('NATIVE_DECORATION_UNKNOWN_RUN','Unknown collector raw run');range(part.decoded_start,part.decoded_end,run.decoded_text.length);if(!pointBoundary(run.decoded_text,part.decoded_start)||!pointBoundary(run.decoded_text,part.decoded_end))throw problem('NATIVE_DECORATION_SOURCE_CODEPOINT','Collector origin splits a codepoint');const ordinal=ordinals.get(run.id);if(ordinal<priorOrdinal||ordinal===priorOrdinal&&part.decoded_start<priorDecodedEnd)throw problem('NATIVE_DECORATION_SOURCE_ORDER','Collector DOM source origin reused or out of order');priorOrdinal=ordinal;priorDecodedEnd=part.decoded_end;if(!coverage.has(run.id))coverage.set(run.id,[]);coverage.get(run.id).push([part.decoded_start,part.decoded_end]);return {run_id:run.id,decoded_start:part.decoded_start,decoded_end:part.decoded_end,decoded_sha256:sha(run.decoded_text.slice(part.decoded_start,part.decoded_end))};});
    const decoded=origins.map(p=>byId.get(p.run_id).decoded_text.slice(p.decoded_start,p.decoded_end)).join(''),filtered=normalization==='EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1',whitespace=filtered||normalization==='EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1',filterEvents=[];
    if(filtered)for(const part of origins){const value=byId.get(part.run_id).decoded_text.slice(part.decoded_start,part.decoded_end);for(const match of value.matchAll(/[\u200B\uFEFF]+|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/gu))filterEvents.push({run_id:part.run_id,decoded_start:part.decoded_start+match.index,decoded_end:part.decoded_start+match.index+match[0].length,category:/^[\u200B\uFEFF]/u.test(match[0])?'ZERO_WIDTH_FILTER':'CONTROL_FILTER',decoded_sha256:sha(match[0])});}
    const whitespaceDecoded=filtered?decoded.replace(/[\u200B\uFEFF]/gu,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu,''):decoded;
    if(whitespace&&!/^\s+$/u.test(whitespaceDecoded))throw problem('NATIVE_DECORATION_WHITESPACE_REQUIRED','Nonempty whitespace-only collector origin required after its declared finite filter');
    if(filtered&&!filterEvents.length)throw problem('NATIVE_DECORATION_FILTER_EVENT_REQUIRED','Filtered-whitespace profile requires a literal frozen-filter source event');
    const text=normalization==='EXACT_DECODED'?decoded:whitespace?' ':normalize(decoded);if(text!==normalizedText.slice(start,end))throw problem('NATIVE_DECORATION_OUTPUT_MISMATCH','Collector origin differs from exact normalized output');
    const sharedWhitespace=origins.length>1&&whitespace&&origins.every(p=>byId.get(p.run_id).path_id===byId.get(origins[0].run_id).path_id);
    const jointWhitespace=origins.length>1&&whitespace&&!sharedWhitespace;
    segments.push({start,end,sha256:sha(text),sources:origins,normalization,mapping:origins.length===1||sharedWhitespace?'EXACT_COLLECTOR_ORIGIN':jointWhitespace?'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE':'AMBIGUOUS_PER_RUN_MAPPING',...(filterEvents.length?{filtered_source_events:filterEvents}:{}),...(sharedWhitespace?{joint_source_attribution:{policy:'IDENTICAL_NATIVE_PATH_WHITESPACE_COLLAPSE_V1',path_id:byId.get(origins[0].run_id).path_id,per_run_character_attribution:false}}:jointWhitespace?{joint_source_attribution:{policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',native_mark_attribution_verified:false,per_run_character_attribution:false}}:{})});
  }
  const unmapped=[];
  for(const run of trace.runs) {
    const parts=(coverage.get(run.id)??[]).sort((a,b)=>a[0]-b[0]);let end=0;
    for(const [left,right] of parts){if(left<end)throw new Error('Collector raw source origin reused');if(left!==end&&(run.path_id||normalize(run.decoded_text.slice(end,left))))unmapped.push({run_id:run.id,start:end,end:left});end=right;}
    if(end<run.decoded_text.length&&(run.path_id||normalize(run.decoded_text.slice(end))))unmapped.push({run_id:run.id,start:end,end:run.decoded_text.length});
  }
  if(!/^[\s|]*$/u.test(normalizedText.slice(priorEnd)))unmappedNormalized.push({start:priorEnd,end:normalizedText.length});
  const ambiguous=segments.filter(s=>s.mapping!=='EXACT_COLLECTOR_ORIGIN').length,jointWhitespaceCount=segments.filter(s=>s.mapping==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE').length,blockingAmbiguity=segments.filter(s=>s.mapping==='AMBIGUOUS_PER_RUN_MAPPING').length;
  const originUnresolved=trace.unresolved.some(value=>value.kind!=='STYLESHEET_CASCADE_NOT_COMPUTED');
  const collectorStatus=issues.length?'UNRESOLVED_COLLECTOR_ORIGIN':collectorSegments===undefined?'UNBOUND_REQUIRES_EXTRACTOR_COLLECTOR_ORIGIN':unmapped.length||unmappedNormalized.length||blockingAmbiguity||originUnresolved?'UNRESOLVED_COLLECTOR_ORIGIN':jointWhitespaceCount?'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE':'EXACT_COLLECTOR_ORIGIN';
  const styleStatus=trace.trace_status==='UNAVAILABLE_SOURCE_NATIVE_TRACE'?'UNAVAILABLE_SOURCE_NATIVE_TRACE':trace.unresolved.some(value=>value.kind==='STYLESHEET_CASCADE_NOT_COMPUTED')?'UNRESOLVED_STYLESHEET_CASCADE':'NATIVE_LITERAL_MARKS_RETAINED_COMPUTED_STYLE_UNVERIFIED';
  const eligibleCollector=['EXACT_COLLECTOR_ORIGIN','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(collectorStatus),status=identityStatus!=='CURRENT_METHOD_BINDINGS_SUPPLIED'?'UNBOUND_REQUIRES_CURRENT_METHOD_IDENTITIES':eligibleCollector&&styleStatus==='NATIVE_LITERAL_MARKS_RETAINED_COMPUTED_STYLE_UNVERIFIED'?collectorStatus:collectorStatus==='UNBOUND_REQUIRES_EXTRACTOR_COLLECTOR_ORIGIN'?collectorStatus:'UNRESOLVED_COLLECTOR_OR_NATIVE_STYLE_MAPPING',inputEligibility=status==='EXACT_COLLECTOR_ORIGIN'?'EXACT_SOURCE_EVIDENCE':status==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'?status:'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE';
  return seal({schema:'native-source-decoration-envelope-v2',policy:NATIVE_DECORATION_POLICY,tracer_source_sha256:tracerIdentity,collector_source_sha256:collectorIdentity,method_identity_status:identityStatus,collector_issues:issues,trace,raw:trace.raw,normalized:{sha256:sha(normalizedText),characters:normalizedText.length,offset_basis:'UTF16_IN_NORMALIZED_TEXT'},segments,unmapped,unmapped_normalized:unmappedNormalized,ambiguous_segments:ambiguous,joint_whitespace_segments:jointWhitespaceCount,blocking_ambiguous_segments:blockingAmbiguity,collector_mapping_status:collectorStatus,native_style_status:styleStatus,mapping_status:status,input_eligibility:inputEligibility,cache_binding_required:true,computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,authority:'NONE'});
}

/** A failed/unsupported native trace is explicit, never an empty exact trace.
 * Extraction callers retain their original accepted/rejected status and text.
 * They must preserve the source and every unit while this envelope is unbound.
 */
export function unresolvedNativeDecoration({raw,normalizedText,format='html',trace=null,tracerSourceSHA256,collectorSourceSHA256,collectorIssues}={}) {
  if(typeof raw!=='string'||typeof normalizedText!=='string'||!['html','text','legacy-sgml'].includes(format))throw new Error('Literal source and explicit unresolved profile required');
  const issues=checkedCollectorIssues(collectorIssues,raw.length,normalizedText.length);if(!issues.length)throw new Error('An unresolved decoration envelope requires a collector issue');
  const retained=trace??seal({schema:'native-source-decoration-trace-v2',policy:NATIVE_DECORATION_POLICY,format,trace_status:'UNAVAILABLE_SOURCE_NATIVE_TRACE',raw:{sha256:sha(raw),characters:raw.length,bytes:Buffer.byteLength(raw),offset_basis:'UTF16_IN_DECODED_RAW_SOURCE_NOT_BYTES'},sources:[],paths:[],runs:[],unresolved:[{kind:'SOURCE_NATIVE_TRACE_UNAVAILABLE'}],parser_errors:[],source_origin_backend:'UNAVAILABLE_NO_NATIVE_TRACE_CLAIM',normalized_mapping_status:'UNBOUND_REQUIRES_EXTRACTOR_COLLECTOR_ORIGIN',computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,authority:'NONE'});
  return bindNativeDecoration(retained,{raw,normalizedText,tracerSourceSHA256,collectorSourceSHA256,collectorIssues:issues});
}

function checkedEnvelope(envelope,raw,normalizedText,expected={}) {
  checkedSeal(envelope);checkedSeal(envelope.trace);boundText(envelope.raw,raw,'Raw source');boundText(envelope.normalized,normalizedText,'Normalized source');
  if(envelope.schema!=='native-source-decoration-envelope-v2'||envelope.policy!==NATIVE_DECORATION_POLICY||envelope.trace.schema!=='native-source-decoration-trace-v2'||envelope.trace.policy!==NATIVE_DECORATION_POLICY||!['AVAILABLE_SOURCE_NATIVE_TRACE','UNAVAILABLE_SOURCE_NATIVE_TRACE'].includes(envelope.trace.trace_status)||envelope.trace.raw.sha256!==envelope.raw.sha256||envelope.trace.raw.characters!==raw.length||envelope.trace.raw.bytes!==Buffer.byteLength(raw)||envelope.computed_style_verified!==false||envelope.effectiveness_verified!==false||envelope.semantic_completeness_verified!==false||envelope.trace.computed_style_verified!==false||envelope.trace.effectiveness_verified!==false||envelope.trace.semantic_completeness_verified!==false||envelope.authority!=='NONE'||envelope.trace.authority!=='NONE')throw new Error('Native decoration scope differs');
  if(envelope.trace.format==='legacy-sgml'&&envelope.trace.trace_status==='AVAILABLE_SOURCE_NATIVE_TRACE'&&envelope.trace.source_profile!==LEGACY_SGML_PROFILE)throw new Error('Legacy decoration profile scope differs');
  const tracer=methodIdentity(envelope.tracer_source_sha256,'tracer'),collector=methodIdentity(envelope.collector_source_sha256,'collector');
  const eligible=['EXACT_COLLECTOR_ORIGIN','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(envelope.mapping_status),eligibility=envelope.mapping_status==='EXACT_COLLECTOR_ORIGIN'?'EXACT_SOURCE_EVIDENCE':envelope.mapping_status==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'?envelope.mapping_status:'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE';
  if(envelope.method_identity_status!==(tracer&&collector?'CURRENT_METHOD_BINDINGS_SUPPLIED':'UNBOUND_MISSING_CURRENT_METHOD_IDENTITIES')||(!tracer||!collector)&&eligible||envelope.trace.trace_status==='UNAVAILABLE_SOURCE_NATIVE_TRACE'&&eligible||envelope.input_eligibility!==eligibility)throw new Error('Native decoration method, eligibility or unavailable trace scope differs');
  const issues=checkedCollectorIssues(envelope.collector_issues,raw.length,normalizedText.length);
  if(envelope.raw.offset_basis!=='UTF16_IN_DECODED_RAW_SOURCE_NOT_BYTES'||envelope.normalized.offset_basis!=='UTF16_IN_NORMALIZED_TEXT'||issues.length&&eligible||eligible&&(envelope.unmapped.length||envelope.unmapped_normalized.length||envelope.blocking_ambiguous_segments||envelope.trace.unresolved.length||envelope.native_style_status!=='NATIVE_LITERAL_MARKS_RETAINED_COMPUTED_STYLE_UNVERIFIED'))throw new Error('Native decoration coordinate, unknown evidence or collector issue scope differs');
  if(expected.expectedTracerSourceSHA256!==undefined&&tracer!==methodIdentity(expected.expectedTracerSourceSHA256,'expected tracer')||expected.expectedCollectorSourceSHA256!==undefined&&collector!==methodIdentity(expected.expectedCollectorSourceSHA256,'expected collector'))throw new Error('Native decoration current method binding differs');
}

/** Lightweight binding/scope verification, with no clone/index construction.
 * A self-consistent seal is not source authenticity: a dedicated issue replay
 * must independently rebuild the frozen tracer/collector result from source.
 */
export function verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,...expected}={}) {
  checkedEnvelope(envelope,raw,normalizedText,expected);
  return {policy:envelope.policy,envelope_sha256:envelope.sha256,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,method_identity_status:envelope.method_identity_status,trace_status:envelope.trace.trace_status,source_authenticity_recomputed:false};
}

/** Validate/hash once per bound document, privately clone retained metadata,
 * and index segments once. Each window then visits only overlapping segments;
 * it does not hash/reparse/search the whole four-MiB document for every window.
 */
export function createNativeDecorationView(envelope,{raw,normalizedText,...expected}={}) {
  checkedEnvelope(envelope,raw,normalizedText,expected);const retained=structuredClone(envelope);
  const paths=new Map(retained.trace.paths.map(p=>[p.id,p])),sources=new Map(retained.trace.sources.map(s=>[s.id,s])),runs=new Map(retained.trace.runs.map(r=>[r.id,r])),sourceScopes=new Map(retained.trace.sources.filter(s=>s.dom_scopes).map(s=>[s.id,new Map(s.dom_scopes.map(scope=>[scope.id,scope]))]));
  const isJoint=segment=>segment.mapping==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE';
  const markedSegments=retained.segments.filter(segment=>isJoint(segment)||segment.sources.some(p=>runs.get(p.run_id)?.path_id));
  const inputPaths=new Map();
  for(const path of retained.trace.paths){if(path.parent_id&&!inputPaths.has(path.parent_id))throw new Error('Decoration path order differs');const source=sources.get(path.source_id);if(!source)throw new Error('Decoration path source differs');const parent=inputPaths.get(path.parent_id)??null;inputPaths.set(path.id,source.input_relevance==='NONDECORATION_STYLE_METADATA'?parent:{path_id:path.id,parent});}
  const inputSegments=markedSegments.filter(segment=>isJoint(segment)||segment.sources.some(p=>inputPaths.get(runs.get(p.run_id)?.path_id)));
  const neutralSourceCount=retained.trace.sources.filter(source=>source.input_relevance==='NONDECORATION_STYLE_METADATA').length;
  const ancestorBound=integer(retained.trace.depth_profile?.max_native_ancestor_sources??256,1,1000256,'native ancestor bound');
  function projectImpl({start=0,end=normalizedText.length,maxRuns=512,maxCharacters=20000,maxOrigins=4096,includeEndZeroWidth=false}={},forModel=false) {
    range(start,end,normalizedText.length,{empty:true});integer(maxRuns,1,10000,'projection run bound');integer(maxCharacters,128,1000000,'projection text bound');integer(maxOrigins,1,65536,'projection origin bound');
    if(typeof includeEndZeroWidth!=='boolean')throw problem('NATIVE_DECORATION_INVALID_ZERO_WIDTH_POLICY','Explicit terminal zero-width policy must be boolean');
    if(!pointBoundary(normalizedText,start)||!pointBoundary(normalizedText,end))throw problem('NATIVE_DECORATION_PROJECTION_CODEPOINT','Projection splits a codepoint');
    const selected=forModel?inputSegments:markedSegments;
    let left=0,right=selected.length;while(left<right){const middle=(left+right)>>>1;if(selected[middle].end<start)left=middle+1;else right=middle;}
    const result=[];let characters=0,originCount=0;
    for(let index=left;index<selected.length&&selected[index].start<=end;index++) {
    const segment=selected[index];
    if(segment.end<start||segment.start>end||segment.end===segment.start&&(segment.start<start||segment.start>end||segment.start===end&&!includeEndZeroWidth))continue;
    const low=Math.max(start,segment.start),high=Math.min(end,segment.end);if(high<=low&&segment.end!==segment.start)continue;
    if(isJoint(segment)) {
      // A positive collapsed space has complete ordered source evidence, but
      // its distinct native ancestries cannot be assigned to that character.
      // Each origin receives a lossless witness; the output has no mark list.
      if(normalizedText.slice(segment.start,segment.end)!==' '||low!==segment.start||high!==segment.end)throw new Error('Joint whitespace projection must cover its complete literal space');
      const capped=()=>{if(result.length>=maxRuns||characters>maxCharacters||originCount>maxOrigins)throw problem('NATIVE_DECORATION_PROJECTION_BOUND','Native decoration projection exceeds explicit bound; no partial projection emitted');};
      originCount+=segment.sources.length+(segment.filtered_source_events?.length??0);characters+=1;capped();
      const witnessOrigins=[];
      for(const part of segment.sources) {
        const run=runs.get(part.run_id);if(!run)throw new Error('Joint whitespace source origin differs');const marks=[];let path=forModel?inputPaths.get(run.path_id):run.path_id,depth=0;
        while(path){if(++depth>ancestorBound)throw new Error('Decoration ancestor path exceeds bound');const link=paths.get(forModel?path.path_id:path),source=link&&sources.get(link.source_id);if(!source)throw new Error('Joint whitespace native source path differs');originCount++;characters+=source.style_attribute?.decoded_value.length??0;capped();const mark={id:source.id,tag:source.tag,native_tag:source.native_tag,start_tag:{...source.start_tag},start_tag_role:source.start_tag_role,element:source.element?{...source.element}:null,element_start_tag:source.element_start_tag?{...source.element_start_tag}:null,element_scope:{...source.element_scope},end_tag:source.end_tag?{...source.end_tag}:null,style_attribute:source.style_attribute?{...source.style_attribute}:null,declarations:source.declarations.map(d=>({...d})),style_declarations:source.style_declarations.map(d=>({...d})),input_relevance:source.input_relevance,computed_style_verified:false,effectiveness_verified:false};if(source.dom_scopes){const scope=sourceScopes.get(source.id)?.get(link.dom_scope_id);if(!scope)throw new Error('Joint whitespace reconstructed DOM scope differs');originCount++;capped();mark.dom_scopes=[structuredClone(scope)];}marks.push(mark);path=forModel?path.parent:link.parent_id;}
        const decoded=run.decoded_text.slice(part.decoded_start,part.decoded_end),rle=[];
        for(const character of decoded){const codepoint=`U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`,previous=rle.at(-1);if(previous?.codepoint===codepoint)previous.count++;else{originCount++;characters+=codepoint.length;capped();rle.push({codepoint,count:1});}}
        witnessOrigins.push({run_id:part.run_id,raw:{...run.raw},decoded_start:part.decoded_start,decoded_end:part.decoded_end,decoded_sha256:part.decoded_sha256,decoded_codepoints_rle:rle,marks,filtered_source_events:(segment.filtered_source_events??[]).filter(event=>event.run_id===part.run_id&&event.decoded_start>=part.decoded_start&&event.decoded_end<=part.decoded_end).map(event=>({...event})),output_character_attribution_verified:false});
      }
      result.push({start:low,end:high,chunks:[' '],mark_key:null,source_segment_start:segment.start,source_segment_end:segment.end,source_segment_count:1,clipped:false,mapping:segment.mapping,normalization:segment.normalization,origins:segment.sources.map(part=>({run_id:part.run_id,raw:{...runs.get(part.run_id).raw},decoded_start:part.decoded_start,decoded_end:part.decoded_end,decoded_sha256:part.decoded_sha256,clipping_mapping:'JOINT_NORMALIZED_GROUP_NO_PER_CHARACTER_ATTRIBUTION'})),marks:[],joint_source_attributions:[{start:segment.start,end:segment.end,...segment.joint_source_attribution}],filtered_source_events:(segment.filtered_source_events??[]).map(event=>({normalized_group:{start:segment.start,end:segment.end},...event})),joint_whitespace_witness:{policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',normalized_output:{text:' ',start:segment.start,end:segment.end,mark_attribution:'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED'},origins:witnessOrigins,per_run_character_attribution:false},computed_style_verified:false,effectiveness_verified:false});
      continue;
    }
    if(originCount+segment.sources.length+(segment.filtered_source_events?.length??0)>maxOrigins)throw problem('NATIVE_DECORATION_PROJECTION_BOUND','Native decoration origin records exceed explicit projection bound');
    const marked=segment.sources.map(p=>runs.get(p.run_id)).filter(r=>r?.path_id);if(!marked.length)continue;
    const marks=[],seen=new Map(),seenScopes=new Set();
    for(const run of marked){let path=forModel?inputPaths.get(run.path_id):run.path_id;let depth=0;while(path){if(++depth>ancestorBound)throw new Error('Decoration ancestor path exceeds bound');const link=paths.get(forModel?path.path_id:path),source=link&&sources.get(link.source_id);if(!source)throw new Error('Native source path differs');let mark=seen.get(source.id);if(!mark){if(marks.length+originCount>=maxOrigins)throw problem('NATIVE_DECORATION_PROJECTION_BOUND','Native decoration ancestor records exceed explicit projection bound');mark={id:source.id,tag:source.tag,native_tag:source.native_tag,start_tag:{...source.start_tag},start_tag_role:source.start_tag_role,element:source.element?{...source.element}:null,element_start_tag:source.element_start_tag?{...source.element_start_tag}:null,element_scope:{...source.element_scope},end_tag:source.end_tag?{...source.end_tag}:null,style_attribute:source.style_attribute?{...source.style_attribute}:null,declarations:source.declarations.map(d=>({...d})),style_declarations:source.style_declarations.map(d=>({...d})),input_relevance:source.input_relevance,computed_style_verified:false,effectiveness_verified:false,...(source.dom_scopes?{dom_scopes:[]}:{})};seen.set(source.id,mark);marks.push(mark);}if(source.dom_scopes){const scope=sourceScopes.get(source.id)?.get(link.dom_scope_id);if(!scope)throw new Error('Native reconstructed DOM scope differs');if(!seenScopes.has(scope.id)){seenScopes.add(scope.id);mark.dom_scopes.push(structuredClone(scope));}}path=forModel?path.parent:link.parent_id;}}
    const text=normalizedText.slice(low,high),origins=segment.sources.map(p=>{const r=runs.get(p.run_id),exclusive=segment.mapping==='EXACT_COLLECTOR_ORIGIN'&&segment.normalization==='EXACT_DECODED',decodedStart=exclusive?p.decoded_start+low-segment.start:p.decoded_start,decodedEnd=exclusive?p.decoded_start+high-segment.start:p.decoded_end;return {run_id:p.run_id,raw:{...r.raw},decoded_start:decodedStart,decoded_end:decodedEnd,decoded_sha256:exclusive?sha(r.decoded_text.slice(decodedStart,decodedEnd)):p.decoded_sha256,clipping_mapping:exclusive?'EXACT_DECODED_RANGE':low===segment.start&&high===segment.end?'WHOLE_COLLECTOR_ORIGIN':'TRANSFORMED_OR_SHARED_ORIGIN_NOT_LOCALIZED'};});
    const markKey=marks.map(mark=>mark.id).join('|'),previous=result.at(-1),merge=forModel&&previous?.end===low&&previous.mark_key===markKey&&previous.mapping==='EXACT_COLLECTOR_ORIGIN'&&segment.mapping==='EXACT_COLLECTOR_ORIGIN';
    characters+=text.length+(merge?0:marks.reduce((n,m)=>n+(m.style_attribute?.decoded_value.length??0),0));originCount+=origins.length+marks.length+marks.reduce((n,m)=>n+(m.dom_scopes?.length??0),0)+(segment.filtered_source_events?.length??0);
    if(!merge&&result.length>=maxRuns||characters>maxCharacters||originCount>maxOrigins)throw problem('NATIVE_DECORATION_PROJECTION_BOUND','Native decoration projection exceeds explicit bound; no partial projection emitted');
    const joint=segment.joint_source_attribution?[{start:segment.start,end:segment.end,...segment.joint_source_attribution}]:[],filterEvents=(segment.filtered_source_events??[]).map(event=>({normalized_group:{start:segment.start,end:segment.end},...event}));
    if(merge){previous.end=high;previous.chunks.push(text);previous.source_segment_end=segment.end;previous.source_segment_count++;previous.clipped||=low!==segment.start||high!==segment.end;previous.origins.push(...origins);previous.joint_source_attributions.push(...joint);previous.filtered_source_events.push(...filterEvents);for(let i=0;i<marks.length;i++)if(marks[i].dom_scopes){const ids=new Set(previous.marks[i].dom_scopes.map(s=>s.id));for(const scope of marks[i].dom_scopes)if(!ids.has(scope.id))previous.marks[i].dom_scopes.push(scope);}if(previous.normalization!==segment.normalization)previous.normalization='MULTIPLE_EXACT_COLLECTOR_SEGMENTS';}
    else result.push({start:low,end:high,chunks:[text],mark_key:markKey,source_segment_start:segment.start,source_segment_end:segment.end,source_segment_count:1,clipped:low!==segment.start||high!==segment.end,mapping:segment.mapping,normalization:segment.normalization,origins,marks,joint_source_attributions:joint,filtered_source_events:filterEvents,computed_style_verified:false,effectiveness_verified:false});
  }
    const annotations=result.map(({chunks,mark_key,...annotation})=>({...annotation,text:chunks.join('')}));
    return {schema:'native-source-decoration-projection-v2',policy:NATIVE_DECORATION_POLICY,projection_policy:forModel?'COMPACT_DECORATION_RELEVANT_NATIVE_EVIDENCE':'ALL_NATIVE_STYLE_SOURCE_METADATA',nondecoration_style_sources_retained_in_trace:neutralSourceCount,envelope_sha256:retained.sha256,tracer_source_sha256:retained.tracer_source_sha256,collector_source_sha256:retained.collector_source_sha256,method_identity_status:retained.method_identity_status,collector_issue_count:retained.collector_issues.length,raw_sha256:retained.raw.sha256,normalized_sha256:retained.normalized.sha256,range:{start,end,include_end_zero_width:includeEndZeroWidth},collector_mapping_status:retained.collector_mapping_status,native_style_status:retained.native_style_status,mapping_status:retained.mapping_status,input_eligibility:retained.input_eligibility,unmapped_ranges:retained.unmapped.length,unmapped_normalized_ranges:retained.unmapped_normalized.length,unresolved_style_or_origin_evidence:retained.trace.unresolved.length,annotations,computed_style_verified:false,effectiveness_verified:false,authority:'NONE'};
  }
  const project=options=>projectImpl(options,false);
  function input(options={}) {
    if(!['EXACT_SOURCE_EVIDENCE','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(retained.input_eligibility))throw problem('NATIVE_DECORATION_UNRESOLVED_MAPPING','Native decoration mapping unresolved; plain-only model encoding forbidden, source units retained');
    const projection=projectImpl(options,true);
    if(!['EXACT_SOURCE_EVIDENCE','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(projection.input_eligibility)||projection.annotations.some(a=>!['EXACT_COLLECTOR_ORIGIN','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(a.mapping)))throw problem('NATIVE_DECORATION_UNRESOLVED_MAPPING','Native decoration mapping unresolved; plain-only model encoding forbidden, source units retained');
    const {start,end}=projection.range,parts=[];let cursor=start;
    const literalMarks=marks=>marks.map(m=>({...(m.native_tag?{tag:m.native_tag}:{}),...(m.style_attribute?{style_literal:m.style_attribute.decoded_value}:{}),...(m.declarations.length?{declarations:m.declarations.map(d=>({property:d.property,value:d.value}))}:{}),...(m.input_relevance==='UNRESOLVED_CSS'?{css_interpretation:'UNRESOLVED'}:{})}));
    for(const annotation of projection.annotations){parts.push(normalizedText.slice(cursor,annotation.start));if(annotation.joint_whitespace_witness){const witness=annotation.joint_whitespace_witness;parts.push('\n[JOINT_NORMALIZATION_UNVERIFIED '+JSON.stringify({normalization:annotation.normalization,origins:witness.origins.map(origin=>({decoded_codepoints_rle:origin.decoded_codepoints_rle,marks:literalMarks(origin.marks),filtered_source_events:origin.filtered_source_events.map(event=>({decoded_start:event.decoded_start-origin.decoded_start,decoded_end:event.decoded_end-origin.decoded_start,category:event.category}))})),output_character_mark_attribution:'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED'})+']\n[/JOINT_NORMALIZATION_UNVERIFIED]\n');parts.push(annotation.text);}else{parts.push('\n[NATIVE_SOURCE_MARKS_UNVERIFIED '+JSON.stringify(literalMarks(annotation.marks))+']\n');parts.push(annotation.text);parts.push('\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n');}cursor=annotation.end;}
    parts.push(normalizedText.slice(cursor,end));
    return {policy:NATIVE_DECORATION_INPUT_POLICY,text:parts.join(''),projection_sha256:digest(projection),envelope_sha256:retained.sha256,mapping_status:retained.mapping_status,input_eligibility:retained.input_eligibility,normalized_range:{...projection.range},encoded_annotation_groups:projection.annotations.length,joint_whitespace_witnesses:projection.annotations.filter(a=>a.joint_whitespace_witness).length,nondecoration_style_sources_retained_in_trace:neutralSourceCount,window_annotations_self_contained:true,computed_style_verified:false,effectiveness_verified:false};
  }
  return Object.freeze({project,projectRelevant:options=>projectImpl(options,true),input});
}

/** Bounded literal projection. Render fields with textContent, never innerHTML.
 * Unmapped raw text is not leaked into unrelated normalized review ranges.
 * Repeated windows should share createNativeDecorationView instead.
 */
export function projectNativeDecoration(envelope,options={}) {return createNativeDecorationView(envelope,options).project(options);}

/** Call on each actual tokenizer window's normalized range, then measure the
 * resulting input again. All model/lexical arms must share this same policy.
 * A flat string chopped after encoding does NOT preserve annotation coverage.
 */
export function nativeDecorationInput(envelope,options) {
  return createNativeDecorationView(envelope,options).input(options);
}
