const assert = require('assert');
const fs = require('fs');
const path = require('path');
const signalEmitter = require('../poc/signal-emitter');
const gitWebhook = require('../poc/github-webhook');
const { validateExecutionReport } = require('../poc/schemas/acp-schema');

const REPO = 'fluentwithkyle/openclaw-webhook';
const BRANCH = 'main';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL: ' + name + ' - ' + err.message);
  }
}

const SIGNAL_DIR = path.join(__dirname, '..', 'poc', 'signals');

function cleanupSignal(requestId) {
  const filePath = path.join(SIGNAL_DIR, requestId + '.json');
  try { fs.unlinkSync(filePath); } catch (e) {}
}

function makeCompletionData(overrides) {
  return Object.assign({
    status: 'success',
    task: 'Implement Kilo completion-signal emitter',
    changed_files: ['poc/signal-emitter.js', 'test/signal-emitter.test.js'],
    verification: ['signal-emitter tests pass', 'git diff --check clean'],
    blockers: [],
    push: true,
    invocation_id: 'kilo-inv-test-001',
    summary: 'Kilo completion-signal emitter implemented and verified'
  }, overrides || {});
}

// ========================================================================
// buildSignal tests
// ========================================================================

test('buildSignal: success signal passes validateSignal() contract', () => {
  const signal = signalEmitter.buildSignal('test-success', makeCompletionData({ status: 'success' }));
  const result = gitWebhook.validateSignal(signal, 'test-success', null, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Success signal should pass validateSignal: ' + (result.errors || []).join('; '));
});

test('buildSignal: failure signal passes validateSignal() contract', () => {
  const signal = signalEmitter.buildSignal('test-failure', makeCompletionData({
    status: 'failure',
    blockers: ['Test failure condition'],
    push: false
  }));
  const result = gitWebhook.validateSignal(signal, 'test-failure', null, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Failure signal should pass validateSignal: ' + (result.errors || []).join('; '));
});

test('buildSignal: blocked signal passes validateSignal() contract', () => {
  const signal = signalEmitter.buildSignal('test-blocked', makeCompletionData({
    status: 'blocked',
    blockers: ['Missing authorization'],
    push: false
  }));
  const result = gitWebhook.validateSignal(signal, 'test-blocked', null, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Blocked signal should pass validateSignal: ' + (result.errors || []).join('; '));
});

test('buildSignal: sets agent to Kilo', () => {
  const signal = signalEmitter.buildSignal('test-agent', makeCompletionData());
  assert.strictEqual(signal.agent, 'Kilo');
});

test('buildSignal: sets request_id from argument', () => {
  const signal = signalEmitter.buildSignal('test-request-id', makeCompletionData());
  assert.strictEqual(signal.request_id, 'test-request-id');
});

test('buildSignal: commit_sha is null at emission time (authoritative SHA assigned by consumer)', () => {
  const signal = signalEmitter.buildSignal('test-commit', makeCompletionData());
  assert.strictEqual(signal.commit_sha, null);
  assert.strictEqual(signal.commit, null);
});

test('buildSignal: status is set from completionData', () => {
  const signal = signalEmitter.buildSignal('test-status', makeCompletionData({ status: 'blocked' }));
  assert.strictEqual(signal.status, 'blocked');
});

test('buildSignal: includes invocation_id in result.execution_metadata', () => {
  const signal = signalEmitter.buildSignal('test-inv', makeCompletionData({ invocation_id: 'kilo-inv-custom' }));
  assert.strictEqual(signal.result.execution_metadata.invocation_id, 'kilo-inv-custom');
});

test('buildSignal: invocation_id defaults to kilo-inv-<requestId>', () => {
  const signal = signalEmitter.buildSignal('test-inv-default', makeCompletionData({ invocation_id: undefined }));
  assert.strictEqual(signal.result.execution_metadata.invocation_id, 'kilo-inv-test-inv-default');
});

test('buildSignal: changed_files is an array', () => {
  const signal = signalEmitter.buildSignal('test-files', makeCompletionData());
  assert.ok(Array.isArray(signal.changed_files));
  assert.ok(signal.changed_files.includes('poc/signal-emitter.js'));
});

test('buildSignal: verification is an array', () => {
  const signal = signalEmitter.buildSignal('test-verify', makeCompletionData());
  assert.ok(Array.isArray(signal.verification));
  assert.ok(signal.verification.length > 0);
});

test('buildSignal: blockers is an array', () => {
  const signal = signalEmitter.buildSignal('test-blockers', makeCompletionData());
  assert.ok(Array.isArray(signal.blockers));
});

test('buildSignal: push is boolean', () => {
  const signal = signalEmitter.buildSignal('test-push', makeCompletionData({ push: true }));
  assert.strictEqual(typeof signal.push, 'boolean');
  assert.strictEqual(signal.push, true);
});

test('buildSignal: push defaults to false when not provided', () => {
  const signal = signalEmitter.buildSignal('test-push-default', makeCompletionData({ push: undefined }));
  assert.strictEqual(signal.push, false);
});

test('buildSignal: repository and base_branch use defaults', () => {
  const signal = signalEmitter.buildSignal('test-repo', makeCompletionData());
  assert.strictEqual(signal.repository, REPO);
  assert.strictEqual(signal.base_branch, BRANCH);
});

test('buildSignal: signal_id is unique (contains request_id and timestamp)', () => {
  const signal1 = signalEmitter.buildSignal('test-uniq', makeCompletionData());
  const signal2 = signalEmitter.buildSignal('test-uniq', makeCompletionData());
  assert.notStrictEqual(signal1.signal_id, signal2.signal_id);
  assert.ok(signal1.signal_id.includes('test-uniq'));
  assert.ok(signal2.signal_id.includes('test-uniq'));
});

test('buildSignal: includes timestamp', () => {
  const signal = signalEmitter.buildSignal('test-timestamp', makeCompletionData());
  assert.ok(signal.timestamp);
  assert.strictEqual(typeof signal.timestamp, 'string');
});

test('buildSignal: includes run_id when provided', () => {
  const signal = signalEmitter.buildSignal('test-runid', makeCompletionData({ run_id: 'run-abc-123' }));
  assert.strictEqual(signal.result.execution_metadata.run_id, 'run-abc-123');
});

test('buildSignal: omits run_id when not provided', () => {
  const signal = signalEmitter.buildSignal('test-runid-none', makeCompletionData({ run_id: undefined }));
  assert.strictEqual(signal.result.execution_metadata.run_id, undefined);
});

test('buildSignal: empty changed_files defaults to empty array', () => {
  const signal = signalEmitter.buildSignal('test-empty', makeCompletionData({ changed_files: undefined }));
  assert.ok(Array.isArray(signal.changed_files));
  assert.strictEqual(signal.changed_files.length, 0);
});

test('buildSignal: empty verification defaults to empty array', () => {
  const signal = signalEmitter.buildSignal('test-empty-verify', makeCompletionData({ verification: undefined }));
  assert.ok(Array.isArray(signal.verification));
  assert.strictEqual(signal.verification.length, 0);
});

test('buildSignal: empty blockers defaults to empty array', () => {
  const signal = signalEmitter.buildSignal('test-empty-blockers', makeCompletionData({ blockers: undefined }));
  assert.ok(Array.isArray(signal.blockers));
  assert.strictEqual(signal.blockers.length, 0);
});

// ========================================================================
// validateSignalConformance tests
// ========================================================================

test('validateSignalConformance: valid success signal passes', () => {
  const signal = signalEmitter.buildSignal('test-conform-success', makeCompletionData());
  const result = signalEmitter.validateSignalConformance(signal, 'test-conform-success');
  assert.ok(result.valid);
});

test('validateSignalConformance: valid failure signal passes', () => {
  const signal = signalEmitter.buildSignal('test-conform-fail', makeCompletionData({ status: 'failure' }));
  const result = signalEmitter.validateSignalConformance(signal, 'test-conform-fail');
  assert.ok(result.valid);
});

test('validateSignalConformance: valid blocked signal passes', () => {
  const signal = signalEmitter.buildSignal('test-conform-blocked', makeCompletionData({ status: 'blocked' }));
  const result = signalEmitter.validateSignalConformance(signal, 'test-conform-blocked');
  assert.ok(result.valid);
});

test('validateSignalConformance: mismatched request_id fails', () => {
  const signal = signalEmitter.buildSignal('test-conform-mismatch', makeCompletionData());
  const result = signalEmitter.validateSignalConformance(signal, 'wrong-id');
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Request ID mismatch')));
});

// ========================================================================
// emitCompletionSignal tests
// ========================================================================

test('emitCompletionSignal: writes valid signal file to correct path', () => {
  const requestId = 'test-emit-success';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());

  assert.ok(result.success, 'Emit should succeed: ' + (result.error || ''));
  assert.ok(fs.existsSync(result.filePath), 'Signal file should exist at ' + result.filePath);

  const expectedPath = path.join(SIGNAL_DIR, requestId + '.json');
  assert.strictEqual(result.filePath, expectedPath);

  const written = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  assert.strictEqual(written.request_id, requestId);
  assert.strictEqual(written.status, 'success');
  assert.strictEqual(written.agent, 'Kilo');
  assert.ok(written.result.execution_metadata.invocation_id);

  cleanupSignal(requestId);
});

test('emitCompletionSignal: emitted file passes validateSignal()', () => {
  const requestId = 'test-emit-validate';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result.success);

  const signal = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  const validation = gitWebhook.validateSignal(signal, requestId, null, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(validation.valid, 'Emitted signal should pass validateSignal: ' + (validation.errors || []).join('; '));

  cleanupSignal(requestId);
});

test('emitCompletionSignal: emitted file passes validateExecutionReport()', () => {
  const requestId = 'test-emit-report';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result.success);

  const signal = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  const validation = validateExecutionReport(signal);
  assert.ok(validation.valid, 'Emitted signal should pass validateExecutionReport: ' + (validation.error || ''));

  cleanupSignal(requestId);
});

test('emitCompletionSignal: failure state writes valid file', () => {
  const requestId = 'test-emit-failure';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData({
    status: 'failure',
    blockers: ['Implementation error'],
    push: false
  }));
  assert.ok(result.success);

  const signal = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  assert.strictEqual(signal.status, 'failure');
  assert.strictEqual(signal.push, false);
  assert.ok(signal.blockers.includes('Implementation error'));

  cleanupSignal(requestId);
});

