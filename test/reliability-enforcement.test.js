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
  validateAgentEvidenceType,
  verifyConfiguration,
  isConfigurationAuthoritativelyVerified,
  validateACPCompliance,
  validateActivationSyntax,
  validateActivationSurface,
  AGENT_EVIDENCE_TYPE,
  EVIDENCE_TYPES,
  CONFIG_VERIFICATION_STATES
} = require('../poc/schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

let passCount = 0;
let failCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
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
  originator: 'Kyle',
  activation_syntax: '@kilo',
  activation_surface: 'github_issue_comment'
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

async function setupTask() {
  cleanup();
  const rid = validCommand.request_id;
  await taskRegistry.createTask(validCommand);
  await taskRegistry.updateTaskStatus(rid, 'SELECTED');
  await taskRegistry.updateTaskStatus(rid, 'PLANNED');
  await taskRegistry.updateTaskStatus(rid, 'EXECUTING');
}

let testQueue = Promise.resolve();
function test(name, fn) {
  testQueue = testQueue.then(async () => {
    const result = await runTest(name, fn);
    if (result) passCount++; else failCount++;
  });
}

// === Evidence-gated state transitions (fail closed) ===

test('EXECUTING->VERIFIED fails without INDEPENDENT_VERIFICATION evidence', async () => {
  await setupTask();
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  assertEqual(result.success, false);
  assert(result.error.includes('requires'));
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

test('EXECUTING->VERIFIED succeeds with INDEPENDENT_VERIFICATION evidence', async () => {
  await setupTask();
  const addResult = (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  assertEqual(addResult.success, true);
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'VERIFIED');
  cleanup();
});

test('VERIFIED->COMPLETE fails without INDEPENDENT_VERIFICATION evidence', async () => {
  await setupTask();
  const task = taskRegistry.getTask('test-rel-1');
  task.status = 'VERIFIED';
  (await taskRegistry.persistCache());

  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  assertEqual(result.success, false);
  assert(result.error.includes('requires'));
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

test('VERIFIED->COMPLETE succeeds with INDEPENDENT_VERIFICATION evidence', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'COMPLETE');
  cleanup();
});

test('EXECUTING->FAILED succeeds without evidence (no evidence required for failure path)', async () => {
  await setupTask();
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'FAILED'));
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'FAILED');
  cleanup();
});

// === Evidence recording in updateAgentResult ===

test('Kilo result records AGENT_REPORT evidence automatically', async () => {
  await setupTask();
  const result = (await taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: validKiloReport
  }));
  assertEqual(result.success, true);
  assert(result.evidence_record);
  assertEqual(result.evidence_record.evidence_type, 'AGENT_REPORT');
  assertEqual(result.evidence_record.agent, 'Kilo');
  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.evidence.length, 1);
  assertEqual(task.evidence[0].evidence_type, 'AGENT_REPORT');
  cleanup();
});

test('Gemini result records INDEPENDENT_VERIFICATION evidence automatically', async () => {
  await setupTask();
  (await taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  }));
  const result = (await taskRegistry.updateAgentResult('test-rel-1', 'Gemini', {
    status: 'success',
    execution_id: 'exec-2',
    report: validGeminiReport
  }));
  assertEqual(result.success, true);
  assertEqual(result.evidence_record.evidence_type, 'INDEPENDENT_VERIFICATION');
  assertEqual(result.evidence_record.agent, 'Gemini');
  cleanup();
});

test('Gemini Builder result records AGENT_REPORT evidence automatically', async () => {
  await setupTask();
  (await taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  }));
  const result = (await taskRegistry.updateAgentResult('test-rel-1', 'Gemini Builder', {
    status: 'success',
    execution_id: 'exec-b1',
    report: { agent: 'Gemini Builder', status: 'success' }
  }));
  assertEqual(result.success, true);
  assertEqual(result.evidence_record.evidence_type, 'AGENT_REPORT');
  assertEqual(result.evidence_record.agent, 'Gemini Builder');
  cleanup();
});

// === addEvidence ===

