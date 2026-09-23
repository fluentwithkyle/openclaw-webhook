const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const {
  validateStateTransitionWithEvidence,
  getRequiredEvidenceForTransition,
  createEvidenceRecord,
  validateEvidenceRecord,
  validateACPCompliance,
  validateActivationSyntax,
  validateActivationSurface,
  AGENT_EVIDENCE_TYPE,
  EVIDENCE_TYPES
} = require('../poc/schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

let passCount = 0;
let failCount = 0;

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

const validCommand = {
  protocol_version: '0.1',
  request_id: 'test-rel-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only'] },
  verification: 'All tests must pass',
  reporting: 'json',
  originator: 'Kyle'
};

const failoverCommand = {
  protocol_version: '0.1',
  request_id: 'test-rel-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  task_mode: 'FAILOVER_EXECUTE',
  constraints: { permitted_paths: ['poc/', 'test/'] },
  authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
  verification: 'All tests must pass; lint must pass; no security vulnerabilities',
  reporting: 'json',
  originator: 'Kyle'
};

const validKiloReport = {
  request_id: 'test-rel-1',
  agent: 'Kilo',
  status: 'success',
  task: 'test-task',
  changed_files: ['poc/new-file.js'],
  verification: ['tests passed'],
  result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
  commit: 'abc123',
  push: true,
  blockers: []
};

const validGeminiReport = {
  request_id: 'test-rel-1',
  agent: 'Gemini',
  status: 'success',
  task: 'test-task',
  changed_files: [],
  verification: ['review passed'],
  result: { execution_metadata: { invocation_id: 'inv-2', run_id: 'run-2' } },
  commit: null,
  push: false,
  blockers: []
};

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

function setupTask() {
  cleanup();
  const rid = validCommand.request_id;
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus(rid, 'SELECTED');
  taskRegistry.updateTaskStatus(rid, 'PLANNED');
  taskRegistry.updateTaskStatus(rid, 'EXECUTING');
}

function test(name, fn) {
  const result = runTest(name, fn);
  if (result) passCount++; else failCount++;
}

// === Evidence-gated state transitions (fail closed) ===

test('EXECUTING->VERIFIED fails without INDEPENDENT_VERIFICATION evidence', () => {
  setupTask();
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED');
  assertEqual(result.success, false);
  assert(result.error.includes('requires'));
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

test('EXECUTING->VERIFIED succeeds with INDEPENDENT_VERIFICATION evidence', () => {
  setupTask();
  const addResult = taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  assertEqual(addResult.success, true);
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'VERIFIED');
  cleanup();
});

test('VERIFIED->COMPLETE fails without INDEPENDENT_VERIFICATION evidence', () => {
  setupTask();
  const task = taskRegistry.getTask('test-rel-1');
  task.status = 'VERIFIED';
  taskRegistry.persistCache();

  const result = taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE');
  assertEqual(result.success, false);
  assert(result.error.includes('requires'));
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

test('VERIFIED->COMPLETE succeeds with INDEPENDENT_VERIFICATION evidence', () => {
  setupTask();
  taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED');
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'COMPLETE');
  cleanup();
});

test('EXECUTING->FAILED succeeds without evidence (no evidence required for failure path)', () => {
  setupTask();
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'FAILED');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'FAILED');
  cleanup();
});

// === Evidence recording in updateAgentResult ===

test('Kilo result records AGENT_REPORT evidence automatically', () => {
  setupTask();
  const result = taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: validKiloReport
  });
  assertEqual(result.success, true);
  assert(result.evidence_record);
  assertEqual(result.evidence_record.evidence_type, 'AGENT_REPORT');
  assertEqual(result.evidence_record.agent, 'Kilo');
  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.evidence.length, 1);
  assertEqual(task.evidence[0].evidence_type, 'AGENT_REPORT');
  cleanup();
});

test('Gemini result records INDEPENDENT_VERIFICATION evidence automatically', () => {
  setupTask();
  taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  });
  const result = taskRegistry.updateAgentResult('test-rel-1', 'Gemini', {
    status: 'success',
    execution_id: 'exec-2',
    report: validGeminiReport
  });
  assertEqual(result.success, true);
  assertEqual(result.evidence_record.evidence_type, 'INDEPENDENT_VERIFICATION');
  assertEqual(result.evidence_record.agent, 'Gemini');
  cleanup();
});

