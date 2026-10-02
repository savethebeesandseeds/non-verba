// SPDX-License-Identifier: AGPL-3.0-only
import {freshLocation} from './location.js';
// Explicit permission warmup before pairing, never evidence. No frame is read,
// no audio is requested, and the returned GPS fix is discarded.
export async function prepareCameraPermissions({signal, requestVideo = () => navigator.mediaDevices.getUserMedia({audio:false,video:true}),
  requestLocation = freshLocation, checkPermissions = () => {}, hidden = () => document.hidden}) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, {once:true});if(signal?.aborted)cancel();
  const timer = setTimeout(cancel,60000);
  const current = () => {if(abort.signal.aborted)throw new Error('Camera permission preparation cancelled or timed out.');};
  let stream;
  const stop = value => {for(const track of value?.getTracks?.()||[])track.stop();};
  try {
    current();
    const pending = Promise.resolve().then(()=>{current();return requestVideo();});
    pending.then(value=>{if(abort.signal.aborted)stop(value);},()=>{});
    stream = await new Promise((resolve,reject)=>{
      const cancelled=()=>reject(new Error('Camera permission preparation cancelled or timed out.'));
      abort.signal.addEventListener('abort',cancelled,{once:true});
      pending.then(resolve,reject).finally(()=>abort.signal.removeEventListener('abort',cancelled));
      if(abort.signal.aborted)cancelled();
    });
    // Close the camera before requesting location. Its pixels are never used.
    stop(stream);stream=null;current();
    await requestLocation(abort.signal);current();
    if(hidden())throw new Error('Return to this screen before pairing the camera.');
    await checkPermissions();current();
  } finally {stop(stream);clearTimeout(timer);signal?.removeEventListener('abort',cancel);abort.abort();}
}
