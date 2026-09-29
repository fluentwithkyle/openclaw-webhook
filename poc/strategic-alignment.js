'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REQUIRED_STATE_FIELDS = [
  'roadmap_id', 'current_phase', 'phase_status', 'current_strategic_objective',
  'phase_acceptance_criteria', 'completed_requirements', 'unresolved_requirements',
  'required_next_work', 'prerequisites', 'phase_transition_conditions'
];
const DEFAULT_STATE_PATH = path.join(__dirname, '..', 'docs', 'ai', 'STATE.md');
const DEFAULT_PROJECTION_PATH = path.join(__dirname, '..', 'docs', 'ai', 'strategic-state.json');

function blocked(code, detail) {
  return { status: 'BLOCKED', code, detail, escalation: 'Kyle — Director', authorization: 'NOT_GRANTED' };
}

function stateHash(stateText) {
  return crypto.createHash('sha256').update(stateText).digest('hex');
}

function loadAuthoritativeStrategicState({ statePath = DEFAULT_STATE_PATH, projectionPath = DEFAULT_PROJECTION_PATH } = {}) {
  try {
    const stateText = fs.readFileSync(statePath, 'utf8');
    const projection = JSON.parse(fs.readFileSync(projectionPath, 'utf8'));
    if (projection.state_md_sha256 !== stateHash(stateText)) {
      return blocked('STRATEGIC_STATE_PROJECTION_MISMATCH', 'The strategic-state projection does not match authoritative STATE.md.');
    }
    return validateStrategicState(projection);
  } catch (error) {
    return blocked('AUTHORITATIVE_STATE_UNAVAILABLE', 'Authoritative strategic state cannot be established.');
  }
}

function validateStrategicState(state) {
  if (!state || typeof state !== 'object') return blocked('AUTHORITATIVE_STATE_UNAVAILABLE', 'Authoritative strategic state is unavailable.');
  for (const field of REQUIRED_STATE_FIELDS) {
    if (!(field in state) || state[field] == null || state[field] === '' || (Array.isArray(state[field]) && state[field].length === 0)) {
      return blocked('AUTHORITATIVE_STATE_INCOMPLETE', `Missing authoritative field: ${field}.`);
    }
  }
  if (state.authoritative_sources_agree !== true) return blocked('AUTHORITATIVE_SOURCES_CONFLICT', 'Authoritative roadmap sources do not agree.');
  if (!Array.isArray(state.unresolved_requirements) || !Array.isArray(state.completed_requirements)) {
    return blocked('AUTHORITATIVE_STATE_INVALID', 'Requirement collections must be arrays.');
  }
  return { status: 'VALID', state };
}

function selectRequirementForObjective(state, objective) {
  const normalized = typeof objective === 'string' ? objective.trim().toLowerCase() : '';
  if (!normalized) return null;
  return state.unresolved_requirements.find((requirement) =>
    state.required_next_work.includes(requirement.id) &&
    Array.isArray(requirement.objective_terms) && requirement.objective_terms.length > 0 &&
    requirement.objective_terms.every((term) => normalized.includes(term.toLowerCase()))
  ) || null;
}

function evaluateStrategicAlignment(state, proposal) {
  const stateResult = validateStrategicState(state);
  if (stateResult.status !== 'VALID') return stateResult;
  if (!proposal || typeof proposal !== 'object') return blocked('PROPOSAL_UNAVAILABLE', 'A proposed work item is required.');
  const requirement = state.unresolved_requirements.find((item) => item.id === proposal.requirement_id);
  if (!requirement) {
    if (state.completed_requirements.some((item) => item.id === proposal.requirement_id)) return blocked('REQUIREMENT_ALREADY_COMPLETE', 'A completed requirement cannot establish strategic alignment.');
    return blocked('UNRESOLVED_REQUIREMENT_NOT_ESTABLISHED', 'Proposal does not map to an authoritative unresolved requirement.');
  }
  if (proposal.roadmap_id !== state.roadmap_id || proposal.current_phase !== state.current_phase) return blocked('STALE_OR_CONTRADICTORY_ROADMAP', 'Proposal does not match authoritative roadmap identity and current phase.');
  if (proposal.classification !== requirement.classification || !['A', 'B'].includes(proposal.classification)) return blocked('STRATEGIC_DRIFT', 'Only authoritative roadmap-required or enabling work is selectable.');
  if (!state.required_next_work.includes(requirement.id)) return blocked('NOT_REQUIRED_NEXT_WORK', 'The mapped unresolved requirement is not currently selectable.');
  if (!Array.isArray(requirement.acceptance_criteria) || requirement.acceptance_criteria.length === 0 || !requirement.expected_advancement || !requirement.convergence_condition) return blocked('REQUIREMENT_CONVERGENCE_UNESTABLISHED', 'The authoritative requirement lacks advancement or convergence conditions.');
  const unmet = (requirement.prerequisites || []).find((id) => !state.completed_requirements.some((item) => item.id === id));
  if (unmet) return blocked('PREREQUISITE_UNPROVEN', `Prerequisite ${unmet} is not completed in authoritative state.`);
  if (proposal.classification === 'B' && !requirement.enables) return blocked('ENABLING_DEPENDENCY_UNPROVEN', 'Enabling work requires an authoritative dependency it unlocks.');
  if (selectRequirementForObjective(state, proposal.objective) !== requirement) return blocked('OBJECTIVE_NOT_MAPPED', 'The objective does not match the authoritative requirement mapping.');
  return { status: 'ALIGNED_PENDING_AUTHORIZATION', roadmap_id: state.roadmap_id, current_phase: state.current_phase, requirement_id: requirement.id, acceptance_criteria: requirement.acceptance_criteria, expected_advancement: requirement.expected_advancement, convergence_condition: requirement.convergence_condition, authorization: 'NOT_GRANTED', execution: 'NOT_STARTED', desired_outcome_verification: 'NOT_ESTABLISHED' };
}