test('addEvidence creates and stores evidence record', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', {
    status: 'success',
    execution_id: 'inv-100'
  }));
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

test('addEvidence rejects invalid evidence_type', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'INVALID_TYPE', 'Gemini', { status: 'success' }));
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid evidence_type'));
  cleanup();
});

test('addEvidence rejects non-existent task', async () => {
  cleanup();
  const result = (await taskRegistry.addEvidence('non-existent', 'AGENT_REPORT', 'Kilo', { status: 'success' }));
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));
  cleanup();
});

// === getEvidenceByType / hasEvidenceOfType ===

test('getEvidenceByType returns matching evidence', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'AGENT_REPORT', 'Kilo', { status: 'success' }));
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));

  const result = taskRegistry.getEvidenceByType('test-rel-1', 'INDEPENDENT_VERIFICATION');
  assertEqual(result.success, true);
  assertEqual(result.evidence.length, 1);
  assertEqual(result.evidence[0].agent, 'Gemini');
  cleanup();
});

test('getEvidenceByType returns empty array for no matches', async () => {
  await setupTask();
  const result = taskRegistry.getEvidenceByType('test-rel-1', 'AGENT_REPORT');
  assertEqual(result.success, true);
  assertEqual(result.evidence.length, 0);
  cleanup();
});

test('hasEvidenceOfType returns true when present, false when absent', async () => {
  await setupTask();
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION'), false);
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION'), true);
  assertEqual(taskRegistry.hasEvidenceOfType('test-rel-1', 'AGENT_REPORT'), false);
  cleanup();
});

// === Cancelled/superseded state blocking (fail closed) ===

test('updateTaskStatus fails for cancelled task (fail closed)', async () => {
  await setupTask();
  (await taskRegistry.cancelTask('test-rel-1', 'test cancellation'));
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'SELECTED'));
  assertEqual(result.success, false);
  assert(result.error.includes('cancelled'));
  cleanup();
});

test('updateTaskStatus fails for superseded task (fail closed)', async () => {
  await setupTask();
  (await taskRegistry.supersedeTask('test-rel-1', 'needs re-run'));
  const supersedeResult = (await taskRegistry.supersedeTask('test-rel-1', 'second supersede attempt'));
  assertEqual(supersedeResult.success, false);
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'SELECTED'));
  assertEqual(result.success, false);
  assert(result.error.includes('superseded'));
  cleanup();
});

// === supersedeTask ===

test('supersedeTask creates new task with parent_request_id and marks original superseded', async () => {
  await setupTask();
  const result = (await taskRegistry.supersedeTask('test-rel-1', 'needs re-run'));
  assertEqual(result.success, true);
  assert(result.new_request_id);
  assertEqual(result.new_entry.parent_request_id, 'test-rel-1');
  assertEqual(result.new_entry.status, 'EXECUTING');
  assertEqual(result.superseded_entry.lineage.superseded_by, result.new_request_id);
  assert(result.superseded_entry.lineage.superseded_at);
  cleanup();
});

test('supersedeTask fails for completed task', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  const result = (await taskRegistry.supersedeTask('test-rel-1', 'too late'));
  assertEqual(result.success, false);
  assert(result.error.includes('completed'));
  cleanup();
});

// === cancelTask ===

test('cancelTask marks task as cancelled and transitions to FAILED', async () => {
  await setupTask();
  const result = (await taskRegistry.cancelTask('test-rel-1', 'manual cancel'));
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

test('cancelTask fails for completed task', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  const result = (await taskRegistry.cancelTask('test-rel-1', 'too late'));
  assertEqual(result.success, false);
  assert(result.error.includes('completed'));
  cleanup();
});

test('cancelTask idempotent (already cancelled)', async () => {
  await setupTask();
  (await taskRegistry.cancelTask('test-rel-1', 'first cancel'));
  const result = (await taskRegistry.cancelTask('test-rel-1', 'second cancel'));
  assertEqual(result.success, false);
  assert(result.error.includes('already cancelled'));
  assertEqual(result.cancelled, true);
  cleanup();
});

// === isSuperseded / isCancelled ===

test('isSuperseded and isCancelled return correct boolean values', async () => {
  await setupTask();
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), false);
  assertEqual(taskRegistry.isCancelled('test-rel-1'), false);

  (await taskRegistry.cancelTask('test-rel-1', 'cancel for test'));
  assertEqual(taskRegistry.isCancelled('test-rel-1'), true);

  cleanup();
  await setupTask();
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), false);
  (await taskRegistry.supersedeTask('test-rel-1', 'supersede for test'));
  assertEqual(taskRegistry.isSuperseded('test-rel-1'), true);
  cleanup();
});

