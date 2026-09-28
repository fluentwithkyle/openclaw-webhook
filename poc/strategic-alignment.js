'use strict';

const REQUIRED_STATE_FIELDS = [
  'roadmap_id', 'current_phase', 'phase_status', 'current_strategic_objective',
  'phase_acceptance_criteria', 'completed_requirements', 'unresolved_requirements',
  'required_next_work', 'prerequisites', 'phase_transition_conditions'
];

function blocked(code, detail) {
  return { status: 'BLOCKED', code, detail, escalation: 'Kyle — Director', authorization: 'NOT_GRANTED' };
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

function evaluateStrategicAlignment(state, proposal) {
  const stateResult = validateStrategicState(state);
  if (stateResult.status !== 'VALID') return stateResult;
  if (!proposal || typeof proposal !== 'object') return blocked('PROPOSAL_UNAVAILABLE', 'A proposed work item is required.');

  const required = ['roadmap_id', 'current_phase', 'requirement_id', 'classification', 'expected_advancement', 'convergence_criterion'];
  for (const field of required) {
    if (!proposal[field]) return blocked('PROPOSAL_INCOMPLETE', `Missing proposal field: ${field}.`);
  }
  if (proposal.roadmap_id !== state.roadmap_id || proposal.current_phase !== state.current_phase) {
    return blocked('STALE_OR_CONTRADICTORY_ROADMAP', 'Proposal does not match the authoritative roadmap identity and current phase.');
  }
  if (!['A', 'B', 'C', 'D'].includes(proposal.classification)) {
    return blocked('INVALID_CLASSIFICATION', 'Classification must be A, B, C, or D.');
  }
  if (proposal.classification === 'C' || proposal.classification === 'D') {
    return blocked('STRATEGIC_DRIFT', 'Optional optimization and premature capability expansion are not selectable work.');
  }

  const requirement = state.unresolved_requirements.find((item) => item.id === proposal.requirement_id);
  if (!requirement) {
    if (state.completed_requirements.some((item) => item.id === proposal.requirement_id)) {
      return blocked('REQUIREMENT_ALREADY_COMPLETE', 'A completed requirement cannot establish strategic alignment.');
    }
    return blocked('UNRESOLVED_REQUIREMENT_NOT_ESTABLISHED', 'Proposal does not map to an authoritative unresolved requirement.');
  }
  if (proposal.classification !== requirement.classification) {
    return blocked('CLASSIFICATION_MISMATCH', 'The proposal classification does not match the authoritative requirement.');
  }
  if (!state.required_next_work.includes(requirement.id)) {
    return blocked('NOT_REQUIRED_NEXT_WORK', 'The mapped unresolved requirement is not currently selectable.');
  }
  const unmetPrerequisite = (requirement.prerequisites || []).find((id) => !state.completed_requirements.some((item) => item.id === id));
  if (unmetPrerequisite) return blocked('PREREQUISITE_UNPROVEN', `Prerequisite ${unmetPrerequisite} is not completed in authoritative state.`);
  if (proposal.classification === 'B' && !requirement.enables) {
    return blocked('ENABLING_DEPENDENCY_UNPROVEN', 'Enabling work requires an authoritative dependency it unlocks.');
  }

  return {
    status: 'ALIGNED_PENDING_AUTHORIZATION',
    roadmap_id: state.roadmap_id,
    current_phase: state.current_phase,
    requirement_id: requirement.id,
    required_next_work: state.required_next_work,
    convergence_criterion: proposal.convergence_criterion,
    authorization: 'NOT_GRANTED',
    execution: 'NOT_STARTED',
    desired_outcome_verification: 'NOT_ESTABLISHED'
  };
}

function evaluateConvergence(state, evidence) {
  const stateResult = validateStrategicState(state);
  if (stateResult.status !== 'VALID') return stateResult;
  if (!evidence || evidence.requirement_id !== state.required_next_work[0]) return blocked('CONVERGENCE_EVIDENCE_UNAVAILABLE', 'Authoritative required-work evidence is unavailable.');
  if (!evidence.independent_verification) return blocked('DESIRED_OUTCOME_UNVERIFIED', 'Technical completion does not establish desired-outcome verification.');
  if (!evidence.phase_acceptance_criteria_met) return blocked('PHASE_NOT_CONVERGED', 'Phase acceptance criteria are not established.');
  return { status: 'CONVERGED_ESCALATE_TRANSITION', escalation: 'Kyle — Director', authorization: 'NOT_GRANTED' };
}

module.exports = { validateStrategicState, evaluateStrategicAlignment, evaluateConvergence };
