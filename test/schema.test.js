const assert = require('assert');
const {
  validateACPCommand,
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  createInitialTaskRegistryEntry,
  VALID_STATE_TRANSITIONS,
  VALID_AGENTS,
  VALID_STATUSES
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
  result: { key: 'value' },
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
  assertEqual(entry.next_action, null);
  assert(entry.created_at);
  assert(entry.updated_at);
});

console.log(`\n=== Schema Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);