// === activeTaskExists ===

test('activeTaskExists returns true for active task, false for non-existent', async () => {
  await setupTask();
  assertEqual(taskRegistry.activeTaskExists('test-rel-1'), true);
  assertEqual(taskRegistry.activeTaskExists('non-existent'), false);
  cleanup();
});

// === getTasksByParent ===

test('getTasksByParent returns tasks with matching parent_request_id', async () => {
  await setupTask();
  const supersedeResult = (await taskRegistry.supersedeTask('test-rel-1', 're-run'));
  assertEqual(supersedeResult.success, true);
  const children = taskRegistry.getTasksByParent('test-rel-1');
  assertEqual(children.length, 1);
  assertEqual(children[0].parent_request_id, 'test-rel-1');
  assertEqual(taskRegistry.getTasksByParent('non-existent-parent').length, 0);
  cleanup();
});

// === State-driven rehydrateTask ===

test('rehydrateTask advances PENDING task to EXECUTING', async () => {
  cleanup();
  (await taskRegistry.createTask(validCommand));
  const result = (await taskRegistry.rehydrateTask(validCommand));
  assertEqual(result.success, true);
  assertEqual(result.rehydrated, true);
  assertEqual(result.action, 'kilo_execution');
  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.status, 'EXECUTING');
  cleanup();
});

// === ACP compliance validation entry point ===

test('validateACPCompliance succeeds for valid command and fails for invalid target', async () => {
  const result = validateACPCompliance(failoverCommand);
  assertEqual(result.valid, true);

  const badCmd = { ...failoverCommand, target: 'InvalidAgent' };
  const badResult = validateACPCompliance(badCmd);
  assertEqual(badResult.valid, false);
  assert(badResult.error.includes('target'));
});

test('Activation syntax: @kilo valid, @Gemini rejected, @gemini-cli valid', async () => {
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

test('Orchestrator handleGeminiCompletion records INDEPENDENT_VERIFICATION evidence and transitions to VERIFIED', async () => {
  await setupTask();
  (await taskRegistry.updateAgentResult('test-rel-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-1',
    report: {}
  }));
  const result = await orchestrator.handleGeminiCompletion('test-rel-1', validGeminiReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'complete');

  const task = taskRegistry.getTask('test-rel-1');
  assertEqual(task.status, 'VERIFIED');
  assertEqual(task.gemini.status, 'success');

  const hasIv = taskRegistry.hasEvidenceOfType('test-rel-1', 'INDEPENDENT_VERIFICATION');
  assertEqual(hasIv, true);
  cleanup();
});
test('validateActivationSurface accepts authorized surfaces and rejects unauthorized', async () => {
  const kiloResult = validateActivationSurface('github_issue_comment', 'Kilo');
  assertEqual(kiloResult.valid, true);

  const geminiResult = validateActivationSurface('workflow_dispatch', 'Gemini');
  assertEqual(geminiResult.valid, true);

  const badSurface = validateActivationSurface('github_push_event', 'Gemini');
  assertEqual(badSurface.valid, false);
  assert(badSurface.error.includes('Unauthorized'));
});

const execCmd = (overrides) => Object.assign({}, failoverCommand, overrides);

// === FAILURE 1: Mandatory activation syntax/surface — exact case-sensitive ===

test('F1: FAILOVER_EXECUTE missing activation_syntax is blocked', async () => {
  const cmd = { ...failoverCommand };
  delete cmd.activation_syntax;
  const result = validateACPCompliance(cmd);
  assertEqual(result.valid, false);
  assert(result.error.includes('activation_syntax'));
});

test('F1: FAILOVER_EXECUTE missing activation_surface is blocked', async () => {
  const cmd = { ...failoverCommand };
  delete cmd.activation_surface;
  const result = validateACPCompliance(cmd);
  assertEqual(result.valid, false);
  assert(result.error.includes('activation_surface'));
});

test('F1: exact @kilo accepted for Kilo execution artifact', async () => {
  const result = validateACPCompliance(failoverCommand);
  assertEqual(result.valid, true);
});

test('F1: @Kilo casing rejected (exact lowercase required)', async () => {
  const result = validateACPCompliance({ ...failoverCommand, activation_syntax: '@Kilo' });
  assertEqual(result.valid, false);
});

test('F1: @kilo on unauthorized surface (workflow_dispatch) rejected', async () => {
  const result = validateACPCompliance({ ...failoverCommand, activation_surface: 'workflow_dispatch' });
  assertEqual(result.valid, false);
  assert(result.error.includes('Unauthorized'));
});

test('F1: target/surface/target-syntax mismatch — Kilo surface for Gemini target rejected', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'BUILDER',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment'
  });
  assertEqual(result.valid, false);
});

