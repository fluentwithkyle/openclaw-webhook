const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const activationPolicy = require('../activation-policy');

const ACP_COMMAND_REQUIRED_FIELDS = [
  'protocol_version',
  'request_id',
  'source',
  'target',
  'task_type',
  'repository',
  'base_branch',
  'task',
  'constraints',
  'authorization',
  'verification',
  'reporting'
];

const EXECUTION_REPORT_REQUIRED_FIELDS = [
  'request_id',
  'agent',
  'status',
  'task',
  'changed_files',
  'verification',
  'result',
  'commit',
  'push',
  'blockers'
];

const VALID_AGENTS = ['Kilo', 'Gemini', 'Gemini Builder', 'Security Specialist', 'Utility Specialist'];
const VALID_STATUSES = ['success', 'failure', 'blocked'];

const TASK_REGISTRY_REQUIRED_FIELDS = [
  'request_id',
  'parent_request_id',
  'originator',
  'current_agent',
  'next_agent',
  'repository',
  'base_branch',
  'task',
  'status',
  'created_at',
  'updated_at',
   'kilo',
   'gemini',
   'builder',
   'next_action',
  'verification'
];

const ACP_LIFECYCLE_STATES = Object.freeze(['PENDING', 'SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE', 'BLOCKED', 'FAILED']);
const LINEAGE_CONTROL_SEMANTICS = Object.freeze(['CANCELLED', 'SUPERSEDED']);

const VALID_STATE_TRANSITIONS = {
  'PENDING': ['SELECTED'],
  'SELECTED': ['PLANNED'],
  'PLANNED': ['EXECUTING'],
  'EXECUTING': ['VERIFIED', 'BLOCKED', 'FAILED'],
  'VERIFIED': ['COMPLETE'],
  'BLOCKED': [],
  'FAILED': [],
  'COMPLETE': []
};

const EVIDENCE_TYPES = ['AGENT_REPORT', 'WORKFLOW_SUCCESS', 'INDEPENDENT_VERIFICATION'];
const LIFECYCLE_EVIDENCE_SEMANTICS = Object.freeze({
  AGENT_REPORT: 'Records an agent execution report; it does not independently verify an outcome.',
  INDEPENDENT_VERIFICATION: 'Required evidence for EXECUTING -> VERIFIED and VERIFIED -> COMPLETE transitions.',
  VERIFIED_OUTCOME_STATUSES: Object.freeze(['VERIFIED', 'COMPLETE']),
  LINEAGE_CONTROL_SEMANTICS: 'CANCELLED and SUPERSEDED are TaskRegistry lineage/control semantics, not ACP lifecycle states.'
});

const STATE_TRANSITION_EVIDENCE = {
  'EXECUTING': {
    'VERIFIED': ['INDEPENDENT_VERIFICATION']
  },
  'VERIFIED': {
    'COMPLETE': ['INDEPENDENT_VERIFICATION']
  }
};

const CONFIG_VERIFICATION_STATES = ['VERIFIED', 'UNVERIFIED', 'PROPOSED', 'UNKNOWN'];

// External configuration prerequisite contract.
// A prerequisite is an external configuration value that must be declared and
// validated before consequential task execution. Each prerequisite carries:
//  - config_key: the configuration identity (e.g. an environment variable name).
//    Only the identity is recorded; secret values are never captured.
//  - reason: short human-readable explanation of why the prerequisite is required.
//  - required: boolean — true for prerequisites that block consequential execution.
//  - mode: the execution mode that requires this prerequisite (e.g. 'FAILOVER_EXECUTE').
const CONFIG_PREREQUISITE_STATES = Object.freeze(['DIRECTOR_NOTIFIED', 'CONFIGURATION_SATISFIED', 'UNKNOWN']);

const PREREQUISITE_EVALUATION_STATES = {
  DIRECTOR_NOTIFIED: 'DIRECTOR_NOTIFIED',
  CONFIGURATION_SATISFIED: 'CONFIGURATION_SATISFIED',
  UNKNOWN: 'UNKNOWN'
};

function createConfigPrerequisite(configKey, reason, mode, required) {
  if (!configKey || typeof configKey !== 'string') {
    return { error: 'config_key is required and must be a non-empty string' };
  }
  return {
    config_key: configKey,
    reason: reason || 'External configuration required for execution',
    mode: mode || null,
    required: required !== false,
    state: 'UNKNOWN',
    satisfied: false,
    notified_at: null
  };
}

