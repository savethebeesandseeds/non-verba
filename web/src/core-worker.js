// SPDX-License-Identifier: AGPL-3.0-only
import init, * as core from './pkg/nonverba_core.js';
const ready = init();
const allowed = new Set(['create_identity','create_challenge','validate_challenge','validate_location','seal_image','verify_image','extract_watermark',
  'authentication_create','authentication_transition','authentication_assess',
  'work_privacy_transition','work_privacy_assess',
  'registration_assess','registration_prepare',
  'face_identity_enroll','face_identity_assess',
  'camera_quality_profile','analyze_camera_quality',
  'create_audio_request','create_audio_demo_request','validate_audio_request','create_audio_round','audio_probe','detect_audio_probe',
    'encode_audio_pcm','decode_audio_pcm','hash_audio_pcm','seal_audio','verify_audio',
    'create_location_request','create_location_demo_request','validate_location_request','validate_location_trace',
    'location_identity','location_asset','seal_location_proof','verify_location_proof','verify_gps_attempt_report',
    'live_requester_identity','create_live_session_request','validate_live_session_request',
    'seal_live_session_receipt','verify_live_session_receipt',
    'create_evidence_session_request','validate_evidence_session_request',
    'seal_evidence_session_receipt','verify_evidence_session_receipt','import_gps_lnav_rinex',
    'appraise_location','appraise_image','appraise_camera_location','appraise_audio',
    'appraise_location_with_context','appraise_image_with_context','appraise_camera_location_with_context','appraise_audio_with_context',
    'verify_location_position','verify_key_attestation',
    'create_key_enrollment_request','validate_key_enrollment_request','verify_key_enrollment',
    'seal_image_with_location_request','verify_image_with_location_proof']);
self.onmessage = async ({data: {id, method, args}}) => {
  try {
    await ready;
    if (!allowed.has(method) || typeof core[method] !== 'function') throw new Error('Unknown core operation');
    const value = await core[method](...args);
    self.postMessage({id, value});
  } catch (error) { self.postMessage({id, error: String(error?.message || error)}); }
};
ready.then(() => self.postMessage({ready:true}), error => self.postMessage({fatal:String(error)}));
