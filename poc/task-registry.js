const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  validateTaskRegistryEntry,
  createInitialTaskRegistryEntry,
  isValidStateTransition,
  validateStateTransitionWithEvidence,
  getRequiredEvidenceForTransition,
  createEvidenceRecord,
  validateEvidenceRecord,
  validateAgentEvidenceType,
  verifyConfiguration,
  isConfigurationAuthoritativelyVerified,
  EVIDENCE_TYPES,
  AGENT_EVIDENCE_TYPE,
  CONFIG_VERIFICATION_STATES,
  VALID_STATE_TRANSITIONS,
  validateDirectorApprovalScope,
  calculateDirectorScopeHash,
  getDirectorScope,
  isConsequentialCommand
} = require('./schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, 'task-registry.json.bak');
const CLAIMS_DIR = path.join(__dirname, 'claims');
const REGISTRY_LOCK_FILE = path.join(__dirname, 'task-registry.json.lock');

const CLAIM_STALE_MS = 15 * 60 * 1000;
const REGISTRY_LOCK_TIMEOUT_MS = 5000;

let memoryCache = new Map();
let approvalCache = new Map();
let initialized = false;

function ensureRegistryFile() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, '{}', 'utf8');
  }
}

function ensureClaimsDir() {
  if (!fs.existsSync(CLAIMS_DIR)) {
    fs.mkdirSync(CLAIMS_DIR, { recursive: true });
  }
}

async function acquireRegistryLock() {
  const startTime = Date.now();
  while (Date.now() - startTime < REGISTRY_LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(REGISTRY_LOCK_FILE, 'wx');
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        const waitTime = Math.min(10 + Math.random() * 20, 100);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to acquire registry lock within timeout');
}

function releaseRegistryLock() {
  try {
    fs.unlinkSync(REGISTRY_LOCK_FILE);
  } catch (err) {
  }
}

async function withRegistryLock(fn, options) {
  if (options && options.skipLock) return fn();
  await acquireRegistryLock();
  try {
    return await fn();
  } finally {
    releaseRegistryLock();
  }
}

function loadFromFile() {
  try {
    ensureRegistryFile();
    const data = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(data || '{}');
    approvalCache = new Map(Object.entries(parsed.__director_approvals__ || {}));
    delete parsed.__director_approvals__;
    memoryCache = new Map(Object.entries(parsed));
    initialized = true;
  } catch (err) {
    console.error('Failed to load task registry:', err.message);
    memoryCache = new Map();
    approvalCache = new Map();
    initialized = true;
  }
}

function getCache() {
  if (!initialized) {
    loadFromFile();
  }
  return memoryCache;
}

function atomicWrite(data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(BACKUP_FILE, json, 'utf8');
  fs.renameSync(BACKUP_FILE, REGISTRY_FILE);
}

async function persistCache() {
  // Use sync version - caller should hold the lock
  return persistCacheSync();
}

function persistCacheSync() {
  const data = Object.fromEntries(memoryCache);
  data.__director_approvals__ = Object.fromEntries(approvalCache);
  atomicWrite(data);
}

async function createTask(command, options) {
  return createTaskUnchecked(command, options);
}

async function createTaskWithDirectorAuthorization(command) {
  return isConsequentialCommand(command) ? consumeDirectorApprovalAndCreateTask(command) : module.exports.createTask(command);
}

async function createTaskUnchecked(command, options) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const requestId = command.request_id;

    if (cache.has(requestId)) {
      const existing = cache.get(requestId);
      return {
        success: false,
        error: 'Duplicate request_id',
        entry: existing,
        duplicate: true
      };
    }

    const parentId = command.parent_request_id;

    if (parentId) {
      const lineageCheck = validateLineageForCreate(parentId, requestId);
      if (!lineageCheck.valid) {
        return { success: false, error: lineageCheck.error };
      }
    }

    const entry = createInitialTaskRegistryEntry(requestId, command);
    entry.replay_fingerprint = computePayloadFingerprint(command);
    const validation = validateTaskRegistryEntry(entry);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    cache.set(requestId, entry);
    if (!options || options.persist !== false) await persistCache();
    return { success: true, entry };
  }, options && options.skipLock ? { skipLock: true } : undefined);
}
async function createDirectorApproval(scope) {
  return withRegistryLock(async () => {
    getCache();
    const validation = validateDirectorApprovalScope(scope);
    if (!validation.valid) return { success: false, error: validation.error };
    const issuedAt = new Date().toISOString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const approvalId = 'dir-approval-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    const record = { ...getDirectorScope(scope), transition_binding: scope.transition_binding || null, issuer: 'Kyle (Director)', expiry, issued_at: issuedAt, consumed_at: null, status: 'PENDING', approval_id: approvalId, scope_hash: calculateDirectorScopeHash(scope) };
    approvalCache.set(approvalId, record);
    await persistCache();
    return { success: true, approval: record };
  });
}

