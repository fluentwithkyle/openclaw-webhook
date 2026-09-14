const fs = require('fs');
const path = require('path');
const {
  validateTaskRegistryEntry,
  createInitialTaskRegistryEntry,
  isValidStateTransition,
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

function updateTaskStatus(requestId, newStatus) {
  const cache = getCache();
  const entry = cache.get(requestId);
  if (!entry) {
    return { success: false, error: 'Task not found' };
  }

  if (!isValidStateTransition(entry.status, newStatus)) {
    return { success: false, error: `Invalid state transition: ${entry.status} -> ${newStatus}` };
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

  if (agent === 'Kilo') {
    entry.kilo = {
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
  } else {
    return { success: false, error: `Unknown agent: ${agent}` };
  }

  entry.updated_at = new Date().toISOString();
  cache.set(requestId, entry);
  persistCache();
  return { success: true, entry };
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
  loadFromFile,
  REGISTRY_FILE
};