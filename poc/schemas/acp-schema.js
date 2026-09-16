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

const VALID_AGENTS = ['Kilo', 'Gemini'];
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
  return {
    request_id: requestId,
    parent_request_id: command.parent_request_id || null,
    originator: command.originator || 'Kyle',
    current_agent: 'Kilo',
    next_agent: 'Gemini',
    repository: command.repository,
    base_branch: command.base_branch,
    task: command.task,
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
    next_action: null,
    verification: command.verification
  };
}

module.exports = {
  ACP_COMMAND_REQUIRED_FIELDS,
  EXECUTION_REPORT_REQUIRED_FIELDS,
  TASK_REGISTRY_REQUIRED_FIELDS,
  VALID_AGENTS,
  VALID_STATUSES,
  VALID_STATE_TRANSITIONS,
  validateACPCommand,
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  createInitialTaskRegistryEntry
};