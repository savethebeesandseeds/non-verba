// SPDX-License-Identifier: AGPL-3.0-only
// Plain-data snapshot only. No caller aliases, executable properties or maps.
function visit(root,{freeze=false}={}){
  const active=new WeakSet(),done=new WeakSet(),pending=[{value:root,depth:0,exit:false}];let nodes=0;
  while(pending.length){
    const {value,depth,exit}=pending.pop();
    if(value===null||value===undefined||['string','boolean'].includes(typeof value))continue;
    if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Finite immutable metadata numbers required');continue;}
    if(typeof value!=='object')throw new TypeError('Plain immutable metadata required');
    if(exit){if(freeze)Object.freeze(value);active.delete(value);done.add(value);continue;}
    if(active.has(value))throw new TypeError('Cyclic immutable metadata is unsupported');if(done.has(value))continue;
    if(++nodes>100000||depth>256)throw new TypeError('Immutable metadata snapshot budget exhausted');
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==Object.prototype&&prototype!==null)throw new TypeError('Only plain objects/arrays may enter immutable metadata');
    if(Object.getOwnPropertySymbols(value).length)throw new TypeError('Symbol metadata properties are unsupported');
    const properties=Object.getOwnPropertyDescriptors(value);active.add(value);pending.push({value,depth,exit:true});
    for(const key of Object.keys(properties).reverse()){
      if(array&&key==='length')continue;const property=properties[key];
      if(!Object.hasOwn(property,'value')||!property.enumerable)throw new TypeError('Only enumerable metadata data properties are supported');
      pending.push({value:property.value,depth:depth+1,exit:false});
    }
  }
}

/** Copy first, freeze recursively, and never freeze the caller's own object. */
export function immutableCopy(value){visit(value);const copy=structuredClone(value);visit(copy,{freeze:true});return copy;}
