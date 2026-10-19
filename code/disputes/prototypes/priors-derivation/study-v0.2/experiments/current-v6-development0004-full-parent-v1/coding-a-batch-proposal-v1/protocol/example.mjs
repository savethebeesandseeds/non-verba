// SPDX-License-Identifier: AGPL-3.0-only
// Executable synthetic schema example; no file IO, actual packet or authority.
import{fixture}from'./fixture.mjs';
import{restoreBatchCursor,currentIdentity,snapshot}from'./policy.mjs';
import{cachedPermit,verifyCachedPage,acquisitionRequirements}from'./cached-adapter.mjs';
export function syntheticExample(){
 const f=fixture(),cursor=restoreBatchCursor(f.args()),request=f.cached(0),permit=cachedPermit(cursor,request),page=JSON.parse(request.manifest_document).pages[0];
 return{schema:'fictional-ordered20-example-v1',roster:f.roster.value,basis:f.basis.value,allocation:f.allocation.value,capsule:f.capsules[0].value,request:{...request,permit,expected_page_ref:page,page_ref:page},metadata_validation:verifyCachedPage(cursor,request,{permit,expected_page_ref:page,page_ref:page}),current:currentIdentity(cursor),snapshot:snapshot(cursor),full_acquisition_obligations:acquisitionRequirements(cursor),actual_runtime_admitted:false,authority:'NONE'};
}
