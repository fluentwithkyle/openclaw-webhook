const fs = require('fs');
const path = require('path');
const {
  validateTaskRegistryEntry,
  createInitialTaskRegistryEntry,
  isValidStateTransition,
  validateStateTransitionWithEvidence,
  getRequiredEvidenceForTransition,
  createEvidenceRecord,
  validateEvidenceRecord,
  validateAgentEvidenceType,
  EVIDENCE_TYPES,
  AGENT_EVIDENCE_TYPE,
  VALID_STATE_TRANSITIONS
} = require('./schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, 'task-registry.json.bak');

let memoryCache = new Map();
let initialized = false;

function ensureRegistryFile() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, '{}', 'utf8');
  }
}

function loadFromFile() {
  try {
    ensureRegistryFile();
    const data = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(data || '{}');
    memoryCache = new Map(Object.entries(parsed));
    initialized = true;
  } catch (err) {
    console.error('Failed to load task registry:', err.message);
    memoryCache = new Map();
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

function persistCache() {
  const data = Object.fromEntries(memoryCache);
  atomicWrite(data);
}

function createTask(command) {
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
  const validation = validateTaskRegistryEntry(entry);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  cache.set(requestId, entry);
  persistCache();
  return { success: true, entry };
}

function getTask(requestId) {
  const cache = getCache();
  return cache.get(requestId) || null;
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
    return { valid: false, error: 'Parent task not found in registry: ' + parentId };
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

function addEvidence(requestId, evidenceType, agent, reportData) {
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
  persistCache();
  return { success: true, entry, evidence_record: evidence };
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

function supersedeTask(requestId, reason) {
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
    originator: entry.originator,
    parent_request_id: requestId
  };

  const createResult = createTask(command);
  if (!createResult.success) {
    return createResult;
  }

  const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
  for (const status of transitions) {
    const r = updateTaskStatus(newRequestId, status);
    if (!r.success) {
      return {
        success: false,
        error: 'Failed to transition to ' + status + ': ' + r.error
      };
    }
  }

  persistCache();
  return {
    success: true,
    new_request_id: newRequestId,
    new_entry: getTask(newRequestId),
    superseded_entry: getTask(requestId)
  };
}

function cancelTask(requestId, reason) {
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

  entry.lineage = entry.lineage || {};
  entry.lineage.cancelled = true;
  entry.lineage.cancelled_at = new Date().toISOString();
  entry.lineage.cancel_reason = reason || 'no reason provided';
  entry.status = 'FAILED';
  entry.updated_at = new Date().toISOString();
  cache.set(requestId, entry);
  persistCache();
  return { success: true, entry };
}

function updateTaskStatus(requestId, newStatus) {
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
  persistCache();
  return { success: true, entry };
}

function updateAgentResult(requestId, agent, result) {
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
  persistCache();
  return { success: true, entry, evidence_record: evidence };
}

function setNextAction(requestId, nextAction) {
  const cache = getCache();
  const entry = cache.get(requestId);
  if (!entry) {
    return { success: false, error: 'Task not found' };
  }

  entry.next_action = nextAction;
  entry.updated_at = new Date().toISOString();
  cache.set(requestId, entry);
  persistCache();
  return { success: true, entry };
}

function getAllTasks() {
  const cache = getCache();
  return Array.from(cache.values());
}

function getTasksByStatus(status) {
  const cache = getCache();
  return Array.from(cache.values()).filter(t => t.status === status);
}

function deleteTask(requestId) {
  const cache = getCache();
  const deleted = cache.delete(requestId);
  if (deleted) {
    persistCache();
  }
  return { success: deleted };
}

function resetRegistry() {
  memoryCache = new Map();
  atomicWrite({});
  return { success: true };
}

function rehydrateTask(command) {
  const requestId = command.request_id;

  const existing = getTask(requestId);
  if (existing) {
    const state = existing.status;

    if (state === 'COMPLETE') {
      return { success: true, entry: existing, rehydrated: false, action: 'none' };
    }

    if (state === 'VERIFIED') {
      return { success: true, entry: existing, rehydrated: false, action: 'complete' };
    }

    if (state === 'EXECUTING') {
      if (existing.kilo.status === 'pending') {
        return { success: true, entry: existing, rehydrated: false, action: 'kilo_execution' };
      }
      if (existing.kilo.status === 'success' && existing.builder.status === 'pending' && existing.next_action === 'trigger_builder') {
        return { success: true, entry: existing, rehydrated: false, action: 'trigger_builder' };
      }
      if (existing.builder.status === 'success' && existing.gemini.status === 'pending' && existing.next_action === 'trigger_gemini') {
        return { success: true, entry: existing, rehydrated: false, action: 'trigger_gemini' };
      }
      if (existing.gemini.status === 'pending' && existing.next_action === 'waiting_gemini_callback') {
        return { success: true, entry: existing, rehydrated: false, action: 'waiting_gemini' };
      }
      return { success: true, entry: existing, rehydrated: false, action: 'continue' };
    }

    if (state === 'FAILED' || state === 'BLOCKED') {
      return {
        success: false,
        error: 'Task in terminal state ' + state + ', requires human review',
        entry: existing
      };
    }

    if (state === 'PENDING' || state === 'SELECTED' || state === 'PLANNED') {
      if (isCancelled(requestId) || isSuperseded(requestId)) {
        return {
          success: false,
          error: 'Task is cancelled or superseded, cannot rehydrate',
          entry: existing
        };
      }

      const transitions = [];
      if (state === 'PENDING') transitions.push('SELECTED', 'PLANNED', 'EXECUTING');
      else if (state === 'SELECTED') transitions.push('PLANNED', 'EXECUTING');
      else if (state === 'PLANNED') transitions.push('EXECUTING');

      for (const status of transitions) {
        const r = updateTaskStatus(requestId, status);
        if (!r.success) {
          return {
            success: false,
            error: 'Failed to transition to ' + status + ': ' + r.error
          };
        }
      }

      return { success: true, entry: getTask(requestId), rehydrated: true, action: 'kilo_execution' };
    }

    return {
      success: false,
      error: 'Cannot rehydrate task in state ' + state,
      entry: existing
    };
  }

  const createResult = createTask(command);
  if (!createResult.success) {
    return createResult;
  }

  const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
  for (const status of transitions) {
    const r = updateTaskStatus(requestId, status);
    if (!r.success) {
      return {
        success: false,
        error: 'Failed to transition to ' + status + ': ' + r.error
      };
    }
  }

  return { success: true, entry: getTask(requestId), rehydrated: true, action: 'kilo_execution' };
}

module.exports = {
  createTask,
  getTask,
  updateTaskStatus,
  updateAgentResult,
  setNextAction,
  getAllTasks,
  getTasksByStatus,
  deleteTask,
  resetRegistry,
  rehydrateTask,
  loadFromFile,
  persistCache,
  REGISTRY_FILE,
  isCancelled,
  isSuperseded,
  activeTaskExists,
  getTasksByParent,
  addEvidence,
  getEvidenceByType,
  hasEvidenceOfType,
  supersedeTask,
  cancelTask
};
