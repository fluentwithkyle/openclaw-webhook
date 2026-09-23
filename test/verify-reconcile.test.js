const assert = require('assert');
const schema = require('../poc/schemas/acp-schema');
const { validate, execute, normalizePath } = require('../poc/acp-engine');

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL: ${name} - ${err.message}`);
    failCount++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function makeVerifyReconcileCommand(requestId) {
  return {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'CHATGPT',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'verify-and-update-docs',
    task_mode: 'VERIFY_RECONCILE',
    constraints: {
      permitted_paths: [
        'docs/ai/TASK_LOG.md',
        'docs/ai/STATE.md',
        'docs/ai/CONTROL_CENTER.md'
      ]
    },
    authorization: {
      capabilities: ['read_only', 'modify_files', 'commit', 'push']
    },
    verification: 'All tests must pass; changed files are within docs/ai/',
    reporting: 'json',
    originator: 'Kyle'
  };
}

console.log('\n=== Schema: Task Mode Validation ===\n');

runTest('validateTaskMode - valid VERIFY_RECONCILE', () => {
  const result = schema.validateTaskMode('VERIFY_RECONCILE');
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'VERIFY_RECONCILE');
});

runTest('validateTaskMode - valid REVIEW', () => {
  const result = schema.validateTaskMode('REVIEW');
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'REVIEW');
});

runTest('validateTaskMode - valid FAILOVER_EXECUTE', () => {
  const result = schema.validateTaskMode('FAILOVER_EXECUTE');
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'FAILOVER_EXECUTE');
});

runTest('validateTaskMode - invalid mode', () => {
  const result = schema.validateTaskMode('INVALID_MODE');
  assertEqual(result.valid, false);
  assert(result.error.includes('INVALID_MODE'));
});

runTest('validateTaskMode - undefined defaults to REVIEW', () => {
  const result = schema.validateTaskMode(undefined);
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, schema.DEFAULT_TASK_MODE);
});

console.log('\n=== Schema: Capabilities Validation ===\n');

runTest('validateCapabilitiesForMode - REVIEW requires exactly read_only', () => {
  const result = schema.validateCapabilitiesForMode('REVIEW', ['read_only']);
  assertEqual(result.valid, true);
});

runTest('validateCapabilitiesForMode - REVIEW rejects modify_files', () => {
  const result = schema.validateCapabilitiesForMode('REVIEW', ['modify_files']);
  assertEqual(result.valid, false);
});

runTest('validateCapabilitiesForMode - VERIFY_RECONCILE requires all 4 caps', () => {
  const result = schema.validateCapabilitiesForMode('VERIFY_RECONCILE', ['read_only', 'modify_files', 'commit', 'push']);
  assertEqual(result.valid, true);
});

runTest('validateCapabilitiesForMode - VERIFY_RECONCILE rejects missing push', () => {
  const result = schema.validateCapabilitiesForMode('VERIFY_RECONCILE', ['read_only', 'modify_files', 'commit']);
  assertEqual(result.valid, false);
  assert(result.error.includes('push'));
});

runTest('validateCapabilitiesForMode - FAILOVER_EXECUTE requires all 5 caps', () => {
  const result = schema.validateCapabilitiesForMode('FAILOVER_EXECUTE', ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
  assertEqual(result.valid, true);
});

runTest('validateCapabilitiesForMode - FAILOVER_EXECUTE rejects missing run_tests', () => {
  const result = schema.validateCapabilitiesForMode('FAILOVER_EXECUTE', ['read_only', 'modify_files', 'commit', 'push']);
  assertEqual(result.valid, false);
  assert(result.error.includes('run_tests'));
});

runTest('validateCapabilitiesForMode - rejects invalid capability name', () => {
  const result = schema.validateCapabilitiesForMode('VERIFY_RECONCILE', ['read_only', 'modify_files', 'commit', 'push', 'invalid']);
  assertEqual(result.valid, false);
  assert(result.error.includes('Invalid capability'));
});

runTest('validateCapabilitiesForMode - rejects non-array', () => {
  const result = schema.validateCapabilitiesForMode('VERIFY_RECONCILE', 'read_only');
  assertEqual(result.valid, false);
});

console.log('\n=== Schema: Permitted Paths Validation ===\n');

runTest('validatePermittedPathsForMode - VERIFY_RECONCILE accepts docs/ai paths', () => {
  const paths = ['docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md'];
  const result = schema.validatePermittedPathsForMode('VERIFY_RECONCILE', paths);
  assertEqual(result.valid, true);
});

runTest('validatePermittedPathsForMode - VERIFY_RECONCILE rejects index.js', () => {
  const result = schema.validatePermittedPathsForMode('VERIFY_RECONCILE', ['index.js']);
  assertEqual(result.valid, false);
  assert(result.error.includes('Unauthorized path'));
});

runTest('validatePermittedPathsForMode - VERIFY_RECONCILE rejects partial docs paths', () => {
  const result = schema.validatePermittedPathsForMode('VERIFY_RECONCILE', ['docs/ai/TASK_LOG.md', 'index.js']);
  assertEqual(result.valid, false);
});

runTest('validatePermittedPathsForMode - FAILOVER_EXECUTE accepts any explicit path', () => {
  const result = schema.validatePermittedPathsForMode('FAILOVER_EXECUTE', ['index.js']);
  assertEqual(result.valid, true);
});

runTest('validatePermittedPathsForMode - FAILOVER_EXECUTE rejects empty paths', () => {
  const result = schema.validatePermittedPathsForMode('FAILOVER_EXECUTE', []);
  assertEqual(result.valid, false);
});

console.log('\n=== Schema: Full Authorization Validation ===\n');

runTest('validateAuthorization - VERIFY_RECONCILE valid command', () => {
  const cmd = makeVerifyReconcileCommand('auth-1');
  const result = schema.validateAuthorization(cmd);
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'VERIFY_RECONCILE');
});

runTest('validateAuthorization - REVIEW valid command', () => {
  const result = schema.validateAuthorization({
    task_mode: 'REVIEW',
    authorization: { capabilities: ['read_only'] },
    constraints: { permitted_paths: ['poc/'] }
  });
  assertEqual(result.valid, true);
});

runTest('validateAuthorization - VERIFY_RECONCILE missing capabilities', () => {
  const cmd = makeVerifyReconcileCommand('auth-2');
  delete cmd.authorization.capabilities;
  const result = schema.validateAuthorization(cmd);
  assertEqual(result.valid, false);
});

runTest('validateAuthorization - VERIFY_RECONCILE wrong paths', () => {
  const cmd = makeVerifyReconcileCommand('auth-3');
  cmd.constraints.permitted_paths = ['index.js'];
  const result = schema.validateAuthorization(cmd);
  assertEqual(result.valid, false);
});

console.log('\n=== Schema: Reconciliation Validation ===\n');

runTest('validateReconciliation - COMPLETED status valid', () => {
  const result = schema.validateReconciliation({
    status: 'COMPLETED',
    changed_files: ['docs/ai/TASK_LOG.md'],
    commit_sha: 'abc123'
  });
  assertEqual(result.valid, true);
});

runTest('validateReconciliation - SKIPPED status valid', () => {
  const result = schema.validateReconciliation({
    status: 'SKIPPED',
    changed_files: [],
    commit_sha: null
  });
  assertEqual(result.valid, true);
});

runTest('validateReconciliation - FAILED status valid', () => {
  const result = schema.validateReconciliation({
    status: 'FAILED',
    changed_files: [],
    commit_sha: null
  });
  assertEqual(result.valid, true);
});

runTest('validateReconciliation - invalid status', () => {
  const result = schema.validateReconciliation({
    status: 'UNKNOWN',
    changed_files: [],
    commit_sha: null
  });
  assertEqual(result.valid, false);
});

runTest('validateReconciliation - missing status', () => {
  const result = schema.validateReconciliation({
    changed_files: [],
    commit_sha: null
  });
  assertEqual(result.valid, false);
  assert(result.error.includes('status'));
});

runTest('validateReconciliation - changed_files not array', () => {
  const result = schema.validateReconciliation({
    status: 'COMPLETED',
    changed_files: 'not-an-array',
    commit_sha: null
  });
  assertEqual(result.valid, false);
});

runTest('validateReconciliation - commit_sha not string or null', () => {
  const result = schema.validateReconciliation({
    status: 'COMPLETED',
    changed_files: [],
    commit_sha: 12345
  });
  assertEqual(result.valid, false);
});

runTest('validateReconciliation - undefined returns valid (optional)', () => {
  const result = schema.validateReconciliation(undefined);
  assertEqual(result.valid, true);
});

console.log('\n=== Schema: Reconciliation Status Determination ===\n');

runTest('determineReconciliationStatus - success in VERIFY_RECONCILE', () => {
  const result = schema.determineReconciliationStatus('success', 'VERIFY_RECONCILE');
  assertEqual(result.status, 'COMPLETED');
});

runTest('determineReconciliationStatus - success in REVIEW skipped', () => {
  const result = schema.determineReconciliationStatus('success', 'REVIEW');
  assertEqual(result.status, 'SKIPPED');
});

runTest('determineReconciliationStatus - failure in VERIFY_RECONCILE skipped', () => {
  const result = schema.determineReconciliationStatus('failure', 'VERIFY_RECONCILE');
  assertEqual(result.status, 'SKIPPED');
  assert(result.reason.includes('failed'));
});

runTest('determineReconciliationStatus - blocked in VERIFY_RECONCILE skipped', () => {
  const result = schema.determineReconciliationStatus('blocked', 'VERIFY_RECONCILE');
  assertEqual(result.status, 'SKIPPED');
  assert(result.reason.includes('blocked'));
});

runTest('determineReconciliationStatus - PASS is treated as success', () => {
  const result = schema.determineReconciliationStatus('PASS', 'VERIFY_RECONCILE');
  assertEqual(result.status, 'COMPLETED');
});

console.log('\n=== Schema: Execution Report with Reconciliation ===\n');

runTest('validateExecutionReport - accepts reconciliation field', () => {
  const report = {
    request_id: 'report-1',
    agent: 'Gemini',
    status: 'success',
    task: 'verify-task',
    changed_files: ['docs/ai/TASK_LOG.md'],
    verification: ['passed'],
    result: { execution_metadata: { invocation_id: 'inv-1' } },
    commit: 'abc123',
    push: false,
    blockers: [],
    reconciliation: {
      status: 'COMPLETED',
      changed_files: ['docs/ai/TASK_LOG.md'],
      commit_sha: 'def456'
    }
  };
  const result = schema.validateExecutionReport(report);
  assertEqual(result.valid, true);
});

runTest('validateExecutionReport - rejects invalid reconciliation', () => {
  const report = {
    request_id: 'report-2',
    agent: 'Gemini',
    status: 'success',
    task: 'verify-task',
    changed_files: [],
    verification: ['passed'],
    result: { execution_metadata: { invocation_id: 'inv-2' } },
    commit: null,
    push: false,
    blockers: [],
    reconciliation: {
      status: 'INVALID',
      changed_files: [],
      commit_sha: null
    }
  };
  const result = schema.validateExecutionReport(report);
  assertEqual(result.valid, false);
  assert(result.error.includes('reconciliation.status'));
});

runTest('validateExecutionReport - works without reconciliation (backward compat)', () => {
  const report = {
    request_id: 'report-3',
    agent: 'Gemini',
    status: 'success',
    task: 'verify-task',
    changed_files: [],
    verification: ['passed'],
    result: { execution_metadata: { invocation_id: 'inv-3' } },
    commit: null,
    push: false,
    blockers: []
  };
  const result = schema.validateExecutionReport(report);
  assertEqual(result.valid, true);
});

console.log('\n=== Schema: Task Registry Entry with Task Mode ===\n');

runTest('createInitialTaskRegistryEntry - VERIFY_RECONCILE stores mode', () => {
  const cmd = makeVerifyReconcileCommand('reg-1');
  const entry = schema.createInitialTaskRegistryEntry(cmd.request_id, cmd);
  assertEqual(entry.task_mode, 'VERIFY_RECONCILE');
  assertEqual(entry.capabilities[0], 'read_only');
  assertEqual(entry.capabilities[3], 'push');
  assertEqual(entry.permitted_paths.length, 3);
  assertEqual(entry.permitted_paths[0], 'docs/ai/TASK_LOG.md');
});

runTest('createInitialTaskRegistryEntry - REVIEW defaults task_mode', () => {
  const cmd = {
    protocol_version: '0.1',
    request_id: 'reg-2',
    source: 'Q', target: 'K', task_type: 'T',
    repository: 'R', base_branch: 'B', task: 'test',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'V', reporting: 'R'
  };
  const entry = schema.createInitialTaskRegistryEntry(cmd.request_id, cmd);
  assertEqual(entry.task_mode, schema.DEFAULT_TASK_MODE);
  assert.deepStrictEqual(entry.capabilities, ['read_only']);
  assertEqual(entry.permitted_paths[0], 'poc/');
});

runTest('validateTaskRegistryEntry - accepts new fields', () => {
  const cmd = makeVerifyReconcileCommand('reg-3');
  const entry = schema.createInitialTaskRegistryEntry(cmd.request_id, cmd);
  const result = schema.validateTaskRegistryEntry(entry);
  assertEqual(result.valid, true);
});

console.log('\n=== ACP Engine: VERIFY_RECONCILE Mode ===\n');

runTest('ACP Engine - VERIFY_RECONCILE valid command returns SUCCESS', () => {
  const cmd = makeVerifyReconcileCommand('engine-1');
  const result = validate(cmd);
  assertEqual(result.status, 'SUCCESS');
});

runTest('ACP Engine - VERIFY_RECONCILE missing task_mode defaults to REVIEW and fails', () => {
  const cmd = makeVerifyReconcileCommand('engine-2');
  delete cmd.task_mode;
  const result = validate(cmd);
  assertEqual(result.status, 'BLOCKED');
});

runTest('ACP Engine - VERIFY_RECONCILE with read_only only fails', () => {
  const cmd = makeVerifyReconcileCommand('engine-3');
  cmd.authorization.capabilities = ['read_only'];
  const result = validate(cmd);
  assertEqual(result.status, 'BLOCKED');
  assert(result.error.includes('modify_files'));
});

runTest('ACP Engine - VERIFY_RECONCILE with unauthorized path fails', () => {
  const cmd = makeVerifyReconcileCommand('engine-4');
  cmd.constraints.permitted_paths = ['docs/AI_README.md'];
  const result = validate(cmd);
  assertEqual(result.status, 'BLOCKED');
  assert(result.error.includes('Unauthorized path'));
});

runTest('ACP Engine - FAILOVER_EXECUTE valid returns SUCCESS', () => {
  const cmd = makeVerifyReconcileCommand('engine-5');
  cmd.task_mode = 'FAILOVER_EXECUTE';
  cmd.authorization.capabilities = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
  cmd.constraints.permitted_paths = ['index.js', 'utils/helper.js'];
  const result = validate(cmd);
  assertEqual(result.status, 'SUCCESS');
});

runTest('ACP Engine - REVIEW mode still works (backward compat)', () => {
  const cmd = {
    protocol_version: '0.1',
    request_id: 'engine-6',
    source: 'Q', target: 'K', task_type: 'T',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'inspect-poc-files',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'V', reporting: 'json'
  };
  const result = validate(cmd);
  assertEqual(result.status, 'SUCCESS');
});

runTest('ACP Engine - REVIEW rejects modify_files', () => {
  const cmd = {
    protocol_version: '0.1',
    request_id: 'engine-7',
    source: 'Q', target: 'K', task_type: 'T',
    repository: 'R', base_branch: 'B', task: 'test',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only', 'modify_files'] },
    verification: 'V', reporting: 'json',
    task_mode: 'REVIEW'
  };
  const result = validate(cmd);
  assertEqual(result.status, 'BLOCKED');
});

console.log('\n=== Module Constants ===\n');

runTest('VALID_TASK_MODES includes all modes including RESEARCH_DOCUMENT', () => {
  assert(schema.VALID_TASK_MODES.includes('REVIEW'));
  assert(schema.VALID_TASK_MODES.includes('VERIFY_RECONCILE'));
  assert(schema.VALID_TASK_MODES.includes('FAILOVER_EXECUTE'));
  assert(schema.VALID_TASK_MODES.includes('BUILDER'));
  assert(schema.VALID_TASK_MODES.includes('RESEARCH_DOCUMENT'));
  assert(!schema.VALID_TASK_MODES.includes('RESEARCH'), 'RESEARCH must no longer be a valid task mode');
});

runTest('VERIFY_RECONCILE_CAPABILITIES has correct members', () => {
  assertEqual(schema.VERIFY_RECONCILE_CAPABILITIES.length, 4);
  assert(schema.VERIFY_RECONCILE_CAPABILITIES.includes('read_only'));
  assert(schema.VERIFY_RECONCILE_CAPABILITIES.includes('modify_files'));
  assert(schema.VERIFY_RECONCILE_CAPABILITIES.includes('commit'));
  assert(schema.VERIFY_RECONCILE_CAPABILITIES.includes('push'));
  assert(!schema.VERIFY_RECONCILE_CAPABILITIES.includes('run_tests'));
});

runTest('RESEARCH_DOCUMENT_CAPABILITIES has correct members', () => {
  assertEqual(schema.RESEARCH_DOCUMENT_CAPABILITIES.length, 4);
  assert(schema.RESEARCH_DOCUMENT_CAPABILITIES.includes('read_only'));
  assert(schema.RESEARCH_DOCUMENT_CAPABILITIES.includes('modify_files'));
  assert(schema.RESEARCH_DOCUMENT_CAPABILITIES.includes('commit'));
  assert(schema.RESEARCH_DOCUMENT_CAPABILITIES.includes('push'));
  assert(!schema.RESEARCH_DOCUMENT_CAPABILITIES.includes('run_tests'));
});

runTest('RESEARCH_DOCUMENT_PATHS has correct docs and research paths', () => {
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/research/'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/RESEARCH_INDEX.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/TASK_LOG.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/STATE.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/CONTROL_CENTER.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/README.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('docs/ai/ARCH_DECISIONS.md'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('poc/schemas/acp-schema.js'));
  assert(schema.RESEARCH_DOCUMENT_PATHS.includes('test/schema.test.js'));
});

runTest('getRequiredCapabilitiesForMode returns RESEARCH_DOCUMENT_CAPABILITIES', () => {
  assert.deepStrictEqual(schema.getRequiredCapabilitiesForMode('RESEARCH_DOCUMENT'), schema.RESEARCH_DOCUMENT_CAPABILITIES);
});

console.log('\n=== RESEARCH_DOCUMENT Mode Validation ===\n');

runTest('validateTaskMode - RESEARCH_DOCUMENT is valid', () => {
  const result = schema.validateTaskMode('RESEARCH_DOCUMENT');
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'RESEARCH_DOCUMENT');
});

runTest('validateTaskMode - RESEARCH is rejected (removed)', () => {
  const result = schema.validateTaskMode('RESEARCH');
  assertEqual(result.valid, false);
  assert(result.error.includes('RESEARCH'));
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT accepts complete fixed set', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only', 'modify_files', 'commit', 'push']);
  assertEqual(result.valid, true);
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT rejects only read_only', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only']);
  assertEqual(result.valid, false);
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT rejects missing modify_files', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only', 'commit', 'push']);
  assertEqual(result.valid, false);
  assert(result.error.includes('modify_files'));
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT rejects missing commit', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only', 'modify_files', 'push']);
  assertEqual(result.valid, false);
  assert(result.error.includes('commit'));
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT rejects missing push', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only', 'modify_files', 'commit']);
  assertEqual(result.valid, false);
  assert(result.error.includes('push'));
});

runTest('validateCapabilitiesForMode - RESEARCH_DOCUMENT rejects extra capability', () => {
  const result = schema.validateCapabilitiesForMode('RESEARCH_DOCUMENT', ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
  assertEqual(result.valid, false);
});

runTest('validatePermittedPathsForMode - RESEARCH_DOCUMENT accepts docs/ai paths', () => {
  const paths = ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md', 'docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md'];
  const result = schema.validatePermittedPathsForMode('RESEARCH_DOCUMENT', paths);
  assertEqual(result.valid, true);
});

runTest('validatePermittedPathsForMode - RESEARCH_DOCUMENT accepts research subdirectory files', () => {
  const paths = ['docs/ai/research/research-task-001.md'];
  const result = schema.validatePermittedPathsForMode('RESEARCH_DOCUMENT', paths);
  assertEqual(result.valid, true);
});

runTest('validatePermittedPathsForMode - RESEARCH_DOCUMENT accepts schema and test paths', () => {
  const paths = ['poc/schemas/acp-schema.js', 'test/schema.test.js'];
  const result = schema.validatePermittedPathsForMode('RESEARCH_DOCUMENT', paths);
  assertEqual(result.valid, true);
});

runTest('validatePermittedPathsForMode - RESEARCH_DOCUMENT rejects index.js', () => {
  const result = schema.validatePermittedPathsForMode('RESEARCH_DOCUMENT', ['index.js']);
  assertEqual(result.valid, false);
  assert(result.error.includes('Unauthorized path'));
});

runTest('validateAuthorization - RESEARCH_DOCUMENT valid command', () => {
  const result = schema.validateAuthorization({
    task_mode: 'RESEARCH_DOCUMENT',
    authorization: { capabilities: ['read_only', 'modify_files', 'commit', 'push'] },
    constraints: { permitted_paths: ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md'] }
  });
  assertEqual(result.valid, true);
  assertEqual(result.task_mode, 'RESEARCH_DOCUMENT');
});

runTest('validateAuthorization - RESEARCH_DOCUMENT rejects read_only only', () => {
  const result = schema.validateAuthorization({
    task_mode: 'RESEARCH_DOCUMENT',
    authorization: { capabilities: ['read_only'] },
    constraints: { permitted_paths: ['docs/ai/research/'] }
  });
  assertEqual(result.valid, false);
});

console.log(`\n=== Verify Reconcile Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