// Activation syntax is matched EXACTLY (case-sensitive). No regex flags that
// would normalize case, because the repository protocol requires the exact
// lowercase forms "@kilo" and "@gemini-cli".
const KILO_ACTIVATION_PATTERN = /^@kilo\b/;
const GEMINI_CLI_ACTIVATION_PATTERN = /^@gemini-cli\b/;
const GEMINI_BARE_PATTERN = /^@Gemini\b/;
const ARBITRARY_MENTION_PATTERN = /@gemini\b/;

// Task modes and activation surfaces are now governed by the server-controlled
// activation-policy module. These references preserve backward compatibility
// while delegating to the canonical agent x task-mode x activation-surface policy.
const EXECUTION_TASK_MODES = activationPolicy.EXECUTION_TASK_MODES;
const VALID_ACTIVATION_SURFACES = activationPolicy.VALID_ACTIVATION_SURFACES_LEGACY;

const AGENT_EVIDENCE_TYPE = {
  'Kilo': 'AGENT_REPORT',
  'Gemini Builder': 'AGENT_REPORT',
  'Gemini': 'INDEPENDENT_VERIFICATION'
};

const VALID_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT'];
const DEFAULT_TASK_MODE = 'REVIEW';
const VALID_WORKFLOW_STAGES = Object.freeze(['review', 'implementation', 'verification', 'reconciliation']);

const VALID_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push', 'run_tests'];

const MAX_AUTHORIZED_PATHS = activationPolicy.MAX_AUTHORIZED_PATHS;

const REVIEW_CAPABILITIES = ['read_only'];
const VERIFY_RECONCILE_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push'];
const FAILOVER_EXECUTE_CAPABILITIES = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
const BUILDER_CAPABILITIES = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
const RESEARCH_DOCUMENT_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push'];

const VERIFY_RECONCILE_PATHS = [
  'docs/ai/TASK_LOG.md',
  'docs/ai/STATE.md',
  'docs/ai/CONTROL_CENTER.md'
];

const RESEARCH_DOCUMENT_PATHS = [
  'docs/ai/research/',
  'docs/ai/RESEARCH_INDEX.md',
  'docs/ai/TASK_LOG.md',
  'docs/ai/STATE.md',
  'docs/ai/CONTROL_CENTER.md',
  'docs/ai/README.md',
  'docs/ai/ARCH_DECISIONS.md',
  'poc/schemas/acp-schema.js',
  'test/schema.test.js'
];

const VALID_RECONCILIATION_STATUSES = ['COMPLETED', 'SKIPPED', 'FAILED'];

function getRequiredCapabilitiesForMode(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  switch (mode) {
    case 'VERIFY_RECONCILE': return VERIFY_RECONCILE_CAPABILITIES;
    case 'FAILOVER_EXECUTE': return FAILOVER_EXECUTE_CAPABILITIES;
    case 'BUILDER': return BUILDER_CAPABILITIES;
    case 'RESEARCH_DOCUMENT': return RESEARCH_DOCUMENT_CAPABILITIES;
    case 'REVIEW':
    default: return REVIEW_CAPABILITIES.slice();
  }
}

function getAuthorizedPathsForMode(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  if (mode === 'VERIFY_RECONCILE') return VERIFY_RECONCILE_PATHS;
  if (mode === 'RESEARCH_DOCUMENT') return RESEARCH_DOCUMENT_PATHS;
  return null;
}

function getModeCapabilities(mode) {
  return getRequiredCapabilitiesForMode(mode);
}

function validateTaskMode(taskMode) {
  if (!taskMode) {
    return { valid: true, task_mode: DEFAULT_TASK_MODE };
  }
  if (!VALID_TASK_MODES.includes(taskMode)) {
    return { valid: false, error: `Invalid task_mode: ${taskMode}. Must be one of: ${VALID_TASK_MODES.join(', ')}` };
  }
  return { valid: true, task_mode: taskMode };
}

