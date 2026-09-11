'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REQUIRED_FIELDS = [
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
  'reporting',
  'timestamp',
];

const ALLOWED_CAPABILITIES = ['read_only'];

const DENIED_CAPABILITIES = ['modify_files', 'run_tests', 'commit', 'push'];

const POC_ALLOWED_PATHS = ['poc/'];

const REPORT_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
};

function validateEnvelope(cmd) {
  const errors = [];
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) {
    return { valid: false, errors: ['command must be a JSON object'] };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in cmd) || cmd[field] === undefined || cmd[field] === null) {
      errors.push('missing required field: ' + field);
    }
  }
  if (errors.length) {
    return { valid: false, errors };
  }

  if (typeof cmd.protocol_version !== 'string' || cmd.protocol_version.trim() === '') {
    errors.push('protocol_version must be a non-empty string');
  }
  if (typeof cmd.request_id !== 'string' || cmd.request_id.trim() === '') {
    errors.push('request_id must be a non-empty string');
  }
  for (const f of ['source', 'target', 'task_type', 'repository', 'base_branch', 'task', 'verification', 'reporting', 'timestamp']) {
    if (typeof cmd[f] !== 'string' || cmd[f].trim() === '') {
      errors.push(f + ' must be a non-empty string');
    }
  }
  if (typeof cmd.constraints !== 'object' || cmd.constraints === null || Array.isArray(cmd.constraints)) {
    errors.push('constraints must be an object');
  }
  if (typeof cmd.authorization !== 'object' || cmd.authorization === null || Array.isArray(cmd.authorization)) {
    errors.push('authorization must be an object');
  }
  return { valid: errors.length === 0, errors };
}

function authorize(cmd) {
  const auth = cmd.authorization;
  if (!Array.isArray(auth.capabilities) || auth.capabilities.length === 0) {
    return { authorized: false, reason: 'authorization.capabilities must be a non-empty array', status: REPORT_STATUS.FAILED };
  }
  for (const cap of auth.capabilities) {
    if (typeof cap !== 'string') {
      return { authorized: false, reason: 'authorization.capabilities must be strings', status: REPORT_STATUS.FAILED };
    }
    if (DENIED_CAPABILITIES.includes(cap)) {
      return { authorized: false, reason: "capability '" + cap + "' is not permitted", status: REPORT_STATUS.BLOCKED };
    }
    if (!ALLOWED_CAPABILITIES.includes(cap)) {
      return { authorized: false, reason: "capability '" + cap + "' is not permitted", status: REPORT_STATUS.BLOCKED };
    }
  }
  if (!auth.capabilities.includes('read_only')) {
    return { authorized: false, reason: 'read_only capability is required', status: REPORT_STATUS.BLOCKED };
  }
  return { authorized: true, reason: null, status: REPORT_STATUS.SUCCESS };
}

function normalizePath(p) {
  return path.normalize(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

function isPathWithinAllowList(p) {
  if (typeof p !== 'string' || p.length === 0) {
    return false;
  }
  if (p.startsWith('-')) {
    return false;
  }
  if (path.isAbsolute(p)) {
    return false;
  }
  const normalized = normalizePath(p);
  if (normalized === '' || normalized === '.') {
    return false;
  }
  if (normalized.startsWith('..') || normalized.includes('/..')) {
    return false;
  }
  for (const allowed of POC_ALLOWED_PATHS) {
    const base = allowed.replace(/\/+$/, '');
    if (normalized === base || normalized.startsWith(base + '/')) {
      return true;
    }
  }
  return false;
}

function checkPermittedPaths(cmd) {
  const constraints = cmd.constraints;
  const permitted = constraints.permitted_paths;
  if (!Array.isArray(permitted) || permitted.length === 0) {
    return { ok: false, validatedPaths: [], reason: 'constraints.permitted_paths must be a non-empty array', status: REPORT_STATUS.BLOCKED };
  }
  const validated = [];
  for (const p of permitted) {
    if (!isPathWithinAllowList(p)) {
      return { ok: false, validatedPaths: validated, reason: "path '" + p + "' is outside the permitted POC scope", status: REPORT_STATUS.BLOCKED };
    }
    validated.push(path.normalize(p).replace(/\\/g, '/'));
  }
  return { ok: true, validatedPaths: validated, reason: null, status: REPORT_STATUS.SUCCESS };
}

function runReadOnlyOp(repoRoot, pathspecs) {
  const args = ['-C', repoRoot, 'status', '--short', '--branch', '--'];
  for (const p of pathspecs) {
    args.push(p);
  }
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 10000 });
  if (result.error) {
    return { ok: false, error: result.error.message, output: null };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr && result.stderr.trim()) || 'git status failed', output: null };
  }
  return { ok: true, error: null, output: result.stdout };
}

function buildReport(cmd, status, execution, verification, result, blockers) {
  const base = (cmd && typeof cmd === 'object') ? cmd : {};
  return {
    request_id: base.request_id || null,
    timestamp: new Date().toISOString(),
    status: status,
    requested_task: base.task || null,
    execution_performed: execution,
    verification: verification,
    result: result,
    blockers: blockers,
  };
}

function executeAcpCommand(cmd, repoRoot) {
  const env = validateEnvelope(cmd);
  if (!env.valid) {
    return buildReport(
      cmd,
      REPORT_STATUS.FAILED,
      null,
      null,
      null,
      env.errors
    );
  }
  const auth = authorize(cmd);
  if (!auth.authorized) {
    return buildReport(
      cmd,
      auth.status,
      null,
      null,
      null,
      [auth.reason]
    );
  }
  const paths = checkPermittedPaths(cmd);
  if (!paths.ok) {
    return buildReport(
      cmd,
      paths.status,
      null,
      null,
      null,
      [paths.reason]
    );
  }
  const op = runReadOnlyOp(repoRoot, paths.validatedPaths);
  if (!op.ok) {
    return buildReport(
      cmd,
      REPORT_STATUS.FAILED,
      'git status --short --branch (read-only, scoped to permitted_paths)',
      cmd.verification,
      null,
      [op.error]
    );
  }
  return buildReport(
    cmd,
    REPORT_STATUS.SUCCESS,
    'git status --short --branch (read-only, scoped to permitted_paths)',
    cmd.verification,
    { output: op.output, scoped_paths: paths.validatedPaths },
    null
  );
}

module.exports = {
  validateEnvelope,
  authorize,
  checkPermittedPaths,
  isPathWithinAllowList,
  runReadOnlyOp,
  buildReport,
  executeAcpCommand,
  REPORT_STATUS,
  POC_ALLOWED_PATHS,
  ALLOWED_CAPABILITIES,
  DENIED_CAPABILITIES,
  REQUIRED_FIELDS,
};
