// SPDX-License-Identifier: AGPL-3.0-only
// Foreground, one-shot device location. No coordinates are persisted separately,
// sent to a server, or accepted from an operator text field.
export function freshLocation(signal) {
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is unavailable. Use a location-capable device over HTTPS or localhost.'));return;}
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);clearTimeout(deadline);error?reject(error):resolve(value);};
    const cancel=()=>finish(new DOMException('Location request cancelled. Reopen the camera to try again.','AbortError'));
    // Browsers can exclude permission-dialog time from their own timeout.
    const deadline=setTimeout(()=>finish(new Error('Location timed out. Enable location services and retry; no photo was signed.')),30000);
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    try{navigator.geolocation.getCurrentPosition(position=>{
      const c=position.coords;
      finish(null,{
        latitude:c.latitude,longitude:c.longitude,accuracy_m:c.accuracy,
        altitude_m:c.altitude??null,altitude_accuracy_m:c.altitudeAccuracy??null,
        timestamp_ms:Math.floor(position.timestamp),source:'device-geolocation'
      });
    },error=>finish(new Error(error.code===1
      ?'Location permission was denied. Allow location access to include GPS metadata; no photo was signed.'
      :error.code===3?'Location timed out. Enable location services and retry; no photo was signed.'
      :'A location fix is unavailable. Enable location services and retry; no photo was signed.')),
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});}catch(error){finish(error);}
  });
}

export function locationSummary(location) {
  const latitude=`${Math.abs(location.latitude).toFixed(6)}° ${location.latitude<0?'S':'N'}`;
  const longitude=`${Math.abs(location.longitude).toFixed(6)}° ${location.longitude<0?'W':'E'}`;
  return `${latitude}, ${longitude} · accuracy ±${Math.ceil(location.accuracy_m)} m`;
}