test('Gemini Builder result records AGENT_REPORT evidence automatically', () => {
  setupTask();
  taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  });
  const result = taskRegistry.updateAgentResult('test-rel-1', 'Gemini Builder', {
    status: 'success',
    execution_id: 'exec-b1',
    report: { agent: 'Gemini Builder', status: 'success' }
  });
  assertEqual(result.success, true);
  assertEqual(result.evidence_record.evidence_type, 'AGENT_REPORT');
  assertEqual(result.evidence_record.agent, 'Gemini Builder');
  cleanup();
});

// === addEvidence ===

test('addEvidence creates and stores evidence record', () => {
  setupTask();
  const result = taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', {
    status: 'success',
    execution_id: 'inv-100'
  });
  assertEqual(result.success, true);
  assert(result.evidence_record.evidence_id);
  assertEqual(result.evidence_record.request_id, 'test-rel-1');
  assertEqual(result.evidence_record.evidence_type, 'INDEPENDENT_VERIFICATION');
  assertEqual(result.evidence_record.agent, 'Gemini');
  assertEqual(result.evidence_record.verification_result, 'success');

  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.evidence.length, 1);
  cleanup();
});

test('addEvidence rejects invalid evidence_type', () => {
  setupTask();
  const result = taskRegistry.addEvidence('test-rel-1', 'INVALID_TYPE', 'Gemini', { status: 'success' });
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid evidence_type'));
  cleanup();
});

test('addEvidence rejects non-existent task', () => {
  cleanup();
  const result = taskRegistry.addEvidence('non-existent', 'AGENT_REPORT', 'Kilo', { status: 'success' });
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));
  cleanup();
});

// === getEvidenceByType / hasEvidenceOfType ===

test('getEvidenceByType returns matching evidence', () => {
  setupTask();
  taskRegistry.addEvidence('test-rel-1', 'AGENT_REPORT', 'Kilo', { status: 'success' });
  taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });

  const result = taskRegistry.getEvidenceByType('test-rel-1', 'INDEPENDENT_VERIFICATION');
  assertEqual(result.success, true);
  assertEqual(result.evidence.length, 1);
  assertEqual(result.evidence[0].agent, 'Gemini');
  cleanup();
});

test('getEvidenceByType returns empty array for no matches', () => {
  setupTask();
  const result = taskRegistry.getEvidenceByType('test-rel-1', 'AGENT_REPORT');
  assertEqual(result.success, true);
  assertEqual(result.evidence.length, 0);
  cleanup();
});

test('hasEvidenceOfType returns true when present, false when absent', () => {
  setupTask();
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION'), false);
  taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION'), true);
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'AGENT_REPORT'), false);
  cleanup();
});

// === Cancelled/superseded state blocking (fail closed) ===

test('updateTaskStatus fails for cancelled task (fail closed)', () => {
  setupTask();
  taskRegistry.cancelTask('test-rel-1', 'test cancellation');
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'SELECTED');
  assertEqual(result.success, false);
  assert(result.error.includes('cancelled'));
  cleanup();
});

test('updateTaskStatus fails for superseded task (fail closed)', () => {
  setupTask();
  taskRegistry.supersedeTask('test-rel-1', 'needs re-run');
  const supersedeResult = taskRegistry.supersedeTask('test-rel-1', 'second supersede attempt');
  assertEqual(supersedeResult.success, false);
  const result = taskRegistry.updateTaskStatus('test-rel-1', 'SELECTED');
  assertEqual(result.success, false);
  assert(result.error.includes('superseded'));
  cleanup();
});

// === supersedeTask ===

test('supersedeTask creates new task with parent_request_id and marks original superseded', () => {
  setupTask();
  const result = taskRegistry.supersedeTask('test-rel-1', 'needs re-run');
  assertEqual(result.success, true);
  assert(result.new_request_id);
  assertEqual(result.new_entry.parent_request_id, 'test-rel-1');
  assertEqual(result.new_entry.status, 'EXECUTING');
  assertEqual(result.superseded_entry.lineage.superseded_by, result.new_request_id);
  assert(result.superseded_entry.lineage.superseded_at);
  cleanup();
});

test('supersedeTask fails for completed task', () => {
  setupTask();
  taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED');
  taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE');
  const result = taskRegistry.supersedeTask('test-rel-1', 'too late');
  assertEqual(result.success, false);
  assert(result.error.includes('completed'));
  cleanup();
});

// === cancelTask ===

test('cancelTask marks task as cancelled and transitions to FAILED', () => {
  setupTask();
  const result = taskRegistry.cancelTask('test-rel-1', 'manual cancel');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'FAILED');
  assertEqual(result.entry.lineage.cancelled, true);
  assert(result.entry.lineage.cancelled_at);
  assertEqual(result.entry.lineage.cancel_reason, 'manual cancel');

  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.lineage.cancelled, true);
  assertEqual(task.status, 'FAILED');
  cleanup();
});