async function consumeDirectorApproval(approvalId) {
  return withRegistryLock(async () => {
    getCache();
    const record = approvalCache.get(approvalId);
    if (!record) return { success: false, error: 'Director approval does not exist' };
    if (record.status !== 'PENDING') return { success: false, error: 'Director approval is not pending' };
    if (Date.parse(record.expiry) <= Date.now()) {
      record.status = 'EXPIRED';
      approvalCache.set(approvalId, record);
      await persistCache();
      return { success: false, error: 'Director approval has expired' };
    }
    record.status = 'CONSUMED';
    record.consumed_at = new Date().toISOString();
    approvalCache.set(approvalId, record);
    await persistCache();
    return { success: true, approval: record };
  });
}

async function revokePendingDirectorApprovals(requestId, reason, options) {
  return withRegistryLock(async () => {
    getCache();
    let revoked = 0;
    for (const [approvalId, record] of approvalCache.entries()) {
      if (record.request_id === requestId && record.status === 'PENDING') {
        record.status = 'REVOKED';
        record.revoked_at = new Date().toISOString();
        record.revocation_reason = reason;
        approvalCache.set(approvalId, record);
        revoked++;
      }
    }
    await persistCache();
    return revoked;
  }, options && options.skipLock ? { skipLock: true } : undefined);
}
function getDirectorApproval(approvalId) {
  getCache();
  return approvalCache.get(approvalId) || null;
}

async function consumeDirectorApprovalAndCreateTask(command) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const approvalId = command.authorization && command.authorization.approval_id;
    if (typeof approvalId !== 'string' || approvalId.length === 0) return { success: false, authorization: true, error: 'Director approval is required for consequential task' };
    const record = approvalCache.get(approvalId);
    if (!record) return { success: false, authorization: true, error: 'Director approval does not exist' };
    if (record.status !== 'PENDING') return { success: false, authorization: true, error: 'Director approval is not pending' };
    if (Date.parse(record.expiry) <= Date.now()) { record.status = 'EXPIRED'; approvalCache.set(approvalId, record); await persistCache(); return { success: false, authorization: true, error: 'Director approval has expired' }; }
    if (record.scope_hash !== calculateDirectorScopeHash(getDirectorScope(command))) return { success: false, authorization: true, error: 'Director approval scope mismatch' };
    const result = await createTaskUnchecked(command, { persist: false, skipLock: true });
    if (!result.success) return result;
    record.status = 'CONSUMED';
    record.consumed_at = new Date().toISOString();
    approvalCache.set(approvalId, record);
    result.entry.authorization_proof = { approval_id: approvalId, scope_hash: record.scope_hash, issuer: record.issuer, consumed_at: record.consumed_at };
    cache.set(command.request_id, result.entry);
    await persistCache();
    return result;
  });
}

function getTask(requestId) {
  const cache = getCache();
  return cache.get(requestId) || null;
}