test('emitCompletionSignal: blocked state writes valid file', () => {
  const requestId = 'test-emit-blocked';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData({
    status: 'blocked',
    blockers: ['Authorization missing'],
    push: false
  }));
  assert.ok(result.success);

  const signal = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  assert.strictEqual(signal.status, 'blocked');
  assert.strictEqual(signal.push, false);

  cleanupSignal(requestId);
});

test('emitCompletionSignal: builds completion report via buildCompletionReport after emission', () => {
  const requestId = 'test-emit-report-build';
  const commitSha = 'a'.repeat(40);
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result.success);

  const signal = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  const report = gitWebhook.buildCompletionReport(signal, commitSha);

  assert.strictEqual(report.agent, 'Kilo');
  assert.strictEqual(report.commit_sha, commitSha);
  assert.strictEqual(report.commit, commitSha);
  assert.strictEqual(report.push, true);
  assert.ok(report.result.execution_metadata.invocation_id);

  const execValidation = validateExecutionReport(report);
  assert.ok(execValidation.valid, 'Built completion report should pass schema: ' + (execValidation.error || ''));

  cleanupSignal(requestId);
});

// ========================================================================
// Duplicate / conflict prevention tests
// ========================================================================

test('emitCompletionSignal: rejects duplicate signal (same request_id, same status)', () => {
  const requestId = 'test-dup-signal';
  cleanupSignal(requestId);

  const result1 = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result1.success);

  const result2 = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(!result2.success);
  assert.strictEqual(result2.stage, 'duplicate');

  cleanupSignal(requestId);
});