test('cancelTask fails for completed task', () => {
  setupTask();
  taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED');
  taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE');
  const result = taskRegistry.cancelTask('test-rel-1', 'too late');
  assertEqual(result.success, false);
  assert(result.error.includes('completed'));
  cleanup();
});

test('cancelTask idempotent (already cancelled)', () => {
  setupTask();
  taskRegistry.cancelTask('test-rel-1', 'first cancel');
  const result = taskRegistry.cancelTask('test-rel-1', 'second cancel');
  assertEqual(result.success, false);
  assert(result.error.includes('already cancelled'));
  assertEqual(result.cancelled, true);
  cleanup();
});

// === isSuperseded / isCancelled ===

test('isSuperseded and isCancelled return correct boolean values', () => {
  setupTask();
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), false);
  assertEqual(taskRegistry.isCancelled('test-rel-1'), false);

  taskRegistry.cancelTask('test-rel-1', 'cancel for test');
  assertEqual(taskRegistry.isCancelled('test-rel-1'), true);

  cleanup();
  setupTask();
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), false);
  taskRegistry.supersedeTask('test-rel-1', 'supersede for test');
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), true);
  cleanup();
});

// === activeTaskExists ===

test('activeTaskExists returns true for active task, false for non-existent', () => {
  setupTask();
  assertEqual(taskRegistry.activeTaskExists('test-rel-1'), true);
  assertEqual(taskRegistry.activeTaskExists('non-existent'), false);
  cleanup();
});

// === getTasksByParent ===

test('getTasksByParent returns tasks with matching parent_request_id', () => {
  setupTask();
  const supersedeResult = taskRegistry.supersedeTask('test-rel-1', 're-run');
  assertEqual(supersedeResult.success, true);
  const children = taskRegistry.getTasksByParent('test-rel-1');
  assertEqual(children.length, 1);
  assertEqual(children[0].parent_request_id, 'test-rel-1');
  assertEqual(taskRegistry.getTasksByParent('non-existent-parent').length, 0);
  cleanup();
});

// === State-driven rehydrateTask ===

test('rehydrateTask advances PENDING task to EXECUTING', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.rehydrateTask(validCommand);
  assertEqual(result.success, true);
  assertEqual(result.rehydrated, true);
  assertEqual(result.action, 'kilo_execution');
  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.status, 'EXECUTING');
  cleanup();
});

// === ACP compliance validation entry point ===

test('validateACPCompliance succeeds for valid command and fails for invalid target', () => {
  const result = validateACPCompliance(failoverCommand);
  assertEqual(result.valid, true);

  const badCmd = { ...failoverCommand, target: 'InvalidAgent' };
  const badResult = validateACPCompliance(badCmd);
  assertEqual(badResult.valid, false);
  assert(badResult.error.includes('target'));
});

test('Activation syntax: @kilo valid, @Gemini rejected, @gemini-cli valid', () => {
  const kiloResult = validateActivationSyntax('@kilo run test task', 'Kilo');
  assertEqual(kiloResult.valid, true);

  const bareGemini = validateActivationSyntax('@Gemini run task', 'Gemini');
  assertEqual(bareGemini.valid, false);
  assert(bareGemini.error.includes('@Gemini is not valid'));

  const geminiCli = validateActivationSyntax('@gemini-cli run task', 'Gemini');
  assertEqual(geminiCli.valid, true);

  const arbitrary = validateActivationSyntax('please @gemini review', 'Gemini');
  assertEqual(arbitrary.valid, false);
});

test('Orchestrator handleGeminiCompletion records INDEPENDENT_VERIFICATION evidence and transitions to VERIFIED', () => {
  setupTask();
  taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  });
  const result = orchestrator.handleGeminiCompletion('test-rel-1', validGeminiReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'complete');

  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.status, 'VERIFIED');
  assertEqual(task.gemini.status, 'success');

  const hasIv = taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION');
  assertEqual(hasIv, true);
  cleanup();
});
test('validateActivationSurface accepts authorized surfaces and rejects unauthorized', () => {
  const kiloResult = validateActivationSurface('github_issue_comment', 'Kilo');
  assertEqual(kiloResult.valid, true);

  const geminiResult = validateActivationSurface('workflow_dispatch', 'Gemini');
  assertEqual(geminiResult.valid, true);

  const badSurface = validateActivationSurface('github_push_event', 'Gemini');
  assertEqual(badSurface.valid, false);
  assert(badSurface.error.includes('Unauthorized'));
});

console.log(`\n=== Reliability Enforcement Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);