function computePayloadFingerprint(command) {
  var scope = {
    request_id: command.request_id,
    target: command.target,
    task_mode: command.task_mode || 'REVIEW',
    task: command.task,
    repository: command.repository,
    base_branch: command.base_branch,
    task_type: command.task_type,
    capabilities: Array.isArray(command.authorization && command.authorization.capabilities) ? command.authorization.capabilities.slice().sort() : [],
    permitted_paths: Array.isArray(command.constraints && command.constraints.permitted_paths) ? command.constraints.permitted_paths.slice().sort() : [],
    activation_target: command.activation_target || (command.activation_provenance && command.activation_provenance.activation_target) || null,
    activation_task_mode: command.activation_task_mode || (command.activation_provenance && command.activation_provenance.activation_task_mode) || null,
    activation_surface: command.activation_surface || (command.activation_provenance && command.activation_provenance.activation_surface) || null
  };
  return crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

function replayTask(command) {
  var cache = getCache();
  var requestId = command.request_id;
  if (!requestId || typeof requestId !== 'string') {
    return { success: false, error: 'request_id is required for replay', error_code: 'MISSING_REQUEST_ID' };
  }

  var existing = cache.get(requestId);
  if (!existing) {
    return { success: false, error: 'No existing task for replay: ' + requestId, error_code: 'NO_EXISTING_TASK', rehydrate: true };
  }

  var existingFingerprint = existing.replay_fingerprint || computePayloadFingerprint(existing);
  var incomingFingerprint = command.replay_fingerprint || computePayloadFingerprint(command);

  if (existingFingerprint !== incomingFingerprint) {
    return {
      success: false,
      error: 'Replay payload does not match original task payload (fingerprint mismatch)',
      error_code: 'REPLAY_PAYLOAD_MISMATCH',
      existing_request_id: requestId,
      task_status: existing.status
    };
  }

  var terminalStates = ['COMPLETE', 'FAILED', 'BLOCKED'];
  if (terminalStates.includes(existing.status)) {
    return {
      success: true,
      replay: true,
      existing: true,
      task_terminated: true,
      entry: existing,
      message: 'Replay matched existing terminated task; no new execution initiated'
    };
  }

  return {
    success: true,
    replay: true,
    existing: true,
    task_terminated: false,
    entry: existing,
    message: 'Replay matched existing active task; no duplicate created'
  };
}

function isCancelled(requestId) {
  const entry = getTask(requestId);
  if (!entry) return false;
  return entry.lineage && entry.lineage.cancelled === true;
}

function isSuperseded(requestId) {
  const entry = getTask(requestId);
  if (!entry) return false;
  return entry.lineage && entry.lineage.superseded_by !== null;
}

function activeTaskExists(requestId) {
  const entry = getTask(requestId);
  if (!entry) return false;

  const terminatedStates = ['COMPLETE', 'FAILED', 'BLOCKED'];
  if (terminatedStates.includes(entry.status)) return false;
  if (isCancelled(requestId)) return false;
  if (isSuperseded(requestId)) return false;

  return true;
}

function getTasksByParent(parentRequestId) {
  const cache = getCache();
  return Array.from(cache.values()).filter(t => t.parent_request_id === parentRequestId);
}

function validateLineageForCreate(parentId, newRequestId) {
  const cache = getCache();
  const parent = cache.get(parentId);
  if (!parent) {
    return { valid: false, error: 'parent_request_id ' + parentId + ' does not exist in registry; lineage cannot be established' };
  }

  if (isCancelled(parentId)) {
    return { valid: false, error: 'Cannot create child of cancelled task: ' + parentId };
  }

  if (isSuperseded(parentId)) {
    const designated = parent.lineage && parent.lineage.superseded_by;
    if (designated !== newRequestId) {
      return {
        valid: false,
        error: 'Cannot create child of superseded task; only the designated replacement (' + designated + ') is permitted: ' + parentId
      };
    }
    return { valid: true };
  }

  if (activeTaskExists(parentId)) {
    return {
      valid: false,
      error: 'Cannot create child while parent task is still active; supersede the parent first: ' + parentId
    };
  }

  const siblings = getTasksByParent(parentId);
  for (const sibling of siblings) {
    if (activeTaskExists(sibling.request_id)) {
      return {
        valid: false,
        error: 'Conflicting active lineage: parent ' + parentId + ' already has an active child task ' + sibling.request_id
      };
    }
  }

  return { valid: true };
}

function resolveCurrentLineage(requestId) {
  const cache = getCache();
  let currentId = requestId;
  const seen = new Set();
  while (cache.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    const entry = cache.get(currentId);
    const next = entry && entry.lineage && entry.lineage.superseded_by;
    if (!next || seen.has(next) || next === currentId) {
      break;
    }
    currentId = next;
  }
  return currentId;
}

async function addEvidence(requestId, evidenceType, agent, reportData) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    if (!EVIDENCE_TYPES.includes(evidenceType)) {
      return { success: false, error: 'Invalid evidence_type: ' + evidenceType };
    }

    const agentEvidenceValidation = validateAgentEvidenceType(agent, evidenceType);
    if (!agentEvidenceValidation.valid) {
      return { success: false, error: agentEvidenceValidation.error };
    }

    const evidence = createEvidenceRecord(requestId, evidenceType, agent, reportData, entry);
    const validation = validateEvidenceRecord(evidence);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    entry.evidence = entry.evidence || [];
    entry.evidence.push(evidence);
    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry, evidence_record: evidence };
  });
}

function getEvidenceByType(requestId, evidenceType) {
  const entry = getTask(requestId);
  if (!entry) {
    return { success: false, error: 'Task not found' };
  }
  const evidenceList = entry.evidence || [];
  const filtered = evidenceList.filter(e => e.evidence_type === evidenceType);
  return { success: true, evidence: filtered };
}

function hasEvidenceOfType(requestId, evidenceType) {
  const result = getEvidenceByType(requestId, evidenceType);
  if (!result.success) return false;
  return result.evidence.length > 0;
}

async function recordConfigVerification(requestId, configKey, verificationResult, claimed) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    const runtimeEnv = (typeof process !== 'undefined' && process.env) ? process.env : {};
    const authoritativeResult = verifyConfiguration(configKey, {
      env: runtimeEnv,
      task: entry,
      claimed: claimed
    });

    entry.config_verification = entry.config_verification || {};
    entry.config_verification[configKey] = {
      state: authoritativeResult.state,
      verified: Boolean(authoritativeResult.verified),
      source: authoritativeResult.source || null,
      timestamp: new Date().toISOString()
    };
    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry, config_verification: entry.config_verification[configKey] };
  });
}

function getConfigVerificationState(requestId, configKey) {
  const entry = getTask(requestId);
  if (!entry) return 'UNKNOWN';
  const rec = entry.config_verification && entry.config_verification[configKey];
  if (!rec) return 'UNKNOWN';
  return rec.state;
}

function requireConfigVerified(requestId, configKey) {
  const entry = getTask(requestId);
  if (!entry) {
    return { success: false, error: 'Task not found', config_state: 'UNKNOWN' };
  }
  const state = getConfigVerificationState(requestId, configKey);
  if (state !== 'VERIFIED') {
    return {
      success: false,
      error: 'Configuration ' + configKey + ' is ' + state + ' (required VERIFIED); execution prerequisite not met',
      config_state: state,
      entry: entry
    };
  }
  return { success: true, config_state: state, entry: entry };
}