test('F1: exact @gemini-cli accepted for Gemini Builder execution artifact', async () => {
  const cmd = execCmd({
    request_id: 'builder-cmd-1', task_mode: 'BUILDER', target: 'Gemini Builder',
    activation_syntax: '@gemini-cli', activation_surface: 'workflow_dispatch'
  });
  const result = validateACPCompliance(cmd);
  assertEqual(result.valid, true);
});

test('F1: @Gemini bare rejected for Gemini target', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'BUILDER',
    activation_syntax: '@Gemini', activation_surface: 'workflow_dispatch'
  });
  assertEqual(result.valid, false);
});

test('F1: @GEMINI-CLI rejected (case-sensitive exact)', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'BUILDER',
    activation_syntax: '@GEMINI-CLI', activation_surface: 'workflow_dispatch'
  });
  assertEqual(result.valid, false);
});

test('F1: bare @gemini mention rejected for Gemini target', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'BUILDER',
    activation_syntax: 'please @gemini review this', activation_surface: 'workflow_dispatch'
  });
  assertEqual(result.valid, false);
});

test('F1: Gemini target with Kilo activation (@kilo) rejected', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'BUILDER',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment'
  });
  assertEqual(result.valid, false);
});

test('F1: Kilo target with Gemini activation (@gemini-cli) rejected', async () => {
  const result = validateACPCompliance({ ...failoverCommand, activation_syntax: '@gemini-cli' });
  assertEqual(result.valid, false);
});

test('F1: @gemini-cli FAILOVER_EXECUTE with Gemini target accepted', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@gemini-cli', activation_surface: 'github_issue_comment'
  });
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'FAILOVER_EXECUTE');
});

test('F1: @gemini-cli FAILOVER_EXECUTE with Gemini target requires all 5 capabilities', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@gemini-cli', activation_surface: 'github_issue_comment',
    authorization: { capabilities: ['read_only', 'modify_files', 'commit', 'push'] }
  });
  assertEqual(result.valid, false);
  assert(result.error.includes('run_tests'));
});

test('F1: @gemini-cli FAILOVER_EXECUTE requires explicit permitted_paths', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@gemini-cli', activation_surface: 'github_issue_comment',
    constraints: { permitted_paths: [] }
  });
  assertEqual(result.valid, false);
  assert(result.error.includes('permitted_paths'));
});

test('F1: @gemini-cli FAILOVER_EXECUTE on unauthorized surface rejected for Gemini target', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@gemini-cli', activation_surface: 'github_push_event'
  });
  assertEqual(result.valid, false);
  assert(result.error.includes('Unauthorized'));
});

test('F1: @gemini-cli FAILOVER_EXECUTE accepts Gemini Builder target', async () => {
  const result = validateACPCompliance({
    ...failoverCommand, target: 'Gemini Builder', task_mode: 'BUILDER',
    activation_syntax: '@gemini-cli', activation_surface: 'workflow_dispatch'
  });
  assertEqual(result.valid, true);
});

