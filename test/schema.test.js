const assert = require('assert');
const {
  validateACPCommand,
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  createInitialTaskRegistryEntry,
  VALID_STATE_TRANSITIONS,
  VALID_AGENTS,
  VALID_STATUSES,
  VALID_TASK_MODES,
  BUILDER_CAPABILITIES,
  getRequiredCapabilitiesForMode
} = require('../poc/schemas/acp-schema');

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

function assertArrayIncludes(arr, expected) {
  for (const item of expected) {
    if (!arr.includes(item)) {
      throw new Error(`Expected array to include '${item}'. Array: ${JSON.stringify(arr)}`);
    }
  }
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'test-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only'] },
  verification: 'test',
  reporting: 'json'
};

const validReport = {
  request_id: 'test-1',
  agent: 'Kilo',
  status: 'success',
  task: 'test-task',
  changed_files: ['file1.js'],
  verification: ['test passed'],
  result: { key: 'value', execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
  commit: 'abc123',
  push: true,
  blockers: []
};

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  const result = runTest(name, fn);
  if (result) passCount++; else failCount++;
}

// Schema validation tests
test('Valid ACP command passes validation', () => {
  const result = validateACPCommand(validCommand);
  assertEqual(result.valid, true);
});

test('Missing required field fails validation', () => {
  const cmd = { ...validCommand };
  delete cmd.request_id;
  const result = validateACPCommand(cmd);
  assertEqual(result.valid, false);
  assert(result.error.includes('request_id'));
});

test('Invalid constraints.permitted_paths fails', () => {
  const cmd = { ...validCommand, constraints: { permitted_paths: 'not-array' } };
  const result = validateACPCommand(cmd);
  assertEqual(result.valid, false);
});

test('Invalid authorization.capabilities fails', () => {
  const cmd = { ...validCommand, authorization: { capabilities: 'not-array' } };
  const result = validateACPCommand(cmd);
  assertEqual(result.valid, false);
});

test('Valid execution report passes', () => {
  const result = validateExecutionReport(validReport);
  assertEqual(result.valid, true);
});