function evaluateCoordinatorIntent(objective, options) {
  const stateResult = loadAuthoritativeStrategicState(options);
  if (stateResult.status !== 'VALID') return stateResult;
  const requirement = selectRequirementForObjective(stateResult.state, objective);
  if (!requirement) return blocked('OBJECTIVE_NOT_MAPPED', 'Coordinator intent does not map to required authoritative work.');
  return evaluateStrategicAlignment(stateResult.state, { roadmap_id: stateResult.state.roadmap_id, current_phase: stateResult.state.current_phase, requirement_id: requirement.id, classification: requirement.classification, objective });
}

function evaluateConvergence(state, evidence) {
  const stateResult = validateStrategicState(state);
  if (stateResult.status !== 'VALID') return stateResult;
  if (!evidence || typeof evidence !== 'object') return blocked('DESIRED_OUTCOME_UNVERIFIED', 'Authoritative convergence evidence is required.');
  if (evidence.mode === 'phase_transition') {
    const requirement = state.unresolved_requirements.find((item) => item.id === evidence.requirement_id);
    if (!requirement || !state.required_next_work.includes(requirement.id)) return blocked('UNRESOLVED_REQUIREMENT_NOT_ESTABLISHED', 'Transition requirement is not authoritative required next work.');
    const unmet = (requirement.prerequisites || []).find((id) => !state.completed_requirements.some((item) => item.id === id));
    if (unmet) return blocked('PREREQUISITE_UNPROVEN', `Prerequisite ${unmet} is not completed in authoritative state.`);
    if (!Array.isArray(state.phase_acceptance_criteria) || !state.phase_acceptance_criteria.includes(evidence.acceptance_criteria_id)) return blocked('ACCEPTANCE_CRITERION_UNPROVEN', 'Acceptance criterion is not satisfied by authoritative current-phase evidence.');
    if (!Array.isArray(state.phase_transition_conditions) || !state.phase_transition_conditions.includes(evidence.convergence_condition)) return blocked('INVALID_CONVERGENCE_CONDITION', 'Convergence condition is not authoritative.');
    if (state.phase_status !== 'CONVERGED') return blocked('CURRENT_PHASE_NOT_CONVERGED', 'Current phase is not authoritatively converged.');
    if (!evidence.independent_verification) return blocked('DESIRED_OUTCOME_UNVERIFIED', 'Independent verification evidence is required for phase transition.');
    return { status: 'CONVERGED_ESCALATE_TRANSITION', escalation: 'Kyle — Director', authorization: 'NOT_GRANTED', requirement_id: requirement.id };
  }
  const requirement = state.unresolved_requirements.find((item) => item.id === evidence.requirement_id);
  if (!requirement || !evidence.independent_verification || evidence.acceptance_criteria_id !== requirement.acceptance_criteria?.[0] || evidence.convergence_condition !== requirement.convergence_condition) return blocked('DESIRED_OUTCOME_UNVERIFIED', 'Technical completion does not establish authoritative convergence.');
  return { status: 'CONVERGED_ESCALATE_TRANSITION', escalation: 'Kyle — Director', authorization: 'NOT_GRANTED' };
}

module.exports = { stateHash, loadAuthoritativeStrategicState, validateStrategicState, selectRequirementForObjective, evaluateStrategicAlignment, evaluateCoordinatorIntent, evaluateConvergence };
