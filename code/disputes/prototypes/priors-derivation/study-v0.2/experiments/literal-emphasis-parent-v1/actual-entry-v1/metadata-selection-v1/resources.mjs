// SPDX-License-Identifier: AGPL-3.0-only
// Pure future accounting checks; numeric inputs are NOT measurements/authority.
import {assessExecutionSample,EXECUTION_LIMITS,EXECUTION_RESERVATION} from '../../pilot-execution-control.mjs';
import {cumulativeCost} from '../checkpoint.mjs';
export {EXECUTION_LIMITS,EXECUTION_RESERVATION,cumulativeCost};
export function assessDeclaredSample(sample,options){assessExecutionSample(sample,options);return Object.freeze({within_declared_limits:true,actual_measurement_performed:false,actual_authority:false});}
export function issueActualMetadataCheckpoint(){throw Object.assign(Error('ACTUAL_METADATA_SELECTION_CLOSED'),{code:'ACTUAL_METADATA_SELECTION_CLOSED'});}