test('Missing report field fails', () => {
  const report = { ...validReport };
  delete report.request_id;
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

test('Invalid agent fails', () => {
  const report = { ...validReport, agent: 'Invalid' };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

test('Invalid status fails', () => {
  const report = { ...validReport, status: 'invalid' };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

test('Non-array changed_files fails', () => {
  const report = { ...validReport, changed_files: 'not-array' };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

test('Non-boolean push fails', () => {
  const report = { ...validReport, push: 'yes' };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

test('Null commit is valid', () => {
  const report = { ...validReport, commit: null };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, true);
});

test('Valid report with invocation_id passes', () => {
  const report = {
    ...validReport,
    result: { execution_metadata: { invocation_id: 'inv-123', run_id: 'run-456' } }
  };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, true);
});

test('Missing invocation_id fails', () => {
  const report = {
    ...validReport,
    result: { execution_metadata: { run_id: 'run-456' } }
  };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
  assert(result.error.includes('invocation_id'));
});

test('Missing execution_metadata fails', () => {
  const report = {
    ...validReport,
    result: { key: 'value' }
  };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
  assert(result.error.includes('execution_metadata'));
});

test('invocation_id and run_id are distinct fields', () => {
  const report = {
    request_id: 'test-distinct',
    agent: 'Kilo',
    status: 'success',
    task: 'test',
    changed_files: [],
    verification: [],
    result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
    commit: null,
    push: false,
    blockers: []
  };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, true);
  assertEqual(report.result.execution_metadata.invocation_id, 'inv-1');
  assertEqual(report.result.execution_metadata.run_id, 'run-1');
  if (report.result.execution_metadata.invocation_id === report.result.execution_metadata.run_id) {
    throw new Error('invocation_id and run_id must be distinct');
  }
});

test('Valid task registry entry passes', () => {
  const entry = createInitialTaskRegistryEntry('req-1', validCommand);
  const result = validateTaskRegistryEntry(entry);
  assertEqual(result.valid, true);
});

test('Invalid registry status fails', () => {
  const entry = createInitialTaskRegistryEntry('req-1', validCommand);
  entry.status = 'INVALID';
  const result = validateTaskRegistryEntry(entry);
  assertEqual(result.valid, false);
});

test('State transitions - valid', () => {
  assertEqual(isValidStateTransition('PENDING', 'SELECTED'), true);
  assertEqual(isValidStateTransition('SELECTED', 'PLANNED'), true);
  assertEqual(isValidStateTransition('PLANNED', 'EXECUTING'), true);
  assertEqual(isValidStateTransition('EXECUTING', 'VERIFIED'), true);
  assertEqual(isValidStateTransition('EXECUTING', 'BLOCKED'), true);
  assertEqual(isValidStateTransition('EXECUTING', 'FAILED'), true);
  assertEqual(isValidStateTransition('VERIFIED', 'COMPLETE'), true);
});

test('State transitions - invalid', () => {
  assertEqual(isValidStateTransition('PENDING', 'PLANNED'), false);
  assertEqual(isValidStateTransition('COMPLETE', 'PENDING'), false);
  assertEqual(isValidStateTransition('BLOCKED', 'EXECUTING'), false);
  assertEqual(isValidStateTransition('VERIFIED', 'EXECUTING'), false);
});

test('createInitialTaskRegistryEntry creates correct structure', () => {
  const entry = createInitialTaskRegistryEntry('req-123', validCommand);
  assertEqual(entry.request_id, 'req-123');
  assertEqual(entry.originator, 'Kyle');
  assertEqual(entry.current_agent, 'Kilo');
  assertEqual(entry.next_agent, 'Gemini');
  assertEqual(entry.repository, validCommand.repository);
  assertEqual(entry.base_branch, validCommand.base_branch);
  assertEqual(entry.task, validCommand.task);
  assertEqual(entry.status, 'PENDING');
  assertEqual(entry.kilo.status, 'pending');
  assertEqual(entry.gemini.status, 'pending');
  assertEqual(entry.builder.status, 'pending');
  assertEqual(entry.next_action, null);
  assert(entry.created_at);
  assert(entry.updated_at);
});

test('createInitialTaskRegistryEntry - current_agent reflects command.target for Gemini Builder', () => {
  const builderCommand = { ...validCommand, target: 'Gemini Builder' };
  const entry = createInitialTaskRegistryEntry('req-builder', builderCommand);
  assertEqual(entry.current_agent, 'Gemini Builder');
  assertEqual(entry.next_agent, 'Gemini');
  const result = validateTaskRegistryEntry(entry);
  assertEqual(result.valid, true);
});

test('createInitialTaskRegistryEntry - current_agent reflects command.target for Gemini', () => {
  const geminiCommand = { ...validCommand, target: 'Gemini' };
  const entry = createInitialTaskRegistryEntry('req-gemini', geminiCommand);
  assertEqual(entry.current_agent, 'Gemini');
  assertEqual(entry.next_agent, 'Gemini');
  const result = validateTaskRegistryEntry(entry);
  assertEqual(result.valid, true);
});

test('VALID_AGENTS includes Gemini Builder', () => {
  assert(VALID_AGENTS.includes('Gemini Builder'), 'Gemini Builder should be a valid agent');
  assert(VALID_AGENTS.includes('Kilo'), 'Kilo should remain a valid agent');
  assert(VALID_AGENTS.includes('Gemini'), 'Gemini should remain a valid agent');
});

test('VALID_TASK_MODES includes BUILDER', () => {
  assert(VALID_TASK_MODES.includes('BUILDER'), 'BUILDER should be a valid task mode');
  assert(VALID_TASK_MODES.includes('REVIEW'), 'REVIEW should still be a valid task mode');
  assert(VALID_TASK_MODES.includes('VERIFY_RECONCILE'), 'VERIFY_RECONCILE should still be a valid task mode');
  assert(VALID_TASK_MODES.includes('FAILOVER_EXECUTE'), 'FAILOVER_EXECUTE should still be a valid task mode');
});

test('BUILDER_CAPABILITIES includes all execution capabilities', () => {
  assertArrayIncludes(BUILDER_CAPABILITIES, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
});

test('getRequiredCapabilitiesForMode returns BUILDER_CAPABILITIES for BUILDER mode', () => {
  const caps = getRequiredCapabilitiesForMode('BUILDER');
  assertArrayIncludes(caps, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
});

test('Execution report with agent Gemini Builder is valid', () => {
  const report = {
    ...validReport,
    agent: 'Gemini Builder'
  };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, true);
});

test('Execution report with invalid agent fails', () => {
  const report = { ...validReport, agent: 'Invalid' };
  const result = validateExecutionReport(report);
  assertEqual(result.valid, false);
});

console.log(`\n=== Schema Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);