function validateCapabilitiesForMode(taskMode, capabilities) {
  const mode = taskMode || DEFAULT_TASK_MODE;

  if (!Array.isArray(capabilities)) {
    return { valid: false, error: 'authorization.capabilities must be an array' };
  }

  for (const cap of capabilities) {
    if (!VALID_CAPABILITIES.includes(cap)) {
      return { valid: false, error: `Invalid capability: ${cap}. Must be one of: ${VALID_CAPABILITIES.join(', ')}` };
    }
  }

  const required = getRequiredCapabilitiesForMode(mode);

  if (mode === 'REVIEW') {
    if (capabilities.length !== 1 || capabilities[0] !== 'read_only') {
      return { valid: false, error: 'REVIEW mode requires exactly ["read_only"] capability' };
    }
    return { valid: true };
  }

  if (mode === 'RESEARCH_DOCUMENT') {
    const requiredCaps = RESEARCH_DOCUMENT_CAPABILITIES;
    if (capabilities.length !== requiredCaps.length) {
      return { valid: false, error: `RESEARCH_DOCUMENT mode requires exactly ${JSON.stringify(requiredCaps)} capabilities` };
    }
    for (const cap of requiredCaps) {
      if (!capabilities.includes(cap)) {
        return { valid: false, error: `RESEARCH_DOCUMENT mode requires capability: ${cap}` };
      }
    }
    return { valid: true };
  }

  for (const cap of required) {
    if (!capabilities.includes(cap)) {
      return { valid: false, error: `${mode} mode requires capability: ${cap}` };
    }
  }

  return { valid: true };
}

function validatePermittedPathsForMode(taskMode, permittedPaths) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  const authorizedPaths = getAuthorizedPathsForMode(mode);

  if (!Array.isArray(permittedPaths)) {
    return { valid: false, error: 'constraints.permitted_paths must be an array' };
  }

  if (EXECUTION_TASK_MODES.includes(mode)) {
    for (const p of permittedPaths) {
      const withinBoundary = MAX_AUTHORIZED_PATHS.some(maxPath => p === maxPath || p.startsWith(maxPath));
      if (!withinBoundary) {
        return { valid: false, error: 'Path outside server-defined maximum authorization boundary (' + MAX_AUTHORIZED_PATHS.join(', ') + '): ' + p };
      }
    }
    if (permittedPaths.length === 0) {
      return { valid: false, error: 'constraints.permitted_paths must not be empty' };
    }
    return { valid: true };
  }

  if (authorizedPaths === null) {
    if (permittedPaths.length === 0) {
      return { valid: false, error: 'constraints.permitted_paths must not be empty' };
    }
    return { valid: true };
  }

  for (const p of permittedPaths) {
    const isAuthorized = authorizedPaths.includes(p) ||
      authorizedPaths.some(authPath => authPath.endsWith('/') && p.startsWith(authPath));
    if (!isAuthorized) {
      return { valid: false, error: `Unauthorized path for ${mode}: ${p}. Authorized paths: ${authorizedPaths.join(', ')}` };
    }
  }

  return { valid: true };
}

function canonicalizeDirectorScope(scope) {
  return JSON.stringify({
    request_id: scope.request_id,
    target: scope.target,
    task_mode: scope.task_mode,
    capabilities: [...scope.capabilities].sort(),
    permitted_paths: [...scope.permitted_paths].sort(),
    repository: scope.repository,
    base_branch: scope.base_branch
  });
}

function getDirectorScope(command) {
  return {
    request_id: command.request_id,
    target: command.target,
    task_mode: command.task_mode || DEFAULT_TASK_MODE,
    capabilities: command.authorization && command.authorization.capabilities,
    permitted_paths: command.constraints && command.constraints.permitted_paths,
    repository: command.repository,
    base_branch: command.base_branch
  };
}

function validateDirectorApprovalScope(scope) {
  if (!scope || typeof scope !== 'object') return { valid: false, error: 'Director approval scope must be an object' };
  for (const field of ['request_id', 'target', 'task_mode', 'repository', 'base_branch']) {
    if (typeof scope[field] !== 'string' || scope[field].trim() === '') return { valid: false, error: 'Director approval scope requires ' + field };
  }
  const mode = validateTaskMode(scope.task_mode);
  if (!mode.valid) return mode;
  if (!VALID_AGENTS.includes(scope.target)) return { valid: false, error: 'Invalid Director approval target' };
  const caps = validateCapabilitiesForMode(scope.task_mode, scope.capabilities);
  if (!caps.valid) return caps;
  const paths = validatePermittedPathsForMode(scope.task_mode, scope.permitted_paths);
  if (!paths.valid || scope.permitted_paths.length === 0) return paths.valid ? { valid: false, error: 'Director approval scope requires permitted_paths' } : paths;
  return { valid: true };
}

function calculateDirectorScopeHash(scope) {
  return crypto.createHash('sha256').update(canonicalizeDirectorScope(scope)).digest('hex');
}

