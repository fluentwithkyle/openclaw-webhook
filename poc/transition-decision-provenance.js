'use strict';

const crypto = require('crypto');
const PROVENANCE_VERSION = '1';
const PROVENANCE_SOURCE = 'authenticated_chatbox_user_message';

function signaturePayload(record) {
    return [PROVENANCE_VERSION,record.decision_id,record.transition_id,record.transition_evidence_id,record.current_phase,record.target_phase,record.coordinator_task_id,record.prior_phase_convergence_evidence,record.independent_verification_id,record.decision,record.source].join('\n');
}
function sign(record, secret) {
    if (typeof secret !== 'string' || secret.length === 0) throw new Error('Transition decision provenance secret is not configured');
    return crypto.createHmac('sha256', secret).update(signaturePayload(record)).digest('hex');
}
function issueDirectorTransitionDecision({ decision, currentPhase, targetPhase, coordinatorTaskId, priorPhaseConvergenceEvidence, independentVerificationId, secret }) {
    if (typeof decision !== 'string' || decision.trim() === '') return { valid: false, error: 'Director decision is required' };
    if (![currentPhase,targetPhase,coordinatorTaskId,priorPhaseConvergenceEvidence,independentVerificationId].every(v => typeof v === 'string' && v.trim())) return { valid:false,error:'Transition decision provenance fields are incomplete' };
    const decisionId = `director-transition-decision-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const record = { version:PROVENANCE_VERSION,source:PROVENANCE_SOURCE,decision_id:decisionId,transition_id:`roadmap-transition-${decisionId}`,transition_evidence_id:`transition-evidence-${decisionId}`,current_phase:currentPhase,target_phase:targetPhase,coordinator_task_id:coordinatorTaskId,prior_phase_convergence_evidence:priorPhaseConvergenceEvidence,independent_verification_id:independentVerificationId,decision:decision.trim() };
    record.signature=sign(record,secret);
    return { valid:true,record };
}
function verifyDirectorTransitionDecision(record, expected, secret) {
    if (!record || typeof record !== 'object') return { valid:false,error:'Transition decision provenance is missing' };
    const required=['version','source','decision_id','transition_id','transition_evidence_id','current_phase','target_phase','coordinator_task_id','prior_phase_convergence_evidence','independent_verification_id','decision','signature'];
    for(const field of required) if(typeof record[field]!=='string'||!record[field].trim()) return {valid:false,error:`Transition decision provenance is missing ${field}`};
    if(record.version!==PROVENANCE_VERSION||record.source!==PROVENANCE_SOURCE) return {valid:false,error:'Transition decision provenance source/version is invalid'};
    for(const field of ['current_phase','target_phase','coordinator_task_id','transition_id','transition_evidence_id','prior_phase_convergence_evidence','independent_verification_id']) if(record[field]!==expected[field]) return {valid:false,error:`Transition decision provenance ${field} does not match the authoritative request`};
    if(expected.decision!==undefined&&record.decision!==expected.decision) return {valid:false,error:'Transition decision provenance decision text does not match the durable evidence'};
    let expectedSignature; try{expectedSignature=sign(record,secret)}catch(error){return{valid:false,error:error.message}};
    const actual=Buffer.from(record.signature,'utf8'),expectedBuffer=Buffer.from(expectedSignature,'utf8');
    if(actual.length!==expectedBuffer.length||!crypto.timingSafeEqual(actual,expectedBuffer)) return {valid:false,error:'Transition decision provenance signature is invalid'};
    return {valid:true,record};
}
module.exports={PROVENANCE_VERSION,PROVENANCE_SOURCE,issueDirectorTransitionDecision,verifyDirectorTransitionDecision};
