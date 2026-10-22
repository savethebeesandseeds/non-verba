// SPDX-License-Identifier: AGPL-3.0-only
// Reliable bounded data transport only. Acquisition and acceptance stay in their
// own modules. No signaling server, STUN, TURN, media channel, or background upload.
import {MAX_LOCATION_PROOF} from './location-platform.js';
const CONTROL_LIMIT = 256 * 1024, FRAGMENT = 16000;
export class LivePeer {
  constructor({onMessage,onArtifact,onFailure,onConnected,authorizeArtifact}) {
    Object.assign(this,{onMessage,onArtifact,onFailure,onConnected,authorizeArtifact});
    this.pc = new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'});
    this.closed=false; this.incoming=null; this.controlCount=0;
    this.pc.onconnectionstatechange=()=>{if(!this.closed&&['failed','disconnected','closed'].includes(this.pc.connectionState))this.onFailure(new Error('The direct connection was interrupted.'));};
    this.pc.ondatachannel=({channel})=>{try{if(this.channel)throw new Error('Unexpected additional channel.');this.attach(channel);}catch(error){channel.close();this.onFailure(error);}};
  }
  attach(channel) {
    if(channel.label!=='nonverba-live-location-v1'||!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null)throw new Error('Unsupported live data channel.');
    this.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=64000;
    channel.onopen=()=>{if(!this.closed)this.onConnected();};
    channel.onclose=channel.onerror=()=>{if(!this.closed)this.onFailure(new Error('The live data channel closed.'));};
    channel.onmessage=({data})=>{
      if(this.closed)return;
      try{
        if(typeof data==='string'){
          if(data.length>CONTROL_LIMIT||this.incoming||++this.controlCount>32)throw new Error('Unexpected or excessive live control message.');
          const value=JSON.parse(data);if(!value||typeof value.type!=='string')throw new Error('Malformed live message.');
          if(value.type==='artifact'){
            if(Object.keys(value).length!==2||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_LOCATION_PROOF||!this.authorizeArtifact())throw new Error('Unexpected or oversized location artifact.');
            this.incoming={bytes:new Uint8Array(value.bytes),used:0};
          }else this.onMessage(value);
        }else{
          const active=this.incoming;
          if(!(data instanceof ArrayBuffer)||!active||data.byteLength<5||data.byteLength>FRAGMENT+4)throw new Error('Unexpected artifact fragment.');
          const offset=new DataView(data).getUint32(0,true),part=new Uint8Array(data,4);
          if(offset!==active.used||part.length!==Math.min(FRAGMENT,active.bytes.length-active.used))throw new Error('Artifact fragments are out of order or have an invalid length.');
          active.bytes.set(part,offset);active.used+=part.length;
          if(active.used===active.bytes.length){this.incoming=null;this.onArtifact(active.bytes,{wall:Date.now(),mono:performance.now()});}
        }
      }catch(error){this.onFailure(error);}
    };
  }
  send(value){if(this.closed||this.channel?.readyState!=='open')throw new Error('The live peer is not connected.');const text=JSON.stringify(value);if(text.length>CONTROL_LIMIT)throw new Error('Live message exceeds the limit.');this.channel.send(text);}
  async sendArtifact(bytes){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_LOCATION_PROOF)throw new Error('Invalid location artifact.');
    this.send({type:'artifact',bytes:bytes.length});
    for(let offset=0;offset<bytes.length;offset+=FRAGMENT){
      if(this.closed)throw new Error('Artifact transfer cancelled.');
      if(this.channel.bufferedAmount>256000)await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);this.channel.removeEventListener('bufferedamountlow',done);};
        const done=()=>{cleanup();resolve();};const timer=setTimeout(()=>{cleanup();reject(new Error('Artifact transport stalled.'));},5000);
        this.channel.addEventListener('bufferedamountlow',done,{once:true});
      });
      if(this.closed)throw new Error('Artifact transfer cancelled.');
      const part=bytes.subarray(offset,offset+FRAGMENT),packet=new Uint8Array(part.length+4);new DataView(packet.buffer).setUint32(0,offset,true);packet.set(part,4);this.channel.send(packet);
    }
  }
  async description(type,remote){
    if(remote){this.validDescription(remote,'offer');await this.pc.setRemoteDescription(remote);}
    if(type==='offer')this.attach(this.pc.createDataChannel('nonverba-live-location-v1',{ordered:true}));
    await this.pc.setLocalDescription(type==='offer'?await this.pc.createOffer():await this.pc.createAnswer());
    if(this.pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.pc.removeEventListener('icegatheringstatechange',check);};
      const check=()=>{if(this.pc.iceGatheringState==='complete'){cleanup();resolve();}};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Direct pairing timed out.'));},10000);this.pc.addEventListener('icegatheringstatechange',check);check();
    });
    if(this.closed)throw new Error('Pairing cancelled.');return this.pc.localDescription.toJSON();
  }
  validDescription(value,type){if(value?.type!==type||typeof value.sdp!=='string'||value.sdp.length>100000||/\r?\nm=(?:audio|video)\s/.test(value.sdp))throw new Error('Only a bounded data-only pairing description is supported.');}
  async answer(value){this.validDescription(value,'answer');await this.pc.setRemoteDescription(value);}
  close(){this.closed=true;this.incoming=null;this.channel?.close();this.pc.close();}
}