function isConsequentialCommand(command) {
  const scope = getDirectorScope(command);
  if (scope.task_mode === 'BUILDER' || scope.task_mode === 'FAILOVER_EXECUTE') {
    return true;
  }
  return false;
}

function validateWorkflowStage(workflowStage) {
  if (workflowStage === undefined || workflowStage === null) return { valid: true };
  if (typeof workflowStage !== 'string' || !VALID_WORKFLOW_STAGES.includes(workflowStage)) {
    return { valid: false, error: `Invalid workflow_stage: ${workflowStage}. Must be one of: ${VALID_WORKFLOW_STAGES.join(', ')}` };
  }
  return { valid: true };
}

function validateAuthorization(command) {
  const workflowStageValidation = validateWorkflowStage(command.workflow_stage);
  if (!workflowStageValidation.valid) return workflowStageValidation;
  const rawMode = command.task_mode || DEFAULT_TASK_MODE;

  const modeValidation = validateTaskMode(rawMode);
  if (!modeValidation.valid) {
    return modeValidation;
  }

  const capabilities = command.authorization && command.authorization.capabilities;
  const permittedPaths = command.constraints && command.constraints.permitted_paths;

  const capValidation = validateCapabilitiesForMode(rawMode, capabilities);
  if (!capValidation.valid) {
    return capValidation;
  }

  const pathValidation = validatePermittedPathsForMode(rawMode, permittedPaths);
  if (!pathValidation.valid) {
    return pathValidation;
  }

  return { valid: true, task_mode: rawMode };
}

function validateReconciliation(reconciliation) {
  if (reconciliation === undefined || reconciliation === null) {
    return { valid: true };
  }

  if (typeof reconciliation !== 'object') {
    return { valid: false, error: 'reconciliation must be an object' };
  }

  if (!reconciliation.status) {
    return { valid: false, error: 'reconciliation.status is required' };
  }

  if (!VALID_RECONCILIATION_STATUSES.includes(reconciliation.status)) {
    return { valid: false, error: `Invalid reconciliation.status: ${reconciliation.status}. Must be one of: ${VALID_RECONCILIATION_STATUSES.join(', ')}` };
  }

  if (!Array.isArray(reconciliation.changed_files)) {
    return { valid: false, error: 'reconciliation.changed_files must be an array' };
  }

  if (reconciliation.commit_sha !== null && typeof reconciliation.commit_sha !== 'string') {
    return { valid: false, error: 'reconciliation.commit_sha must be a string or null' };
  }

  return { valid: true };
}

function determineReconciliationStatus(verificationStatus, taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;

  if (mode !== 'VERIFY_RECONCILE') {
    return { status: 'SKIPPED', reason: `Reconciliation not applicable for mode: ${mode}` };
  }

  if (verificationStatus === 'success' || verificationStatus === 'PASS') {
    return { status: 'COMPLETED', reason: 'Verification passed; reconciliation permitted' };
  }

  if (verificationStatus === 'failure' || verificationStatus === 'FAIL') {
    return { status: 'SKIPPED', reason: 'Verification failed; reconciliation prohibited' };
  }

  if (verificationStatus === 'blocked' || verificationStatus === 'BLOCKED') {
    return { status: 'SKIPPED', reason: 'Verification blocked; reconciliation prohibited' };
  }

  return { status: 'SKIPPED', reason: `Unknown verification status: ${verificationStatus}` };
}