function verifyConfig(requestId, configKey, options) {
  const entry = getTask(requestId);
  const runtimeEnv = (typeof process !== 'undefined' && process.env) ? process.env : {};
  const claimed = options ? options.claimed : undefined;
  const result = verifyConfiguration(configKey, {
    env: runtimeEnv,
    task: entry,
    claimed: claimed
  });
  if (entry) {
    recordConfigVerification(requestId, configKey, result, claimed);
  }
  return result;
}

async function supersedeTask(requestId, reason) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    if (isSuperseded(requestId)) {
      return { success: false, error: 'Task already superseded', superseded: true };
    }

    if (isCancelled(requestId)) {
      return { success: false, error: 'Task already cancelled, cannot supersede', cancelled: true };
    }

    if (entry.status === 'COMPLETE') {
      return { success: false, error: 'Cannot supersede a completed task' };
    }

    const newRequestId = requestId + '-superseded-' + Date.now();

    await revokePendingDirectorApprovals(requestId, 'task superseded', { skipLock: true });
    entry.lineage = entry.lineage || {};
    entry.lineage.superseded_by = newRequestId;
    entry.lineage.superseded_at = new Date().toISOString();
    entry.lineage.supersede_reason = reason || 'no reason provided';
    cache.set(requestId, entry);

    const command = {
      request_id: newRequestId,
      target: entry.current_agent || 'Kilo',
      task: entry.task,
      repository: entry.repository,
      base_branch: entry.base_branch,
      constraints: { permitted_paths: entry.permitted_paths || [] },
      authorization: { capabilities: entry.capabilities || ['read_only'] },
      verification: entry.verification,
      reporting: 'json',
      task_mode: entry.task_mode,
      workflow_stage: entry.workflow_stage,
      originator: entry.originator,
      parent_request_id: requestId
    };

    const createResult = await createTask(command, { skipLock: true });
    if (!createResult.success) {
      return createResult;
    }

    const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
    for (const status of transitions) {
      const r = await updateTaskStatus(newRequestId, status, { skipLock: true });
      if (!r.success) {
        return {
          success: false,
          error: 'Failed to transition to ' + status + ': ' + r.error
        };
      }
    }

    await persistCache();
    return {
      success: true,
      new_request_id: newRequestId,
      new_entry: getTask(newRequestId),
      superseded_entry: getTask(requestId)
    };
  });
}

async function cancelTask(requestId, reason) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    if (isCancelled(requestId)) {
      return { success: false, error: 'Task already cancelled', cancelled: true };
    }

    if (entry.status === 'COMPLETE') {
      return { success: false, error: 'Cannot cancel a completed task' };
    }

    await revokePendingDirectorApprovals(requestId, 'task cancelled', { skipLock: true });
    entry.lineage = entry.lineage || {};
    entry.lineage.cancelled = true;
    entry.lineage.cancelled_at = new Date().toISOString();
    entry.lineage.cancel_reason = reason || 'no reason provided';
    entry.status = 'FAILED';
    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry };
  });
}

async function updateTaskStatus(requestId, newStatus, options) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    if (isCancelled(requestId)) {
      return { success: false, error: 'Cannot update status of a cancelled task' };
    }

    if (isSuperseded(requestId)) {
      return { success: false, error: 'Cannot update status of a superseded task' };
    }

    const evidenceValidation = validateStateTransitionWithEvidence(
      entry.status,
      newStatus,
      entry.evidence || []
    );
    if (!evidenceValidation.valid) {
      return {
        success: false,
        error: evidenceValidation.error,
        missing_evidence: evidenceValidation.missing_evidence
      };
    }

    entry.status = newStatus;
    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry };
  }, options && options.skipLock ? { skipLock: true } : undefined);
}
async function updateAgentResult(requestId, agent, result) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    const evidenceType = AGENT_EVIDENCE_TYPE[agent];
    if (!evidenceType) {
      return { success: false, error: 'Unknown agent: ' + agent };
    }

    if (agent === 'Kilo') {
      entry.kilo = {
        ...entry.kilo,
        status: result.status,
        execution_id: result.execution_id || null,
        report: result.report || null
      };
      entry.current_agent = 'Gemini';
      entry.next_agent = 'Gemini';
    } else if (agent === 'Gemini Builder') {
      entry.builder = {
        status: result.status,
        execution_id: result.execution_id || null,
        report: result.report || null
      };
      entry.current_agent = 'Gemini';
      entry.next_agent = 'Gemini';
    } else if (agent === 'Gemini') {
      entry.gemini = {
        status: result.status,
        execution_id: result.execution_id || null,
        report: result.report || null
      };
      entry.current_agent = null;
      entry.next_agent = null;
    }

    const reportData = result.report || {};
    if (result.execution_id) reportData.execution_id = result.execution_id;
    if (result.status) reportData.status = result.status;

    const evidence = createEvidenceRecord(requestId, evidenceType, agent, reportData, entry);
    const evidenceValidation = validateEvidenceRecord(evidence);
    if (evidenceValidation.valid) {
      entry.evidence = entry.evidence || [];
      entry.evidence.push(evidence);
    }

    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry, evidence_record: evidence };
  });
}