test('F1: @kilo FAILOVER_EXECUTE remains accepted (existing behavior preserved)', async () => {
  const result = validateACPCompliance(failoverCommand);
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'FAILOVER_EXECUTE');
});

test('F1: @kilo on GitHub issue comment accepted for Kilo FAILOVER_EXECUTE', async () => {
  const result = validateActivationSurface('github_issue_comment', 'Kilo');
  assertEqual(result.valid, true);
});

test('F1: REVIEW mode does not require activation metadata', async () => {
  const result = validateACPCompliance(validCommand);
  assertEqual(result.valid, true);
});

// === FAILURE 2: Agent-to-evidence-type mapping enforced at addEvidence boundary ===

test('F2: Kilo + AGENT_REPORT accepted by addEvidence', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'AGENT_REPORT', 'Kilo', { status: 'success' }));
  assertEqual(result.success, true);
  cleanup();
});

test('F2: Kilo + INDEPENDENT_VERIFICATION rejected by addEvidence', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Kilo', { status: 'success' }));
  assertEqual(result.success, false);
  assert(result.error.includes('INDEPENDENT_VERIFICATION'));
  cleanup();
});

test('F2: Gemini Builder + AGENT_REPORT accepted by addEvidence', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'AGENT_REPORT', 'Gemini Builder', { status: 'success' }));
  assertEqual(result.success, true);
  cleanup();
});

test('F2: Gemini Builder + INDEPENDENT_VERIFICATION rejected by addEvidence', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini Builder', { status: 'success' }));
  assertEqual(result.success, false);
  assert(result.error.includes('INDEPENDENT_VERIFICATION'));
  cleanup();
});

test('F2: Gemini Reviewer + INDEPENDENT_VERIFICATION accepted by addEvidence (verification path)', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  assertEqual(result.success, true);
  cleanup();
});

test('F2: invalid agent/evidence combinations blocked (WORKFLOW_SUCCESS from Kilo)', async () => {
  await setupTask();
  const result = (await taskRegistry.addEvidence('test-rel-1', 'WORKFLOW_SUCCESS', 'Kilo', { status: 'success' }));
  assertEqual(result.success, false);
  cleanup();
});

test('F2: Kilo self-report (AGENT_REPORT) cannot satisfy EXECUTING->VERIFIED', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'AGENT_REPORT', 'Kilo', { status: 'success' }));
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  assertEqual(result.success, false);
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