function validateACPCommand(command) {
  if (!command || typeof command !== 'object') {
    return { valid: false, error: 'Command must be an object' };
  }

  for (const field of ACP_COMMAND_REQUIRED_FIELDS) {
    if (!command[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (!command.constraints || !Array.isArray(command.constraints.permitted_paths)) {
    return { valid: false, error: 'constraints.permitted_paths must be an array' };
  }

  if (!command.authorization || !Array.isArray(command.authorization.capabilities)) {
    return { valid: false, error: 'authorization.capabilities must be an array' };
  }

  return validateWorkflowStage(command.workflow_stage);
}

function validateExecutionReport(report) {
  if (!report || typeof report !== 'object') {
    return { valid: false, error: 'Report must be an object' };
  }

  for (const field of EXECUTION_REPORT_REQUIRED_FIELDS) {
    if (!(field in report)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (!VALID_AGENTS.includes(report.agent)) {
    return { valid: false, error: `Invalid agent: ${report.agent}. Must be one of: ${VALID_AGENTS.join(', ')}` };
  }

  if (!VALID_STATUSES.includes(report.status)) {
    return { valid: false, error: `Invalid status: ${report.status}. Must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  if (!Array.isArray(report.changed_files)) {
    return { valid: false, error: 'changed_files must be an array' };
  }

  if (!Array.isArray(report.verification)) {
    return { valid: false, error: 'verification must be an array' };
  }

  if (!Array.isArray(report.blockers)) {
    return { valid: false, error: 'blockers must be an array' };
  }

  if (report.commit !== null && typeof report.commit !== 'string') {
    return { valid: false, error: 'commit must be a string or null' };
  }

  if (typeof report.push !== 'boolean') {
    return { valid: false, error: 'push must be a boolean' };
  }

  if (typeof report.result !== 'object' || report.result === null) {
    return { valid: false, error: 'result must be an object' };
  }

  if (!report.result.execution_metadata || typeof report.result.execution_metadata !== 'object') {
    return { valid: false, error: 'result.execution_metadata must be an object' };
  }

  if (!report.result.execution_metadata.invocation_id || typeof report.result.execution_metadata.invocation_id !== 'string') {
    return { valid: false, error: 'result.execution_metadata.invocation_id is required and must be a string' };
  }

  if (report.result.execution_metadata.run_id !== undefined && typeof report.result.execution_metadata.run_id !== 'string') {
    return { valid: false, error: 'result.execution_metadata.run_id must be a string' };
  }

  if ('reconciliation' in report) {
    const reconValidation = validateReconciliation(report.reconciliation);
    if (!reconValidation.valid) {
      return reconValidation;
    }
  }

  return { valid: true };
}

function validateTaskRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: 'Entry must be an object' };
  }

  for (const field of TASK_REGISTRY_REQUIRED_FIELDS) {
    if (!(field in entry)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (!VALID_AGENTS.includes(entry.current_agent) && entry.current_agent !== null) {
    return { valid: false, error: `Invalid current_agent: ${entry.current_agent}` };
  }

  if (Object.prototype.hasOwnProperty.call(entry, 'workflow_stage') && entry.workflow_stage !== null) {
    const workflowStageValidation = validateWorkflowStage(entry.workflow_stage);
    if (!workflowStageValidation.valid) return workflowStageValidation;
  }

  if (!VALID_AGENTS.includes(entry.next_agent) && entry.next_agent !== null) {
    return { valid: false, error: `Invalid next_agent: ${entry.next_agent}` };
  }

  const validRegistryStatuses = ['PENDING', 'SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE', 'BLOCKED', 'FAILED'];
  if (!validRegistryStatuses.includes(entry.status)) {
    return { valid: false, error: `Invalid status: ${entry.status}` };
  }

  return { valid: true };
}

function isValidStateTransition(from, to) {
  const allowed = VALID_STATE_TRANSITIONS[from];
  return allowed && allowed.includes(to);
}

function createInitialTaskRegistryEntry(requestId, command) {
   const now = new Date().toISOString();
   const taskMode = command.task_mode || DEFAULT_TASK_MODE;
   const capabilities = (command.authorization && command.authorization.capabilities) ? command.authorization.capabilities : ['read_only'];
   const permittedPaths = (command.constraints && command.constraints.permitted_paths) ? command.constraints.permitted_paths : [];
   return {
     request_id: requestId,
     parent_request_id: command.parent_request_id || null,
     originator: command.originator || 'Kyle',
     current_agent: command.target,
     next_agent: 'Gemini',
     repository: command.repository,
     base_branch: command.base_branch,
     task: command.task,
     task_mode: taskMode,
     workflow_stage: command.workflow_stage || null,
     status: 'PENDING',
     created_at: now,
     updated_at: now,
     kilo: {
       status: 'pending',
       execution_id: null,
       report: null,
       provider_session_id: null,
       provider_message_id: null,
       provider_invocation_id: null
     },
     gemini: {
       status: 'pending',
       execution_id: null,
       report: null
     },
     builder: {
       status: 'pending',
       execution_id: null,
       report: null
     },
     next_action: null,
     verification: command.verification,
     capabilities: capabilities,
     permitted_paths: permittedPaths,
     evidence: [],
     lineage: {
       superseded_by: null,
       superseded_at: null,
       cancelled: false,
       cancelled_at: null
     },
      config_verification: {},
      transition_decision_provenance: command.director_transition_decision_provenance || null
    };
  }

  function verifyConfiguration(configKey, options) {
    options = options || {};
    const task = options.task;
    const claimed = options.claimed;

    if (!configKey || typeof configKey !== 'string') {
      return { state: 'UNKNOWN', verified: false, source: null, key: configKey };
    }

    const runtimeEnv = (typeof process !== 'undefined' && process.env) ? process.env : {};
    if (Object.prototype.hasOwnProperty.call(runtimeEnv, configKey)) {
      return { state: 'VERIFIED', verified: true, source: 'runtime_env', key: configKey };
    }

    if (task && typeof task === 'object') {
      if (configKey === 'repository' && task.repository === claimed) {
        return { state: 'VERIFIED', verified: true, source: 'task_registry', key: configKey };
      }
      if (configKey === 'base_branch' && task.base_branch === claimed) {
        return { state: 'VERIFIED', verified: true, source: 'task_registry', key: configKey };
      }
      if (configKey === 'target' && task.current_agent === claimed) {
        return { state: 'VERIFIED', verified: true, source: 'task_registry', key: configKey };
      }
    }

    if (claimed !== undefined && claimed !== null && claimed !== '') {
      return { state: 'PROPOSED', verified: false, source: 'claim', key: configKey };
    }

    return { state: 'UNKNOWN', verified: false, source: null, key: configKey };
  }

  function isConfigurationAuthoritativelyVerified(result) {
    return Boolean(result) && result.state === 'VERIFIED' && result.verified === true;
  }

  function evaluatePrerequisite(prerequisite, taskEntry, runtimeEnv) {
    var env = runtimeEnv || (typeof process !== 'undefined' && process.env) || {};
    var configKey = prerequisite.config_key;
    var verificationResult;

    if (typeof verifyConfiguration === 'function') {
      verificationResult = verifyConfiguration(configKey, {
        env: env,
        task: taskEntry,
        claimed: prerequisite.claimed || null
      });
    } else {
      if (Object.prototype.hasOwnProperty.call(env, configKey)) {
        verificationResult = { state: 'VERIFIED', verified: true, source: 'runtime_env', key: configKey };
      } else {
        verificationResult = { state: 'UNKNOWN', verified: false, source: null, key: configKey };
      }
    }

    var state;
    if (isConfigurationAuthoritativelyVerified(verificationResult)) {
      state = 'CONFIGURATION_SATISFIED';
    } else if (verificationResult.state === 'PROPOSED') {
      state = 'DIRECTOR_NOTIFIED';
    } else {
      state = 'UNKNOWN';
    }

    return {
      config_key: configKey,
      state: state,
      satisfied: state === 'CONFIGURATION_SATISFIED',
      verification_result: verificationResult,
      notified_at: state === 'DIRECTOR_NOTIFIED' ? (prerequisite.notified_at || new Date().toISOString()) : prerequisite.notified_at || null
    };
  }

  function validateEvidenceRecord(evidence) {
   if (!evidence || typeof evidence !== 'object') {
     return { valid: false, error: 'Evidence must be an object' };
   }

   if (!evidence.request_id || typeof evidence.request_id !== 'string') {
     return { valid: false, error: 'evidence.request_id is required and must be a string' };
   }

   if (!evidence.evidence_type || !EVIDENCE_TYPES.includes(evidence.evidence_type)) {
     return { valid: false, error: 'evidence.evidence_type must be one of: ' + EVIDENCE_TYPES.join(', ') };
   }

   if (!evidence.agent || !VALID_AGENTS.includes(evidence.agent)) {
     return { valid: false, error: 'evidence.agent must be one of: ' + VALID_AGENTS.join(', ') };
   }

   if (!evidence.timestamp || typeof evidence.timestamp !== 'string') {
     return { valid: false, error: 'evidence.timestamp is required and must be a string' };
   }

    return { valid: true };
  }

  function validateAgentEvidenceType(agent, evidenceType) {
    if (!VALID_AGENTS.includes(agent)) {
      return { valid: false, error: 'Unknown agent: ' + agent };
    }
    const expected = AGENT_EVIDENCE_TYPE[agent];
    if (!expected) {
      return { valid: false, error: 'No evidence type registered for agent: ' + agent };
    }
    if (evidenceType !== expected) {
      return {
        valid: false,
        error: 'Agent ' + agent + ' may not record ' + evidenceType + ' evidence. ' + agent + ' is restricted to ' + expected
      };
    }
    return { valid: true };
  }

  function getRequiredEvidenceForTransition(from, to) {
   if (STATE_TRANSITION_EVIDENCE[from] && STATE_TRANSITION_EVIDENCE[from][to]) {
     return STATE_TRANSITION_EVIDENCE[from][to];
   }
   return [];
 }

 function validateStateTransitionWithEvidence(from, to, evidenceRecords) {
   if (!isValidStateTransition(from, to)) {
     return { valid: false, error: 'Invalid state transition: ' + from + ' -> ' + to };
   }

   const required = getRequiredEvidenceForTransition(from, to);
   if (required.length === 0) {
     return { valid: true };
   }

   const evidenceList = Array.isArray(evidenceRecords) ? evidenceRecords : [];
   for (const requiredType of required) {
     const hasEvidence = evidenceList.some(e =>
       e && e.evidence_type === requiredType && e.request_id
     );
     if (!hasEvidence) {
       return {
         valid: false,
         error: 'Transition ' + from + ' -> ' + to + ' requires ' + requiredType + ' evidence',
         missing_evidence: requiredType
       };
     }
   }

   return { valid: true };
 }

 function createEvidenceRecord(requestId, evidenceType, agent, reportData, taskEntry) {
   return {
     evidence_id: 'evidence-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
     request_id: requestId,
     evidence_type: evidenceType,
     agent: agent,
     execution_id: (reportData && reportData.execution_id) || null,
     task: (taskEntry && taskEntry.task) || (reportData && reportData.task) || '',
     repository: (taskEntry && taskEntry.repository) || (reportData && reportData.repository) || '',
     base_branch: (taskEntry && taskEntry.base_branch) || (reportData && reportData.base_branch) || '',
     commit_sha: (reportData && reportData.commit) || (reportData && reportData.commit_sha) || null,
     timestamp: new Date().toISOString(),
     verification_result: (reportData && reportData.status) || null
   };
 }

  function validateActivationSyntax(activationText, expectedTarget) {
    return activationPolicy.validateActivationSyntax(activationText, expectedTarget);
  }

function validateActivationSurface(surface, target, taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  if (EXECUTION_TASK_MODES.includes(mode)) {
    return activationPolicy.validateActivationSurface(surface, target, mode);
  }
  const allowed = VALID_ACTIVATION_SURFACES[target];
  if (!allowed) {
    return { valid: false, error: 'No activation surfaces defined for target: ' + target };
  }
  if (!surface || !allowed.includes(surface)) {
    return { valid: false, error: 'Unauthorized activation surface for ' + target + ': ' + surface + '. Authorized: ' + allowed.join(', ') };
  }
  return { valid: true };
}

function taskModeRequiresActivation(taskMode) {
  return EXECUTION_TASK_MODES.includes(taskMode || DEFAULT_TASK_MODE);
}

function validateACPCompliance(command) {
   const basicValidation = validateACPCommand(command);
   if (!basicValidation.valid) {
     return basicValidation;
   }

   if (typeof command.request_id !== 'string' || command.request_id.length === 0) {
     return { valid: false, error: 'request_id must be a non-empty string' };
   }

   if (!command.originator && !command.source) {
     return { valid: false, error: 'Missing originator or source' };
   }

   if (!VALID_AGENTS.includes(command.target)) {
     return { valid: false, error: 'Invalid or unauthorized target agent: ' + command.target };
   }

   if (typeof command.repository !== 'string' || command.repository.length === 0) {
     return { valid: false, error: 'repository must be a non-empty string' };
   }

   if (typeof command.base_branch !== 'string' || command.base_branch.length === 0) {
     return { valid: false, error: 'base_branch must be a non-empty string' };
   }

   if (typeof command.task_type !== 'string' || command.task_type.length === 0) {
     return { valid: false, error: 'task_type must be a non-empty string' };
   }

   const taskMode = command.task_mode || DEFAULT_TASK_MODE;
   if (!VALID_TASK_MODES.includes(taskMode)) {
     return { valid: false, error: 'Invalid task_mode: ' + taskMode };
   }

   const capValidation = validateCapabilitiesForMode(taskMode, command.authorization.capabilities);
   if (!capValidation.valid) {
     return capValidation;
   }

   const pathValidation = validatePermittedPathsForMode(taskMode, command.constraints.permitted_paths);
   if (!pathValidation.valid) {
     return pathValidation;
   }

   if (typeof command.task !== 'string' || command.task.length === 0) {
     return { valid: false, error: 'task/objective must be a non-empty string' };
   }

   if (command.constraints.permitted_paths.length === 0) {
     return { valid: false, error: 'constraints.permitted_paths must not be empty (scope required)' };
   }

   if (typeof command.verification !== 'string' || command.verification.trim().length === 0) {
     return { valid: false, error: 'verification requirements must be specified' };
   }

   if (typeof command.reporting !== 'string' || command.reporting.trim().length === 0) {
     return { valid: false, error: 'reporting requirements must be specified' };
   }

   if (command.authorization.capabilities.includes('push') && !command.authorization.capabilities.includes('commit')) {
     return { valid: false, error: 'push capability requires commit capability (contradictory authorization)' };
   }
   if (command.authorization.capabilities.includes('commit') && !command.authorization.capabilities.includes('modify_files')) {
     return { valid: false, error: 'commit capability requires modify_files capability (contradictory authorization)' };
   }
   if (command.authorization.capabilities.includes('run_tests') && !command.authorization.capabilities.includes('modify_files')) {
     return { valid: false, error: 'run_tests capability requires modify_files capability (contradictory authorization)' };
   }

    if (taskModeRequiresActivation(taskMode)) {
      if (!command.activation_syntax) {
        return { valid: false, error: 'Execution artifact requires activation_syntax for task_mode ' + taskMode };
      }
      if (!command.activation_surface) {
        return { valid: false, error: 'Execution artifact requires activation_surface for task_mode ' + taskMode };
      }
    }

    if (command.activation_syntax) {
      const activationValidation = validateActivationSyntax(command.activation_syntax, command.target);
      if (!activationValidation.valid) {
        return { valid: false, error: activationValidation.error };
      }
    }

     if (command.activation_surface) {
      const surfaceValidation = validateActivationSurface(command.activation_surface, command.target, taskMode);
      if (!surfaceValidation.valid) {
        return surfaceValidation;
      }
    }

    return { valid: true, task_mode: taskMode };
  }

module.exports = {
  ACP_COMMAND_REQUIRED_FIELDS,
  EXECUTION_REPORT_REQUIRED_FIELDS,
  TASK_REGISTRY_REQUIRED_FIELDS,
  VALID_AGENTS,
  VALID_STATUSES,
  ACP_LIFECYCLE_STATES,
  LINEAGE_CONTROL_SEMANTICS,
  VALID_STATE_TRANSITIONS,
  EVIDENCE_TYPES,
  LIFECYCLE_EVIDENCE_SEMANTICS,
  STATE_TRANSITION_EVIDENCE,
  CONFIG_VERIFICATION_STATES,
   CONFIG_PREREQUISITE_STATES,
   PREREQUISITE_EVALUATION_STATES,
   KILO_ACTIVATION_PATTERN,
  GEMINI_CLI_ACTIVATION_PATTERN,
  GEMINI_BARE_PATTERN,
  ARBITRARY_MENTION_PATTERN,
  VALID_ACTIVATION_SURFACES,
   AGENT_EVIDENCE_TYPE,
   VALID_TASK_MODES,
   EXECUTION_TASK_MODES,
   DEFAULT_TASK_MODE,
   VALID_WORKFLOW_STAGES,
   VALID_CAPABILITIES,
   REVIEW_CAPABILITIES,
   VERIFY_RECONCILE_CAPABILITIES,
    FAILOVER_EXECUTE_CAPABILITIES,
    BUILDER_CAPABILITIES,
    RESEARCH_DOCUMENT_CAPABILITIES,
    MAX_AUTHORIZED_PATHS,
    VERIFY_RECONCILE_PATHS,
   RESEARCH_DOCUMENT_PATHS,
  VALID_RECONCILIATION_STATUSES,
  getRequiredCapabilitiesForMode,
  getAuthorizedPathsForMode,
  getModeCapabilities,
  validateTaskMode,
  validateWorkflowStage,
  validateCapabilitiesForMode,
  validatePermittedPathsForMode,
  validateAuthorization,
  canonicalizeDirectorScope,
  getDirectorScope,
  validateDirectorApprovalScope,
  calculateDirectorScopeHash,
  isConsequentialCommand,
  validateReconciliation,
  determineReconciliationStatus,
  validateACPCommand,
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  getRequiredEvidenceForTransition,
  validateStateTransitionWithEvidence,
   validateEvidenceRecord,
   validateAgentEvidenceType,
   createEvidenceRecord,
   validateActivationSyntax,
   validateActivationSurface,
    taskModeRequiresActivation,
    validateACPCompliance,
    createInitialTaskRegistryEntry,
    verifyConfiguration,
    isConfigurationAuthoritativelyVerified,
    createConfigPrerequisite,
    evaluatePrerequisite,
    activationPolicy
};