async function setNextAction(requestId, nextAction) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) {
      return { success: false, error: 'Task not found' };
    }

    entry.next_action = nextAction;
    entry.updated_at = new Date().toISOString();
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, entry };
  });
}

async function createCoordinationContext(requestId, maxAutonomousTurns) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);
    if (!entry) return { success: false, error: 'Task not found' };
    if (entry.coordination_context) return { success: true, context: entry.coordination_context, existing: true };
    const context = {
      context_id: requestId,
      root_request_id: requestId,
      current_request_id: requestId,
      autonomous_turns: 0,
      max_autonomous_turns: maxAutonomousTurns,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    entry.coordination_context = context;
    entry.updated_at = context.updated_at;
    cache.set(requestId, entry);
    await persistCache();
    return { success: true, context };
  });
}

async function advanceCoordinationContext(contextId, currentRequestId) {
  return withRegistryLock(async () => {
    const entry = getTask(contextId);
    const context = entry && entry.coordination_context;
    if (!context || context.context_id !== contextId) return { success: false, error: 'Coordination context not found' };
    if (context.autonomous_turns >= context.max_autonomous_turns) return { success: false, error: 'Coordination context autonomous-turn limit exhausted' };
    context.autonomous_turns++;
    context.current_request_id = currentRequestId;
    context.updated_at = new Date().toISOString();
    entry.updated_at = context.updated_at;
    memoryCache.set(contextId, entry);
    await persistCache();
    return { success: true, context };
  });
}

async function setCoordinationContextCurrent(contextId, currentRequestId) {
  return withRegistryLock(async () => {
    const entry = getTask(contextId);
    const context = entry && entry.coordination_context;
    if (!context || context.context_id !== contextId) return { success: false, error: 'Coordination context not found' };
    context.current_request_id = currentRequestId;
    context.updated_at = new Date().toISOString();
    entry.updated_at = context.updated_at;
    memoryCache.set(contextId, entry);
    await persistCache();
    return { success: true, context };
  });
}

function getAllTasks() {
  const cache = getCache();
  return Array.from(cache.values());
}

function getTasksByStatus(status) {
  const cache = getCache();
  return Array.from(cache.values()).filter(t => t.status === status);
}

async function deleteTask(requestId) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const deleted = cache.delete(requestId);
    if (deleted) {
      await persistCache();
    }
    return { success: deleted };
  });
}

function resetRegistry() {
  memoryCache = new Map();
  approvalCache = new Map();
  if (fs.existsSync(CLAIMS_DIR)) {
    const files = fs.readdirSync(CLAIMS_DIR);
    for (const file of files) {
      try { fs.unlinkSync(path.join(CLAIMS_DIR, file)); } catch (err) {}
    }
  }
  // Also remove registry lock file
  try { fs.unlinkSync(REGISTRY_LOCK_FILE); } catch (err) {}
  atomicWrite({ __director_approvals__: {} });
  return { success: true };
}

function resetMemoryCache() {
  memoryCache = new Map();
  approvalCache = new Map();
  initialized = false;
  return { success: true };
}