test('F2: workflow-success evidence cannot satisfy independent verification', async () => {
  await setupTask();
  const entry = taskRegistry.getTask('test-rel-1');
  const ws = createEvidenceRecord('test-rel-1', 'WORKFLOW_SUCCESS', 'Kilo', { status: 'success' }, entry);
  entry.evidence = entry.evidence || [];
  entry.evidence.push(ws);
  (await taskRegistry.persistCache());
  const result = (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  assertEqual(result.success, false);
  assertEqual(result.missing_evidence, 'INDEPENDENT_VERIFICATION');
  cleanup();
});

// === FAILURE 3: Duplicate active-task / lineage protection ===

test('F3: identical active request_id rejected', async () => {
  await setupTask();
  const result = (await taskRegistry.createTask(validCommand));
  assertEqual(result.success, false);
  assertEqual(result.duplicate, true);
  cleanup();
});

test('F3: child of active parent (distinct request_id) blocked unless supersede-authorized', async () => {
  await setupTask();
  const result = (await taskRegistry.createTask({
    ...validCommand, request_id: 'child-active-parent', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(result.success, false);
  assert(result.error.includes('active'));
  cleanup();
});

test('F3: valid parent/child lineage (child of completed parent) accepted', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  const result = (await taskRegistry.createTask({
    ...validCommand, request_id: 'child-of-complete', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(result.success, true);
  assertEqual(result.entry.parent_request_id, 'test-rel-1');
  cleanup();
});

test('F3: superseded task cannot resume (rehydrate redirects to replacement, original untouched)', async () => {
  await setupTask();
  const sup = (await taskRegistry.supersedeTask('test-rel-1', 'needs re-run'));
  assertEqual(sup.success, true);
  const original = taskRegistry.getTask('test-rel-1');
  const rehydrated = taskRegistry.getTask(sup.new_request_id);
  assertEqual(original.lineage.superseded_by, sup.new_request_id);
  assertEqual(original.status, 'EXECUTING');
  assertEqual(rehydrated.status, 'EXECUTING');
  const attempt = (await taskRegistry.rehydrateTask({ ...validCommand, request_id: 'test-rel-1' }));
  assertEqual(attempt.lineage_current, sup.new_request_id);
  assertEqual(attempt.entry.request_id, sup.new_request_id);
  assertEqual(taskRegistry.getTask('test-rel-1').status, 'EXECUTING');
  cleanup();
});

test('F3: cancelled task cannot resume', async () => {
  await setupTask();
  (await taskRegistry.cancelTask('test-rel-1', 'manual cancel'));
  const result = (await taskRegistry.rehydrateTask({ ...validCommand, request_id: 'test-rel-1' }));
  assertEqual(result.success, false);
  assert(result.error.includes('cancelled'));
  cleanup();
});

test('F3: child of cancelled parent blocked', async () => {
  await setupTask();
  (await taskRegistry.cancelTask('test-rel-1', 'manual cancel'));
  const result = (await taskRegistry.createTask({
    ...validCommand, request_id: 'child-cancelled', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(result.success, false);
  assert(result.error.includes('cancelled'));
  cleanup();
});

test('F3: child of superseded non-replacement task blocked', async () => {
  await setupTask();
  const sup = (await taskRegistry.supersedeTask('test-rel-1', 'needs re-run'));
  const result = (await taskRegistry.createTask({
    ...validCommand, request_id: 'bogus-child', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(result.success, false);
  assert(result.error.includes('superseded'));
  assert(!result.error.includes('designated replacement (' + sup.new_request_id + ') is permitted') || result.error.includes('designated replacement'));
  cleanup();
});

test('F3: conflicting active lineage (second active child) fails closed', async () => {
  await setupTask();
  (await taskRegistry.addEvidence('test-rel-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' }));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'VERIFIED'));
  (await taskRegistry.updateTaskStatus('test-rel-1', 'COMPLETE'));
  const first = (await taskRegistry.createTask({
    ...validCommand, request_id: 'child-a', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(first.success, true);
  const second = (await taskRegistry.createTask({
    ...validCommand, request_id: 'child-b', task_mode: 'FAILOVER_EXECUTE',
    activation_syntax: '@kilo', activation_surface: 'github_issue_comment', parent_request_id: 'test-rel-1'
  }));
  assertEqual(second.success, false);
  assert(second.error.includes('Conflicting active lineage'));
  cleanup();
});

test('F3: lineage remains intact across rehydration', async () => {
  await setupTask();
  const sup = (await taskRegistry.supersedeTask('test-rel-1', 'needs re-run'));
  const attempt = (await taskRegistry.rehydrateTask({ ...validCommand, request_id: 'test-rel-1' }));
  assertEqual(attempt.success, true);
  const replacement = taskRegistry.getTask(sup.new_request_id);
  assertEqual(replacement.parent_request_id, 'test-rel-1');
  cleanup();
});

// === FAILURE 4: Configuration verification — authoritative & fail-closed ===

test('F4: proposed configuration (claim, no authoritative source) is not verified', async () => {
  const r = verifyConfiguration('SOME_TARGET', { claimed: 'production' });
  assertEqual(r.state, 'PROPOSED');
  assertEqual(r.verified, false);
});

test('F4: documented configuration without authoritative evidence is not verified', async () => {
  const r = verifyConfiguration('RENDER_SERVICE_ID', { claimed: 'svc-123', env: {} });
  assert(!['VERIFIED'].includes(r.state));
  assertEqual(r.verified, false);
});

test('F4: agent-claimed configuration is not verified', async () => {
  const r = verifyConfiguration('KILO_TRIGGER_URL', { claimed: 'https://example.com', env: {} });
  assertEqual(r.state, 'PROPOSED');
  assertEqual(r.verified, false);
});

test('F4: authoritative env-existence verification is VERIFIED and never exposes secret value', async () => {
  const ENV_KEY = 'ACP_TEST_ENV_' + Date.now();
  process.env[ENV_KEY] = 'super-secret-value-12345';
  const r = verifyConfiguration(ENV_KEY, {});
  assertEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, true);
  assert(!JSON.stringify(r).includes('super-secret-value-12345'));
  delete process.env[ENV_KEY];
});

test('F4: authoritative task-registry config matches claim -> VERIFIED', async () => {
  await setupTask();
  const entry = taskRegistry.getTask('test-rel-1');
  const r = verifyConfiguration('repository', { claimed: 'fluentwithkyle/openclaw-webhook', task: entry });
  assertEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, true);
  cleanup();
});

test('F4: task-registry config mismatched claim is not verified', async () => {
  await setupTask();
  const entry = taskRegistry.getTask('test-rel-1');
  const r = verifyConfiguration('repository', { claimed: 'other/repo', task: entry });
  assert(!['VERIFIED'].includes(r.state));
  assertEqual(r.verified, false);
  cleanup();
});

test('F4: unavailable authoritative configuration is UNKNOWN', async () => {
  const r = verifyConfiguration('NONEXISTENT_CONFIG_KEY', {});
  assertEqual(r.state, 'UNKNOWN');
  assertEqual(r.verified, false);
});

test('F4: required UNKNOWN configuration is blocked (fail-closed)', async () => {
  await setupTask();
  (await taskRegistry.recordConfigVerification('test-rel-1', 'UNAVAILABLE_PROVIDER',
    verifyConfiguration('UNAVAILABLE_PROVIDER', { claimed: null })));
  const required = taskRegistry.requireConfigVerified('test-rel-1', 'UNAVAILABLE_PROVIDER');
  assertEqual(required.success, false);
  assertEqual(required.config_state, 'UNKNOWN');
  cleanup();
});

test('F4: UNKNOWN/claimed configuration cannot satisfy execution prerequisite', async () => {
  await setupTask();
  (await taskRegistry.recordConfigVerification('test-rel-1', 'PROPOSED_TARGET',
    verifyConfiguration('PROPOSED_TARGET', { claimed: 'docs-only-value' })));
  const required = taskRegistry.requireConfigVerified('test-rel-1', 'PROPOSED_TARGET');
  assertEqual(required.success, false);
  assert(!['VERIFIED'].includes(required.config_state));
  cleanup();
});

test('F4: VERIFIED configuration satisfies execution prerequisite', async () => {
  await setupTask();
  const entry = taskRegistry.getTask('test-rel-1');
  (await taskRegistry.verifyConfig('test-rel-1', 'repository', { claimed: 'fluentwithkyle/openclaw-webhook' }));
  const required = taskRegistry.requireConfigVerified('test-rel-1', 'repository');
  assertEqual(required.success, true);
  assertEqual(required.config_state, 'VERIFIED');
  cleanup();
});

test('F4: config verification records state but never records raw secret values', async () => {
  await setupTask();
  const ENV_KEY = 'ACP_TEST_TOKEN_' + Date.now();
  process.env[ENV_KEY] = 'secret-token-xyz';
  (await taskRegistry.verifyConfig('test-rel-1', ENV_KEY, {}));
  const task = taskRegistry.getTask('test-rel-1');
  const rec = task.config_verification && task.config_verification[ENV_KEY];
  assert(rec);
  assertEqual(rec.state, 'VERIFIED');
  assert(!JSON.stringify(task).includes('secret-token-xyz'));
  delete process.env[ENV_KEY];
  cleanup();
});

testQueue.then(() => {
console.log(`\n=== Reliability Enforcement Tests: ${passCount} passed, ${failCount} failed ===`);
testQueue.then(() => {
if (failCount > 0) process.exit(1);
});
});