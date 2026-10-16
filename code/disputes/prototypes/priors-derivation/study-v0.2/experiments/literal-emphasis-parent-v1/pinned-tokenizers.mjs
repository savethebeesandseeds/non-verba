// SPDX-License-Identifier: AGPL-3.0-only
// Local tokenizer-only verification. No corpus API, ONNX session or inference.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const FROZEN='/tmp/nonverba-unified-source/f7cd9407508443b8a20ad70bc46349ab/code/disputes/prototypes/priors-derivation/study-v0.2';
const SECOND_MANIFEST='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/comparison-model.json';
export const MODEL_BINDINGS=Object.freeze({snapshot:FROZEN,reported_method_sha256:'874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa',embedding_source_sha256:'d85edf56c136e74edf035dedf9fc209e3759155f8fe18f333d8a5baa7720054e',comparison_recipe_sha256:'17480b64f513a215afd22c30b9a37b939456e66163fef65ef32982e973d3a065',second_manifest_sha256:'a53b0d7e1bb1e1ba69606861b6b55f2584eea929f162bd850a831367c680cd04',models:[{repository:'Xenova/all-MiniLM-L6-v2',revision:'751bff37182d3f1213fa05d7196b954e230abad9'},{repository:'sentence-transformers/all-MiniLM-L12-v2',revision:'a50ef00143b4d5391434df20ae11632588ac25be'}]});
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function openPinnedCounters(){
  if(process.env.NONVERBA_CONTAINER!=='1'||process.platform!=='linux')throw new Error('Documented managed Linux container required');
  const manifestBytes=await readFile(SECOND_MANIFEST);if(hash(manifestBytes)!==MODEL_BINDINGS.second_manifest_sha256)throw new Error('Pinned public comparison-model manifest differs');
  const embeddingBytes=await readFile(FROZEN+'/lib/embedding.mjs'),embeddingSHA=hash(embeddingBytes);if(embeddingSHA!==MODEL_BINDINGS.embedding_source_sha256)throw new Error('Frozen tokenizer API source differs');
  const {createPinnedTokenCounter}=await import(pathToFileURL(FROZEN+'/lib/embedding.mjs'));
  const baseline=await createPinnedTokenCounter();
  const comparisonBytes=await readFile(FROZEN+'/comparison-recipe.json');if(hash(comparisonBytes)!==MODEL_BINDINGS.comparison_recipe_sha256)throw new Error('Frozen public comparison recipe differs');const comparison=JSON.parse(comparisonBytes);
  if(comparison.secondModel.repository!==MODEL_BINDINGS.models[1].repository||comparison.secondModel.revision!==MODEL_BINDINGS.models[1].revision)throw new Error('Frozen second tokenizer recipe differs');
  const second=await createPinnedTokenCounter(comparison.secondModel,{manifest:JSON.parse(manifestBytes)});
  return {counters:[baseline,second],bindings:{...MODEL_BINDINGS,embedding_source_sha256:embeddingSHA,comparison_recipe_sha256:hash(await readFile(FROZEN+'/comparison-recipe.json')),manifest_path:SECOND_MANIFEST,tokenizers:[baseline,second].map(counter=>({policy:counter.policy,policy_sha256:counter.policy_sha256,model_repository:counter.model.repository,model_revision:counter.model.revision}))},inference:false};
}