async function rehydrateTask(command) {
  const requestId = command.request_id;

  const currentId = resolveCurrentLineage(requestId);
  let currentEntry = currentId ? getTask(currentId) : null;

  if (currentEntry) {
    if (isCancelled(currentId)) {
      return {
        success: false,
        error: 'Task is cancelled, cannot rehydrate',
        entry: currentEntry,
        original_request_id: requestId,
        lineage_current: currentId
      };
    }

    const state = currentEntry.status;

    if (state === 'COMPLETE') {
      return { success: true, entry: currentEntry, rehydrated: false, action: 'none', original_request_id: requestId, lineage_current: currentId };
    }

    if (state === 'VERIFIED') {
      return { success: true, entry: currentEntry, rehydrated: false, action: 'complete', original_request_id: requestId, lineage_current: currentId };
    }

    if (state === 'EXECUTING') {
      if (currentEntry.kilo.status === 'pending') {
        return { success: true, entry: currentEntry, rehydrated: false, action: 'kilo_execution', original_request_id: requestId, lineage_current: currentId };
      }
      if (currentEntry.kilo.status === 'success' && currentEntry.builder.status === 'pending' && currentEntry.next_action === 'trigger_builder') {
        return { success: true, entry: currentEntry, rehydrated: false, action: 'trigger_builder', original_request_id: requestId, lineage_current: currentId };
      }
      if (currentEntry.builder.status === 'success' && currentEntry.gemini.status === 'pending' && currentEntry.next_action === 'trigger_gemini') {
        return { success: true, entry: currentEntry, rehydrated: false, action: 'trigger_gemini', original_request_id: requestId, lineage_current: currentId };
      }
      if (currentEntry.gemini.status === 'pending' && currentEntry.next_action === 'waiting_gemini_callback') {
        return { success: true, entry: currentEntry, rehydrated: false, action: 'waiting_gemini', original_request_id: requestId, lineage_current: currentId };
      }
      return { success: true, entry: currentEntry, rehydrated: false, action: 'continue', original_request_id: requestId, lineage_current: currentId };
    }

    if (state === 'FAILED' || state === 'BLOCKED') {
      if (currentEntry.lineage && currentEntry.lineage.cancelled === true) {
        return {
          success: false,
          error: 'Task is cancelled, cannot rehydrate',
          entry: currentEntry,
          original_request_id: requestId,
          lineage_current: currentId
        };
      }
      return {
        success: false,
        error: 'Task in terminal state ' + state + ', requires human review',
        entry: currentEntry,
        original_request_id: requestId,
        lineage_current: currentId
      };
    }

    if (state === 'PENDING' || state === 'SELECTED' || state === 'PLANNED') {
      const transitions = [];
      if (state === 'PENDING') transitions.push('SELECTED', 'PLANNED', 'EXECUTING');
      else if (state === 'SELECTED') transitions.push('PLANNED', 'EXECUTING');
      else if (state === 'PLANNED') transitions.push('EXECUTING');

      for (const status of transitions) {
        const r = await updateTaskStatus(currentId, status);
        if (!r.success) {
          return {
            success: false,
            error: 'Failed to transition to ' + status + ': ' + r.error,
            entry: getTask(currentId),
            original_request_id: requestId,
            lineage_current: currentId
          };
        }
      }

      return { success: true, entry: getTask(currentId), rehydrated: true, action: 'kilo_execution', original_request_id: requestId, lineage_current: currentId };
    }

    return {
      success: false,
      error: 'Cannot rehydrate task in state ' + state,
      entry: currentEntry,
      original_request_id: requestId,
      lineage_current: currentId
    };
  }

  const createResult = await createTask(command);
  if (!createResult.success) {
    return createResult;
  }

  const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
  for (const status of transitions) {
    const r = await updateTaskStatus(requestId, status);
    if (!r.success) {
      return {
        success: false,
        error: 'Failed to transition to ' + status + ': ' + r.error
      };
    }
  }

  return { success: true, entry: getTask(requestId), rehydrated: true, action: 'kilo_execution' };
}

function claimLockPath(requestId) {
  ensureClaimsDir();
  const safeId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CLAIMS_DIR, safeId + '.claim.lock');
}

function readClaimLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function clearClaimLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
  }
}

function isTerminalStatus(status) {
  return ['COMPLETE', 'FAILED', 'BLOCKED'].includes(status);
}

function isClaimStale(claimRecord) {
  if (!claimRecord || !claimRecord.claim_epoch) return true;
  const age = Date.now() - claimRecord.claim_epoch;
  return age > CLAIM_STALE_MS;
}

