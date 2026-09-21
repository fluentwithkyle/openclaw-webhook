const fs = require('fs');
const path = require('path');
const { validateSignal } = require('./github-webhook');

const SIGNAL_DIR = path.join(__dirname, 'signals');
const DEFAULT_REPOSITORY = 'fluentwithkyle/openclaw-webhook';
const DEFAULT_BRANCH = 'main';

function getSignalFilePath(requestId) {
  return path.join(SIGNAL_DIR, requestId + '.json');
}

function hasExistingSignal(requestId) {
  return fs.existsSync(getSignalFilePath(requestId));
}

function buildSignal(requestId, completionData) {
  const timestamp = new Date().toISOString();
  const invocationId =
    completionData.invocation_id || 'kilo-inv-' + requestId;

  const signal = {
    signal_id: 'sig-' + requestId + '@' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    request_id: requestId,
    agent: 'Kilo',
    status: completionData.status,
    task: completionData.task || '',
    changed_files: Array.isArray(completionData.changed_files)
      ? completionData.changed_files
      : [],
    verification: Array.isArray(completionData.verification)
      ? completionData.verification
      : [],
    repository: completionData.repository || DEFAULT_REPOSITORY,
    base_branch: completionData.base_branch || DEFAULT_BRANCH,
    commit_sha: null,
    commit: null,
    result: {
      execution_metadata: {
        invocation_id: invocationId
      },
      summary: completionData.summary || ''
    },
    push: completionData.push === true,
    blockers: Array.isArray(completionData.blockers)
      ? completionData.blockers
      : [],
    timestamp: timestamp
  };

  if (completionData.run_id) {
    signal.result.execution_metadata.run_id = completionData.run_id;
  }

  return signal;
}

function checkForConflict(requestId, newStatus) {
  const filePath = getSignalFilePath(requestId);
  if (!fs.existsSync(filePath)) {
    return { conflict: false };
  }

  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (existing.status !== newStatus) {
      return {
        conflict: true,
        existingStatus: existing.status,
        newStatus: newStatus,
        existingSignalId: existing.signal_id
      };
    }
    return {
      conflict: false,
      duplicate: true,
      existingSignalId: existing.signal_id
    };
  } catch (err) {
    return {
      conflict: true,
      existingStatus: 'unknown',
      newStatus: newStatus,
      error: 'Existing signal file is corrupt: ' + err.message
    };
  }
}

function validateSignalConformance(signal, requestId) {
  const config = {
    repository: signal.repository,
    branch: signal.base_branch
  };
  return validateSignal(signal, requestId, null, config);
}

function writeSignalFile(signal) {
  if (!fs.existsSync(SIGNAL_DIR)) {
    fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  }

  const filePath = getSignalFilePath(signal.request_id);
  const json = JSON.stringify(signal, null, 2);

  fs.writeFileSync(filePath, json + '\n', 'utf8');
  return filePath;
}

function emitCompletionSignal(requestId, completionData, options) {
  options = options || {};

  const signal = buildSignal(requestId, completionData);

  const validation = validateSignalConformance(signal, requestId);
  if (!validation.valid) {
    return {
      success: false,
      error: 'Signal validation failed: ' + validation.errors.join('; '),
      stage: 'validation'
    };
  }

  const conflictCheck = checkForConflict(requestId, completionData.status);
  if (conflictCheck.conflict) {
    return {
      success: false,
      error:
        'Conflicting signal already exists for request_id ' +
        requestId +
        ': existing status ' +
        conflictCheck.existingStatus +
        ' vs new status ' +
        conflictCheck.newStatus,
      stage: 'conflict',
      existingSignalId: conflictCheck.existingSignalId,
      existingStatus: conflictCheck.existingStatus
    };
  }

  if (conflictCheck.duplicate && !options.allowDuplicate) {
    return {
      success: false,
      error:
        'Duplicate signal already exists for request_id ' + requestId,
      stage: 'duplicate',
      existingSignalId: conflictCheck.existingSignalId
    };
  }

  if (conflictCheck.error) {
    return {
      success: false,
      error: conflictCheck.error,
      stage: 'conflict'
    };
  }

  try {
    const filePath = writeSignalFile(signal);
    return {
      success: true,
      signal: signal,
      filePath: filePath
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stage: 'write'
    };
  }
}

module.exports = {
  buildSignal,
  getSignalFilePath,
  hasExistingSignal,
  checkForConflict,
  validateSignalConformance,
  writeSignalFile,
  emitCompletionSignal,
  SIGNAL_DIR,
  DEFAULT_REPOSITORY,
  DEFAULT_BRANCH
};