test('emitCompletionSignal: rejects conflicting signal (same request_id, different status)', () => {
  const requestId = 'test-conflict-signal';
  cleanupSignal(requestId);

  const result1 = signalEmitter.emitCompletionSignal(requestId, makeCompletionData({ status: 'success' }));
  assert.ok(result1.success);

  const result2 = signalEmitter.emitCompletionSignal(requestId, makeCompletionData({ status: 'failure' }));
  assert.ok(!result2.success);
  assert.strictEqual(result2.stage, 'conflict');
  assert.ok(result2.error.includes('Conflicting signal'));

  cleanupSignal(requestId);
});

test('hasExistingSignal: returns true after signal emitted', () => {
  const requestId = 'test-has-existing';
  cleanupSignal(requestId);

  assert.strictEqual(signalEmitter.hasExistingSignal(requestId), false);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result.success);
  assert.strictEqual(signalEmitter.hasExistingSignal(requestId), true);

  cleanupSignal(requestId);
  assert.strictEqual(signalEmitter.hasExistingSignal(requestId), false);
});

test('checkForConflict: no conflict when signal file does not exist', () => {
  const requestId = 'test-no-conflict';
  cleanupSignal(requestId);

  const result = signalEmitter.checkForConflict(requestId, 'success');
  assert.strictEqual(result.conflict, false);
});

