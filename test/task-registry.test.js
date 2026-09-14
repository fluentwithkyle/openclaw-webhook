const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${name} - ${err.message}`);
    return false;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'Deep assertion failed'}: expected ${e}, got ${a}`);
  }
}

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  const result = runTest(name, fn);
  if (result) passCount++; else failCount++;
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'test-reg-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only'] },
  verification: 'test',
  reporting: 'json',
  originator: 'Kyle'
};

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

test('createTask - creates new task successfully', () => {
  cleanup();
  const result = taskRegistry.createTask(validCommand);
  assertEqual(result.success, true);
  assertEqual(result.entry.request_id, 'test-reg-1');
  assertEqual(result.entry.status, 'PENDING');
  assertEqual(result.entry.kilo.status, 'pending');
  assertEqual(result.entry.gemini.status, 'pending');
  cleanup();
});

test('createTask - duplicate request_id returns error', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.createTask(validCommand);
  assertEqual(result.success, false);
  assertEqual(result.duplicate, true);
  assert(result.error.includes('Duplicate'));
  cleanup();
});

test('getTask - retrieves existing task', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const task = taskRegistry.getTask('test-reg-1');
  assert(task !== null);
  assertEqual(task.request_id, 'test-reg-1');
  cleanup();
});

test('getTask - returns null for non-existent task', () => {
  cleanup();
  const task = taskRegistry.getTask('non-existent');
  assertEqual(task, null);
  cleanup();
});

test('updateTaskStatus - valid transition', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'SELECTED');
  cleanup();
});

test('updateTaskStatus - invalid transition fails', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateTaskStatus('test-reg-1', 'COMPLETE');
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid state transition'));
  cleanup();
});

test('updateTaskStatus - non-existent task fails', () => {
  cleanup();
  const result = taskRegistry.updateTaskStatus('non-existent', 'SELECTED');
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));
  cleanup();
});

test('updateAgentResult - Kilo success', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-123',
    report: validCommand
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.kilo.status, 'success');
  assertEqual(result.entry.kilo.execution_id, 'exec-123');
  assertEqual(result.entry.current_agent, 'Gemini');
  cleanup();
});

test('updateAgentResult - Gemini success', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-123', report: {} });
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Gemini', {
    status: 'success',
    execution_id: 'exec-456',
    report: {}
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.gemini.status, 'success');
  assertEqual(result.entry.gemini.execution_id, 'exec-456');
  assertEqual(result.entry.current_agent, null);
  cleanup();
});

test('updateAgentResult - unknown agent fails', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Unknown', { status: 'success' });
  assertEqual(result.success, false);
  assert(result.error.includes('Unknown agent'));
  cleanup();
});

test('setNextAction - updates next_action', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.setNextAction('test-reg-1', 'trigger_gemini');
  assertEqual(result.success, true);
  assertEqual(result.entry.next_action, 'trigger_gemini');
  cleanup();
});

test('getAllTasks - returns all tasks', () => {
  cleanup();
  taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
  taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
  const tasks = taskRegistry.getAllTasks();
  assertEqual(tasks.length, 2);
  cleanup();
});

test('getTasksByStatus - filters by status', () => {
  cleanup();
  taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
  taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
  taskRegistry.updateTaskStatus('task-1', 'SELECTED');
  const pending = taskRegistry.getTasksByStatus('PENDING');
  const selected = taskRegistry.getTasksByStatus('SELECTED');
  assertEqual(pending.length, 1);
  assertEqual(selected.length, 1);
  cleanup();
});

test('deleteTask - removes task', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.deleteTask('test-reg-1');
  assertEqual(result.success, true);
  assertEqual(taskRegistry.getTask('test-reg-1'), null);
  cleanup();
});

test('deleteTask - non-existent returns false', () => {
  cleanup();
  const result = taskRegistry.deleteTask('non-existent');
  assertEqual(result.success, false);
  cleanup();
});

test('Persistence - survives reload', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  taskRegistry.loadFromFile();
  const task = taskRegistry.getTask('test-reg-1');
  assert(task !== null);
  assertEqual(task.status, 'SELECTED');
  cleanup();
});

test('Atomic write - backup file used', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  assert(fs.existsSync(REGISTRY_FILE));
  const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
  assert(content.includes('test-reg-1'));
  cleanup();
});

console.log(`\n=== TaskRegistry Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);