async function claimExecutionContext(requestId, claimIdentity) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);

    if (!entry) {
      return { success: false, status: 'UNAUTHORIZED', error_code: 'TASK_NOT_FOUND', error: 'Task not found in registry' };
    }

    if (isCancelled(requestId)) {
      return { success: false, status: 'UNAUTHORIZED', error_code: 'TASK_CANCELLED', error: 'Task is cancelled, cannot claim execution' };
    }

    if (isSuperseded(requestId)) {
      return { success: false, status: 'UNAUTHORIZED', error_code: 'TASK_SUPERSEDED', error: 'Task is superseded, cannot claim execution' };
    }

    if (isTerminalStatus(entry.status)) {
      return { success: false, status: 'COMPLETE', error_code: 'TASK_TERMINAL', error: 'Task is in terminal state ' + entry.status + ', no re-execution' };
    }

    if (entry.status !== 'EXECUTING') {
      return { success: false, status: 'BLOCKED', error_code: 'TASK_NOT_EXECUTING', error: 'Task is not in EXECUTING state (status: ' + entry.status + ')' };
    }

    // Check if there's already an execution claim in the entry
    if (entry.execution_claim && !isClaimStale(entry.execution_claim)) {
      return {
        success: false,
        status: 'ALREADY_CLAIMED',
        error_code: 'ALREADY_CLAIMED',
        error: 'Task already has an active execution claim',
        existing_claim: entry.execution_claim
      };
    }

    const lockPath = claimLockPath(requestId);

    try {
      const fd = fs.openSync(lockPath, 'wx');
      const claimRecord = {
        request_id: requestId,
        execution_claim_id: 'claim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
        carrier_identity: claimIdentity && claimIdentity.carrier_id ? claimIdentity.carrier_id : null,
        carrier_type: claimIdentity && claimIdentity.carrier_type ? claimIdentity.carrier_type : null,
        claimed_at: new Date().toISOString(),
        claim_epoch: Date.now()
      };
      fs.writeFileSync(fd, JSON.stringify(claimRecord), 'utf8');
      fs.closeSync(fd);

      entry.execution_claim = {
        execution_claim_id: claimRecord.execution_claim_id,
        carrier_identity: claimRecord.carrier_identity,
        carrier_type: claimRecord.carrier_type,
        claimed_at: claimRecord.claimed_at,
        claim_epoch: claimRecord.claim_epoch
      };
      entry.updated_at = claimRecord.claimed_at;
      cache.set(requestId, entry);
      await persistCache();

      return {
        success: true,
        status: 'CLAIMED',
        error_code: 'CLAIMED',
        execution_claim_id: claimRecord.execution_claim_id,
        carrier_identity: claimRecord.carrier_identity,
        task: entry
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        const existingClaim = readClaimLock(lockPath);

        if (existingClaim && existingClaim.request_id !== requestId) {
          return { success: false, status: 'UNAUTHORIZED', error_code: 'MISMATCH', error: 'Claim lock exists for a different request_id', existing_claim: existingClaim };
        }

        if (existingClaim) {
          const age = Date.now() - (existingClaim.claim_epoch || 0);
          if (age > CLAIM_STALE_MS) {
            clearClaimLock(lockPath);
            try {
              const fd = fs.openSync(lockPath, 'wx');
              const claimRecord = {
                request_id: requestId,
                execution_claim_id: 'claim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
                carrier_identity: claimIdentity && claimIdentity.carrier_id ? claimIdentity.carrier_id : null,
                carrier_type: claimIdentity && claimIdentity.carrier_type ? claimIdentity.carrier_type : null,
                claimed_at: new Date().toISOString(),
                claim_epoch: Date.now()
              };
              fs.writeFileSync(fd, JSON.stringify(claimRecord), 'utf8');
              fs.closeSync(fd);

              entry.execution_claim = {
                execution_claim_id: claimRecord.execution_claim_id,
                carrier_identity: claimRecord.carrier_identity,
                carrier_type: claimRecord.carrier_type,
                claimed_at: claimRecord.claimed_at,
                claim_epoch: claimRecord.claim_epoch
              };
              entry.updated_at = claimRecord.claimed_at;
              cache.set(requestId, entry);
              await persistCache();

              return {
                success: true,
                status: 'CLAIMED',
                error_code: 'CLAIMED',
                execution_claim_id: claimRecord.execution_claim_id,
                carrier_identity: claimRecord.carrier_identity,
                task: entry
              };
            } catch (retryErr) {
              if (retryErr.code === 'EEXIST') {
                return { success: false, status: 'ALREADY_CLAIMED', error_code: 'ALREADY_CLAIMED', error: 'Another carrier claimed this task while recovering stale lock' };
              }
              return { success: false, status: 'FAILED', error_code: 'CLAIM_FAILED', error: retryErr.message };
            }
          }

          return {
            success: false,
            status: 'ALREADY_CLAIMED',
            error_code: 'ALREADY_CLAIMED',
            error: 'Task already has an active execution claim',
            existing_claim: existingClaim
          };
        }

        return { success: false, status: 'ALREADY_CLAIMED', error_code: 'ALREADY_CLAIMED', error: 'Task already has an active execution claim' };
      }
      return { success: false, status: 'FAILED', error_code: 'CLAIM_FAILED', error: err.message };
    }
  });
}

async function releaseExecutionClaim(requestId, executionClaimId) {
  return withRegistryLock(async () => {
    const cache = getCache();
    const entry = cache.get(requestId);

    if (!entry) {
      return { success: false, error_code: 'TASK_NOT_FOUND', error: 'Task not found in registry' };
    }

    const lockPath = claimLockPath(requestId);

    if (executionClaimId) {
      const existingClaim = readClaimLock(lockPath);
      if (existingClaim && existingClaim.execution_claim_id !== executionClaimId) {
        return { success: false, error_code: 'CLAIM_MISMATCH', error: 'Execution claim ID does not match current claim', existing_claim: existingClaim };
      }
    }

    clearClaimLock(lockPath);

    if (entry.execution_claim) {
      delete entry.execution_claim;
      entry.updated_at = new Date().toISOString();
      cache.set(requestId, entry);
      await persistCache();
    }

    return { success: true, status: 'RELEASED', error_code: 'RELEASED', error: null };
  });
}

function getExecutionClaim(requestId) {
  const cache = getCache();
  const entry = cache.get(requestId);

  if (!entry) {
    return null;
  }

  if (entry.execution_claim) {
    return entry.execution_claim;
  }

  const lockPath = claimLockPath(requestId);
  const lockClaim = readClaimLock(lockPath);
  if (lockClaim && lockClaim.request_id === requestId) {
    return lockClaim;
  }

  return null;
}

function getExecutionClaimFromDisk(requestId) {
  const lockPath = claimLockPath(requestId);
  return readClaimLock(lockPath);
}