test('checkForConflict: conflict when existing signal has different status', () => {
  const requestId = 'test-conflict-check';
  cleanupSignal(requestId);

  signalEmitter.emitCompletionSignal(requestId, makeCompletionData({ status: 'success' }));
  const result = signalEmitter.checkForConflict(requestId, 'failure');
  assert.strictEqual(result.conflict, true);
  assert.strictEqual(result.existingStatus, 'success');

  cleanupSignal(requestId);
});

// ========================================================================
// getSignalFilePath tests
// ========================================================================

test('getSignalFilePath: returns correct path for request_id', () => {
  const filePath = signalEmitter.getSignalFilePath('my-request-id');
  const expected = path.join(SIGNAL_DIR, 'my-request-id.json');
  assert.strictEqual(filePath, expected);
});

test('getSignalFilePath: path matches SIGNAL_PATH_REGEX used by consumer', () => {
  const filePath = signalEmitter.getSignalFilePath('my-request-id');
  assert.ok(gitWebhook.SIGNAL_PATH_REGEX.test('poc/signals/my-request-id.json'));
});

// ========================================================================
// End-to-end: emitted signal integrates with consumer pipeline
// ========================================================================

test('end-to-end: emitted signal is detectable by findSignalFiles in push payload', () => {
  const requestId = 'test-e2e-detect';
  cleanupSignal(requestId);

  const result = signalEmitter.emitCompletionSignal(requestId, makeCompletionData());
  assert.ok(result.success);

  const commitSha = 'b'.repeat(40);
  const filePath = 'poc/signals/' + requestId + '.json';
  const commits = [{
    id: commitSha,
    added: [filePath],
    removed: [],
    modified: []
  }];

  const signalFiles = gitWebhook.findSignalFiles(commits);
  assert.strictEqual(signalFiles.length, 1);
  assert.strictEqual(signalFiles[0].requestId, requestId);
  assert.strictEqual(signalFiles[0].filePath, filePath);

  cleanupSignal(requestId);
});

// ========================================================================
// Run tests
// ========================================================================

console.log('\n=== Signal Emitter Tests ===\n');

// Sync tests already ran above via test() calls
// Run async cleanup verification
const leftoverFiles = fs.readdirSync(SIGNAL_DIR)
  .filter(f => f.startsWith('test-') && f.endsWith('.json'));

if (leftoverFiles.length > 0) {
  console.error('FAIL: Leftover test signal files: ' + leftoverFiles.join(', '));
  process.exit(1);
} else {
  console.log('PASS: No leftover test signal files');
  passed++;
}

console.log('\n=== Signal Emitter Tests: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) {
  process.exit(1);
}
