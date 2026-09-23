const fs = require('fs');
const path = require('path');

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

const VALID_AGENTS = ['Kilo', 'Gemini', 'Gemini Builder'];
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

const STATE_TRANSITION_EVIDENCE = {
  'EXECUTING': {
    'VERIFIED': ['INDEPENDENT_VERIFICATION']
  },
  'VERIFIED': {
    'COMPLETE': ['INDEPENDENT_VERIFICATION']
  }
};

const CONFIG_VERIFICATION_STATES = ['VERIFIED', 'UNVERIFIED', 'PROPOSED', 'UNKNOWN'];

const KILO_ACTIVATION_PATTERN = /^@kilo\b/i;
const GEMINI_CLI_ACTIVATION_PATTERN = /^@gemini-cli\b/i;
const GEMINI_BARE_PATTERN = /^@Gemini\b/i;
const ARBITRARY_MENTION_PATTERN = /@gemini\b/i;

const VALID_ACTIVATION_SURFACES = {
  'Kilo': ['github_issue_comment', 'github_issue_body', 'github_push_event'],
  'Gemini': ['github_issue_comment', 'workflow_dispatch'],
  'Gemini Builder': ['github_issue_comment', 'workflow_dispatch']
};

const AGENT_EVIDENCE_TYPE = {
  'Kilo': 'AGENT_REPORT',
  'Gemini Builder': 'AGENT_REPORT',
  'Gemini': 'INDEPENDENT_VERIFICATION'
};

const VALID_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT'];
const DEFAULT_TASK_MODE = 'REVIEW';

const VALID_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push', 'run_tests'];

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

function validateAuthorization(command) {
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

  return { valid: true };
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
     config_verification: {}
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
   if (!activationText || typeof activationText !== 'string' || activationText.trim().length === 0) {
     return { valid: false, error: 'Activation syntax is required' };
   }

   const trimmed = activationText.trim();

   if (expectedTarget === 'Kilo') {
     if (KILO_ACTIVATION_PATTERN.test(trimmed)) {
       return { valid: true, activation_surface: 'github_issue_comment' };
     }
     return {
       valid: false,
       error: 'Kilo execution tasks require @kilo initiation syntax with an authorized issue-based activation surface'
     };
   }

   if (expectedTarget === 'Gemini' || expectedTarget === 'Gemini Builder') {
     if (GEMINI_CLI_ACTIVATION_PATTERN.test(trimmed)) {
       return { valid: true, activation_surface: 'github_issue_comment' };
     }
     if (GEMINI_BARE_PATTERN.test(trimmed)) {
       return {
         valid: false,
         error: 'Invalid activation syntax: @Gemini is not valid. Use @gemini-cli for Gemini execution tasks'
       };
     }
     if (ARBITRARY_MENTION_PATTERN.test(trimmed)) {
       return {
         valid: false,
         error: 'Arbitrary Gemini mentions are not valid activation syntax. Use @gemini-cli for Gemini execution tasks'
       };
     }
     return {
       valid: false,
       error: expectedTarget + ' execution tasks require @gemini-cli initiation syntax'
     };
   }

   return { valid: false, error: 'Unknown target for activation validation: ' + expectedTarget };
 }

 function validateActivationSurface(surface, target) {
   const allowed = VALID_ACTIVATION_SURFACES[target];
   if (!allowed) {
     return { valid: false, error: 'No activation surfaces defined for target: ' + target };
   }
   if (!surface || !allowed.includes(surface)) {
     return { valid: false, error: 'Unauthorized activation surface for ' + target + ': ' + surface + '. Authorized: ' + allowed.join(', ') };
   }
   return { valid: true };
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

   if (command.activation_syntax) {
     const activationValidation = validateActivationSyntax(command.activation_syntax, command.target);
     if (!activationValidation.valid) {
       return { valid: false, error: activationValidation.error };
     }
   }

   if (command.activation_surface) {
     const surfaceValidation = validateActivationSurface(command.activation_surface, command.target);
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
  VALID_STATE_TRANSITIONS,
  EVIDENCE_TYPES,
  STATE_TRANSITION_EVIDENCE,
  CONFIG_VERIFICATION_STATES,
  KILO_ACTIVATION_PATTERN,
  GEMINI_CLI_ACTIVATION_PATTERN,
  GEMINI_BARE_PATTERN,
  ARBITRARY_MENTION_PATTERN,
  VALID_ACTIVATION_SURFACES,
  AGENT_EVIDENCE_TYPE,
  VALID_TASK_MODES,
  DEFAULT_TASK_MODE,
  VALID_CAPABILITIES,
  REVIEW_CAPABILITIES,
  VERIFY_RECONCILE_CAPABILITIES,
   FAILOVER_EXECUTE_CAPABILITIES,
   BUILDER_CAPABILITIES,
   RESEARCH_DOCUMENT_CAPABILITIES,
   VERIFY_RECONCILE_PATHS,
   RESEARCH_DOCUMENT_PATHS,
  VALID_RECONCILIATION_STATUSES,
  getRequiredCapabilitiesForMode,
  getAuthorizedPathsForMode,
  getModeCapabilities,
  validateTaskMode,
  validateCapabilitiesForMode,
  validatePermittedPathsForMode,
  validateAuthorization,
  validateReconciliation,
  determineReconciliationStatus,
  validateACPCommand,
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  getRequiredEvidenceForTransition,
  validateStateTransitionWithEvidence,
  validateEvidenceRecord,
  createEvidenceRecord,
  validateActivationSyntax,
  validateActivationSurface,
  validateACPCompliance,
  createInitialTaskRegistryEntry
};