async function rehydrateTaskFromCallback(requestId, callbackReport) {
  return withRegistryLock(async () => {
    const callbackClaimId = callbackReport &&
      callbackReport.result &&
      callbackReport.result.execution_metadata &&
      callbackReport.result.execution_metadata.execution_claim_id;

    const callbackCarrierIdentity = callbackReport &&
      callbackReport.result &&
      callbackReport.result.execution_metadata &&
      callbackReport.result.execution_metadata.carrier_identity;

    const diskClaim = getExecutionClaimFromDisk(requestId);

    if (!diskClaim) {
      return {
        success: false,
        error_code: 'NO_CLAIM_ON_DISK',
        error: 'Task not in registry and no execution claim lock found on disk'
      };
    }

    if (diskClaim.execution_claim_id !== callbackClaimId) {
      return {
        success: false,
        error_code: 'EXECUTION_CLAIM_MISMATCH',
        error: `Execution claim ID mismatch: expected ${diskClaim.execution_claim_id}, got ${callbackClaimId}`
      };
    }

    if (diskClaim.carrier_identity !== callbackCarrierIdentity) {
      return {
        success: false,
        error_code: 'CARRIER_IDENTITY_MISMATCH',
        error: `Carrier identity mismatch: expected ${diskClaim.carrier_identity}, got ${callbackCarrierIdentity}`
      };
    }

    const cache = getCache();
    if (cache.has(requestId)) {
      return {
        success: false,
        error_code: 'TASK_EXISTS',
        error: 'Task already exists in registry'
      };
    }

    const now = new Date().toISOString();
    const entry = {
      request_id: requestId,
      parent_request_id: null,
      originator: callbackReport.originator || 'Kyle',
      current_agent: 'Gemini',
      next_agent: 'Gemini',
      repository: callbackReport.repository || 'fluentwithkyle/openclaw-webhook',
      base_branch: callbackReport.base_branch || 'main',
      task: callbackReport.task || '',
      task_mode: 'BUILDER',
      workflow_stage: null,
      status: 'EXECUTING',
      created_at: now,
      updated_at: now,
      kilo: {
        status: 'success',
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
      next_action: 'trigger_gemini',
      verification: callbackReport.verification || null,
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
      permitted_paths: ['poc/'],
      evidence: [],
      lineage: {
        superseded_by: null,
        superseded_at: null,
        cancelled: false,
        cancelled_at: null
      },
      config_verification: {},
      transition_decision_provenance: null,
      execution_claim: {
        execution_claim_id: diskClaim.execution_claim_id,
        carrier_identity: diskClaim.carrier_identity,
        carrier_type: diskClaim.carrier_type || 'github_workflow',
        claimed_at: diskClaim.claimed_at,
        claim_epoch: diskClaim.claim_epoch
      }
    };

    cache.set(requestId, entry);
    await persistCache();

    return {
      success: true,
      entry: entry,
      rehydrated: true
    };
  });
}

function buildExecutionDescriptor(requestId, taskEntry, executionClaimId) {
  if (!taskEntry) {
    return null;
  }

  return {
    request_id: requestId,
    execution_claim_id: executionClaimId,
    activation_id: taskEntry.activation_provenance && taskEntry.activation_provenance.activation_id,
    activation_target: taskEntry.activation_provenance && taskEntry.activation_provenance.activation_target,
    activation_task_mode: taskEntry.activation_provenance && taskEntry.activation_provenance.activation_task_mode,
    activation_surface: taskEntry.activation_provenance && taskEntry.activation_provenance.activation_surface,
    task: taskEntry.task,
    repository: taskEntry.repository,
    base_branch: taskEntry.base_branch,
    task_mode: taskEntry.task_mode,
    capabilities: taskEntry.capabilities,
    permitted_paths: taskEntry.permitted_paths,
    verification: taskEntry.verification,
    workflow_stage: taskEntry.workflow_stage,
    target_agent: taskEntry.current_agent,
    carrier_identity: taskEntry.execution_claim && taskEntry.execution_claim.carrier_identity || null,
    carrier_type: taskEntry.execution_claim && taskEntry.execution_claim.carrier_type || null
  };
}

async function transitionToExecuting(requestId) {
  const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
  for (const status of transitions) {
    const r = await updateTaskStatus(requestId, status);
    if (!r.success) {
      return { success: false, error: r.error };
    }
  }
  return { success: true };
}

module.exports = {
  createTask,
  createDirectorApproval,
  consumeDirectorApproval,
  createTaskWithDirectorAuthorization,
  consumeDirectorApprovalAndCreateTask,
  getDirectorApproval,
  revokePendingDirectorApprovals,
  getTask,
  replayTask,
  computePayloadFingerprint,
  updateTaskStatus,
  updateAgentResult,
  setNextAction,
  createCoordinationContext,
  advanceCoordinationContext,
  setCoordinationContextCurrent,
  getAllTasks,
  getTasksByStatus,
  deleteTask,
  resetRegistry,
  resetMemoryCache,
  rehydrateTask,
  loadFromFile,
  persistCache,
  REGISTRY_FILE,
  isCancelled,
  isSuperseded,
  activeTaskExists,
  getTasksByParent,
  resolveCurrentLineage,
  validateLineageForCreate,
  addEvidence,
  getEvidenceByType,
  hasEvidenceOfType,
  supersedeTask,
  cancelTask,
  recordConfigVerification,
  getConfigVerificationState,
  requireConfigVerified,
  verifyConfig,
  claimExecutionContext,
  releaseExecutionClaim,
  getExecutionClaim,
  rehydrateTaskFromCallback,
  buildExecutionDescriptor,
  transitionToExecuting,
  CLAIMS_DIR,
  CLAIM_STALE_MS,
  isClaimStale
};
