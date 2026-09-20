const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const gitWebhook = require('../poc/github-webhook');
const { router: pocRouter } = require('../routes/poc');

const { SIGNAL_PATH_REGEX } = gitWebhook;

const REPO = 'fluentwithkyle/openclaw-webhook';
const BRANCH = 'main';
const REF = 'refs/heads/main';
const COMMIT = 'a'.repeat(40);
const WEBHOOK_SECRET = 'test-webhook-secret';

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL: ' + name + ' - ' + err.message);
  }
}

function makeValidCommand(requestId) {
  return {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'Director',
    target: 'Kilo',
    task_type: 'implementation',
    repository: REPO,
    base_branch: BRANCH,
    task: 'implement git completion signal poc',
    task_mode: 'EXECUTE',
    constraints: { permitted_paths: ['poc/'] },
    authorization: {
      capabilities: ['read_only', 'modify_files', 'commit', 'push']
    },
    verification: 'tests pass; git diff --check clean',
    reporting: 'structured-json',
    originator: 'Kyle'
  };
}

function setupTask(requestId) {
  const command = makeValidCommand(requestId);
  const result = taskRegistry.createTask(command);
  assert.ok(result.success, 'Task creation failed: ' + result.error);

  const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
  for (const status of transitions) {
    const r = taskRegistry.updateTaskStatus(requestId, status);
    assert.ok(r.success, 'Transition to ' + status + ' failed: ' + r.error);
  }
  return command;
}

function makeValidSignal(requestId, commitSha, overrides) {
  const base = {
    signal_id: 'sig-' + requestId + '@' + commitSha.substr(0, 7),
    request_id: requestId,
    agent: 'Kilo',
    status: 'success',
    task: 'implement git completion signal poc',
    changed_files: ['poc/github-webhook.js', 'test/github-webhook.test.js'],
    verification: ['github-webhook tests pass', 'git diff --check clean'],
    repository: REPO,
    base_branch: BRANCH,
    commit_sha: commitSha,
    result: {
      execution_metadata: {
        invocation_id: 'kilo-inv-' + requestId,
        run_id: 'kilo-run-' + requestId
      },
      summary: 'Git completion signal POC implemented successfully'
    },
    commit: commitSha,
    push: true,
    blockers: [],
    timestamp: new Date().toISOString()
  };
  return Object.assign(base, overrides || {});
}

function makePushPayload(requestId, commitSha, overrides) {
  const signalPath = 'poc/signals/' + requestId + '.json';
  const base = {
    ref: REF,
    repository: {
      full_name: REPO,
      name: 'openclaw-webhook',
      owner: { login: 'fluentwithkyle' }
    },
    head_commit: {
      id: commitSha,
      message: 'feat: implement git completion signal poc [request_id: ' + requestId + ']',
      added: [signalPath, 'poc/github-webhook.js'],
      removed: [],
      modified: []
    },
    commits: [
      {
        id: commitSha,
        message: 'feat: implement git completion signal poc [request_id: ' + requestId + ']',
        added: [signalPath, 'poc/github-webhook.js'],
        removed: [],
        modified: []
      }
    ],
    before: 'previous-sha',
    after: commitSha,
    forced: false,
    created: false,
    deleted: false
  };
  return Object.assign(base, overrides || {});
}

function createMockFetcher(signalMap) {
  return async function(commitSha, filePath, token) {
    const requestId = gitWebhook.extractRequestIdFromPath(filePath);
    if (requestId && signalMap[requestId]) {
      return { success: true, signal: signalMap[requestId] };
    }
    return { success: false, error: 'Signal not found for ' + filePath };
  };
}

function signPayload(rawBody, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

const DELIVERY_LOG_PATH = path.join(__dirname, '..', 'poc', 'delivery-log.json');

function setup() {
  taskRegistry.resetRegistry();
  gitWebhook.setFetchSignalArtifact(null);
  gitWebhook.setGithubToken(null);
  try { fs.unlinkSync(DELIVERY_LOG_PATH); } catch (e) {}
  try { fs.unlinkSync(DELIVERY_LOG_PATH + '.bak'); } catch (e) {}
}

function hasRoute(router, routePath) {
  if (!router.stack) {
    return false;
  }
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      return true;
    }
  }
  return false;
}

// ========================================================================
// Synchronous tests
// ========================================================================

test('extractRequestIdFromPath: extracts request_id from signal file path', () => {
  const id = gitWebhook.extractRequestIdFromPath('poc/signals/poc-12345.json');
  assert.strictEqual(id, 'poc-12345');
});

test('extractRequestIdFromPath: returns null for non-signal paths', () => {
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('routes/poc.js'), null);
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('index.js'), null);
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('docs/ai/STATE.md'), null);
});

test('SIGNAL_PATH_REGEX: matches valid signal files', () => {
  assert.ok(SIGNAL_PATH_REGEX.test('poc/signals/poc-12345.json'));
  assert.ok(SIGNAL_PATH_REGEX.test('poc/signals/task-001.json'));
  assert.ok(!SIGNAL_PATH_REGEX.test('poc/signals/task-001.txt'));
  assert.ok(!SIGNAL_PATH_REGEX.test('poc/signals/sub/task-001.json'));
  assert.ok(!SIGNAL_PATH_REGEX.test('docs/ai/KILO_COMPLETION_SIGNAL.json'));
});

test('findSignalFiles: finds signal files in commit added array', () => {
  const commits = [
    {
      id: COMMIT,
      added: ['poc/signals/req-1.json', 'poc/github-webhook.js', 'index.js'],
      removed: [],
      modified: []
    }
  ];
  const signals = gitWebhook.findSignalFiles(commits);
  assert.strictEqual(signals.length, 1);
  assert.strictEqual(signals[0].requestId, 'req-1');
  assert.strictEqual(signals[0].filePath, 'poc/signals/req-1.json');
  assert.strictEqual(signals[0].commitSha, COMMIT);
});

test('findSignalFiles: returns empty for unrelated pushes', () => {
  const commits = [
    {
      id: COMMIT,
      added: ['routes/poc.js', 'index.js'],
      removed: [],
      modified: []
    }
  ];
  const signals = gitWebhook.findSignalFiles(commits);
  assert.strictEqual(signals.length, 0);
});

test('validateSignal: valid signal passes validation', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Valid signal should pass: ' + (result.errors || []).join('; '));
});

test('validateSignal: request_id mismatch is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  signal.request_id = 'wrong-id';
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Request ID mismatch')));
});

test('validateSignal: commit_sha mismatch is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  signal.commit_sha = 'wrong-sha';
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Commit SHA mismatch')));
});

test('validateSignal: absent commit_sha is accepted (self-reference hardening)', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  delete signal.commit_sha;
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Signal without commit_sha should be valid: ' + (result.errors || []).join('; '));
});

test('validateSignal: null commit_sha is accepted (self-reference hardening)', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  signal.commit_sha = null;
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Signal with null commit_sha should be valid: ' + (result.errors || []).join('; '));
});

test('validateSignal: empty commit_sha is accepted (self-reference hardening)', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  signal.commit_sha = '';
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(result.valid, 'Signal with empty commit_sha should be valid: ' + (result.errors || []).join('; '));
});

test('validateSignal: invalid status is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT, { status: 'unknown' });
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Invalid status')));
});

test('validateSignal: missing signal_id is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  delete signal.signal_id;
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('signal_id')));
});

test('validateSignal: repository mismatch is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT, { repository: 'other/repo' });
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Repository mismatch')));
});

test('validateSignal: base_branch mismatch is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT, { base_branch: 'dev' });
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Base branch mismatch')));
});

test('validateSignal: missing result.execution_metadata.invocation_id is rejected', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  delete signal.result.execution_metadata.invocation_id;
  const result = gitWebhook.validateSignal(signal, 'req-1', COMMIT, {
    repository: REPO,
    branch: BRANCH
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('invocation_id')));
});

test('buildCompletionReport: builds valid execution report from signal', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  const report = gitWebhook.buildCompletionReport(signal);
  assert.strictEqual(report.agent, 'Kilo');
  assert.strictEqual(report.request_id, 'req-1');
  assert.strictEqual(report.status, 'success');
  assert.strictEqual(report.commit, COMMIT);
  assert.strictEqual(report.push, true);
  assert.ok(report.result.execution_metadata.invocation_id);
});

test('buildCompletionReport: authoritative headCommitSha is assigned to report', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  delete signal.commit_sha;
  delete signal.commit;
  const authoritativeSha = 'b'.repeat(40);
  const report = gitWebhook.buildCompletionReport(signal, authoritativeSha);
  assert.strictEqual(report.commit_sha, authoritativeSha);
  assert.strictEqual(report.commit, authoritativeSha);
});

test('buildCompletionReport: fallback uses signal commit_sha when no authoritative SHA', () => {
  const signal = makeValidSignal('req-1', COMMIT);
  const report = gitWebhook.buildCompletionReport(signal);
  assert.strictEqual(report.commit_sha, COMMIT);
  assert.strictEqual(report.commit, COMMIT);
});

// --- TEST 2: Signature verification ---
test('verifySignature: valid signature passes', () => {
  const rawBody = Buffer.from(JSON.stringify({ ref: REF, repository: { full_name: REPO } }));
  const signature = signPayload(rawBody, WEBHOOK_SECRET);
  const result = gitWebhook.verifySignature(rawBody, signature, WEBHOOK_SECRET);
  assert.strictEqual(result, true);
});

test('verifySignature: invalid secret fails', () => {
  const rawBody = Buffer.from(JSON.stringify({ test: true }));
  const signature = signPayload(rawBody, WEBHOOK_SECRET);
  const result = gitWebhook.verifySignature(rawBody, signature, 'wrong-secret');
  assert.strictEqual(result, false);
});

test('verifySignature: missing signature fails', () => {
  const result = gitWebhook.verifySignature(Buffer.from('{}'), null, WEBHOOK_SECRET);
  assert.strictEqual(result, false);
});

test('verifySignature: missing secret fails', () => {
  const rawBody = Buffer.from('{}');
  const signature = signPayload(rawBody, 'some-secret');
  const result = gitWebhook.verifySignature(rawBody, signature, null);
  assert.strictEqual(result, false);
});

test('verifySignature: tampered body fails', () => {
  const rawBody = Buffer.from(JSON.stringify({ test: true }));
  const signature = signPayload(rawBody, WEBHOOK_SECRET);
  const tamperedBody = Buffer.from(JSON.stringify({ test: true, injected: 'malicious' }));
  const result = gitWebhook.verifySignature(tamperedBody, signature, WEBHOOK_SECRET);
  assert.strictEqual(result, false);
});

// --- Recursion prevention ---
test('extractRequestIdFromPath: Gemini reconciliation docs are not signal files', () => {
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('docs/ai/STATE.md'), null);
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('docs/ai/TASK_LOG.md'), null);
  assert.strictEqual(gitWebhook.extractRequestIdFromPath('docs/ai/CONTROL_CENTER.md'), null);
  assert.strictEqual(
    gitWebhook.extractRequestIdFromPath('docs/ai/KILO_COMPLETION_SIGNAL.json'),
    null
  );
});

test('handleKiloCompletion: rejects duplicate via orchestrator idempotency', () => {
  setup();
  setupTask('req-dup');
  const signal = makeValidSignal('req-dup', COMMIT);
  const report = gitWebhook.buildCompletionReport(signal);

  const result1 = orchestrator.handleKiloCompletion('req-dup', report);
  assert.ok(result1.success);
  assert.strictEqual(result1.next_action, 'trigger_gemini');

  const result2 = orchestrator.handleKiloCompletion('req-dup', report);
  assert.ok(!result2.success);
  assert.strictEqual(result2.stage, 'idempotency');
  assert.strictEqual(result2.duplicate, true);
});

// --- Existing behavior preservation ---
test('kilo-polling module: still exports expected interface', () => {
  const polling = require('../poc/kilo-polling');
  assert.strictEqual(typeof polling.pollKiloCompletion, 'function');
  assert.strictEqual(typeof polling.processKiloCompletion, 'function');
  assert.strictEqual(typeof polling.startPolling, 'function');
  assert.strictEqual(typeof polling.stopPolling, 'function');
  assert.strictEqual(typeof polling.pollOnce, 'function');
  assert.strictEqual(typeof polling.setProviderClient, 'function');
  assert.strictEqual(typeof polling.setGithubToken, 'function');
});

test('kilo-polling: does not process git-signal tasks (no signal file lookup)', () => {
  const polling = require('../poc/kilo-polling');
  assert.strictEqual(typeof polling.findSignalFiles, 'undefined');
  assert.strictEqual(typeof polling.verifySignature, 'undefined');
  assert.strictEqual(typeof polling.processPushEvent, 'undefined');
});

test('gemini-trigger module: still exports expected interface', () => {
  const trigger = require('../poc/gemini-trigger');
  assert.strictEqual(typeof trigger.dispatchGemini, 'function');
});

test('gitWebhook module: does not export triggerGemini (delegates to orchestrator)', () => {
  assert.strictEqual(typeof gitWebhook.triggerGemini, 'undefined');
});

test('poc.js routes: gemini callback route is still present and unchanged', () => {
  assert.ok(hasRoute(pocRouter, '/gemini/callback'), 'Gemini callback route should be present');
});

test('poc.js routes: kilo callback route is still present and unchanged', () => {
  assert.ok(hasRoute(pocRouter, '/kilo/callback'), 'Kilo callback route should be present');
});

test('poc.js routes: coordinator route is still present and unchanged', () => {
  assert.ok(hasRoute(pocRouter, '/coordinator'), 'Coordinator route should be present');
});

test('poc.js routes: kilo trigger route is still present and unchanged', () => {
  assert.ok(hasRoute(pocRouter, '/kilo'), 'Kilo trigger route should be present');
});

test('poc.js routes: github webhook route is present (new POC endpoint)', () => {
  assert.ok(hasRoute(pocRouter, '/github/webhook'), 'GitHub webhook route should be present');
});

test('delivery log: tracks processed deliveries', () => {
  setup();
  gitWebhook.markDeliveryProcessed('delivery-test-1', 'sig-req-1');
  assert.strictEqual(gitWebhook.hasProcessedDelivery('delivery-test-1'), true);
  assert.strictEqual(gitWebhook.hasProcessedDelivery('delivery-not-processed'), false);
  assert.strictEqual(gitWebhook.hasProcessedDelivery(null), false);
});

test('delivery log: does not track empty delivery IDs', () => {
  setup();
  gitWebhook.markDeliveryProcessed(null, 'sig-1');
  assert.strictEqual(gitWebhook.hasProcessedDelivery(null), false);
});

// ========================================================================
// Async tests — run sequentially
// ========================================================================

async function runAsyncTests() {
  // TEST 3: Wrong repository is rejected
  await testAsync('processPushEvent: wrong repository is rejected', async () => {
    setup();
    const payload = makePushPayload('req-1', COMMIT, {
      repository: { full_name: 'other/repo' }
    });
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.stage, 'repository');
    assert.ok(result.error.includes('Repository mismatch'));
  });

  // TEST 4: Wrong branch/ref is ignored
  await testAsync('processPushEvent: wrong branch ref is ignored', async () => {
    setup();
    const payload = makePushPayload('req-1', COMMIT, { ref: 'refs/heads/dev' });
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'ignored');
  });

  await testAsync('processPushEvent: non-push event is ignored', async () => {
    setup();
    const result = await gitWebhook.processPushEvent(
      { foo: 'bar' },
      'delivery-1',
      { config: { repository: REPO, branch: BRANCH, ref: REF } }
    );
    assert.strictEqual(result.status, 'ignored');
    assert.ok(result.message.includes('Not a push event'));
  });

  // TEST 5: Unrelated push/path is ignored
  await testAsync('processPushEvent: unrelated push with no signal files is ignored', async () => {
    setup();
    const payload = makePushPayload('req-1', COMMIT);
    payload.head_commit.added = ['routes/poc.js', 'index.js'];
    payload.commits[0].added = ['routes/poc.js', 'index.js'];
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'ignored');
    assert.ok(result.message.includes('No Kilo completion signal'));
  });

  // TEST 6: Missing/invalid request_id is rejected
  await testAsync('processPushEvent: signal with mismatched request_id vs filename is rejected', async () => {
    setup();
    setupTask('req-filename');
    const payload = makePushPayload('req-filename', COMMIT);
    const signal = makeValidSignal('different-id', COMMIT, { request_id: 'different-id' });
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-filename': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-mismatch', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.results[0].status, 'rejected');
    assert.strictEqual(result.results[0].stage, 'validation');
  });

  // TEST 7: Unknown request_id is handled safely
  await testAsync('processPushEvent: unknown request_id (not in TaskRegistry) is rejected', async () => {
    setup();
    const payload = makePushPayload('unknown-req', COMMIT);
    const signal = makeValidSignal('unknown-req', COMMIT);
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'unknown-req': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-unknown', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.results[0].status, 'rejected');
    assert.strictEqual(result.results[0].stage, 'registry');
    assert.ok(result.results[0].error.includes('TaskRegistry'));
  });

  // TEST 8: Malformed completion signal is rejected
  await testAsync('processPushEvent: malformed signal (missing status) is rejected', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT);
    delete signal.status;
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.results[0].status, 'rejected');
    assert.strictEqual(result.results[0].stage, 'validation');
  });

  await testAsync('processPushEvent: malformed signal (invalid status value) is rejected', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT, { status: 'completed' });
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.results[0].status, 'rejected');
  });

  await testAsync('processPushEvent: malformed signal (missing signal_id) is rejected', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT);
    delete signal.signal_id;
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.results[0].status, 'rejected');
  });

  await testAsync('processPushEvent: malformed signal (missing result.execution_metadata) is rejected', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT);
    delete signal.result;
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.results[0].status, 'rejected');
  });

  // TEST 9: Duplicate/replayed delivery is idempotent
  await testAsync('processPushEvent: duplicate delivery ID is idempotent', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT);
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));
    const result1 = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result1.status, 'completed');
    assert.strictEqual(result1.results[0].status, 'completed');

    const result2 = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result2.status, 'processed');
    assert.ok(result2.message.includes('already processed'));
  });

  await testAsync('processPushEvent: same request_id re-delivered (new delivery ID) is idempotent via orchestrator', async () => {
    setup();
    setupTask('req-1');
    const payload = makePushPayload('req-1', COMMIT);
    const signal = makeValidSignal('req-1', COMMIT);
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-1': signal }));

    const result1 = await gitWebhook.processPushEvent(payload, 'delivery-1', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result1.results[0].status, 'completed');

    const result2 = await gitWebhook.processPushEvent(payload, 'delivery-2', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result2.results[0].status, 'ignored');
    assert.ok(result2.results[0].message.includes('already recorded'));
  });

  // TEST 10: Concurrent request-specific signals do not overwrite one another
  await testAsync('processPushEvent: concurrent signals for different requests are independent', async () => {
    setup();
    setupTask('req-1');
    setupTask('req-2');

    const commit1 = 'a'.repeat(40);
    const signal1 = makeValidSignal('req-1', commit1);
    const signal2 = makeValidSignal('req-2', commit1);

    const payload = {
      ref: REF,
      repository: { full_name: REPO },
      head_commit: {
        id: commit1,
        message: 'feat: dual completion [request_id: req-1] [request_id: req-2]',
        added: ['poc/signals/req-1.json', 'poc/signals/req-2.json'],
        removed: [],
        modified: []
      },
      commits: [
        {
          id: commit1,
          message: 'feat: dual completion',
          added: ['poc/signals/req-1.json', 'poc/signals/req-2.json'],
          removed: [],
          modified: []
        }
      ]
    };

    gitWebhook.setFetchSignalArtifact(createMockFetcher({
      'req-1': signal1,
      'req-2': signal2
    }));

    const result = await gitWebhook.processPushEvent(payload, 'delivery-concurrent', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.results.length, 2);

    const r1 = result.results.find(r => r.requestId === 'req-1');
    const r2 = result.results.find(r => r.requestId === 'req-2');
    assert.ok(r1, 'req-1 result missing');
    assert.ok(r2, 'req-2 result missing');
    assert.strictEqual(r1.status, 'completed');
    assert.strictEqual(r2.status, 'completed');

    const task1 = taskRegistry.getTask('req-1');
    const task2 = taskRegistry.getTask('req-2');
    assert.strictEqual(task1.kilo.status, 'success');
    assert.strictEqual(task2.kilo.status, 'success');
    assert.strictEqual(task1.kilo.execution_id, 'kilo-inv-req-1');
    assert.strictEqual(task2.kilo.execution_id, 'kilo-inv-req-2');
  });

  // TEST 11: Gemini reconciliation commits cannot be interpreted as Kilo completion
  await testAsync('processPushEvent: Gemini reconciliation commit (no signal file) is ignored', async () => {
    setup();
    const payload = makePushPayload('req-1', COMMIT);
    payload.head_commit.added = ['docs/ai/STATE.md', 'docs/ai/TASK_LOG.md'];
    payload.head_commit.message = 'docs(ai): reconcile STATE.md [request_id: TASK-X]';
    payload.commits[0].added = ['docs/ai/STATE.md', 'docs/ai/TASK_LOG.md'];
    payload.commits[0].message = 'docs(ai): reconcile STATE.md [request_id: TASK-X]';

    const result = await gitWebhook.processPushEvent(payload, 'delivery-gemini', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'ignored');
    assert.ok(result.message.includes('No Kilo completion signal'));
  });

  await testAsync('processPushEvent: Gemini callback file push is ignored (not at poc/signals/)', async () => {
    setup();
    const payload = makePushPayload('req-1', COMMIT);
    payload.head_commit.added = [
      'docs/ai/STATE.md',
      'poc/task-registry.json',
      'poc/verification-result.json'
    ];
    payload.commits[0].added = payload.head_commit.added;

    const result = await gitWebhook.processPushEvent(payload, 'delivery-gemini-2', {
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'ignored');
  });

  // TEST 12b: Valid signal without commit_sha (self-reference-safe) reaches orchestrator
  await testAsync('processPushEvent: signal with no commit_sha (self-reference-safe) completes with head_commit.id', async () => {
    setup();
    setupTask('req-nocommit');
    const payload = makePushPayload('req-nocommit', COMMIT);
    const signal = makeValidSignal('req-nocommit', COMMIT);
    delete signal.commit_sha;
    delete signal.commit;
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-nocommit': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-nocommit', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.results[0].status, 'completed');
    const task = taskRegistry.getTask('req-nocommit');
    assert.strictEqual(task.kilo.status, 'success');
    assert.strictEqual(task.kilo.report.commit, COMMIT);
    assert.strictEqual(task.kilo.report.commit_sha, COMMIT);
  });

  // TEST 12: Valid completion reaches the existing completion/orchestration path
  await testAsync('processPushEvent: valid completion reaches existing orchestrator path', async () => {
    setup();
    setupTask('req-orch');
    const payload = makePushPayload('req-orch', COMMIT);
    const signal = makeValidSignal('req-orch', COMMIT);
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-orch': signal }));

    const result = await gitWebhook.processPushEvent(payload, 'delivery-orch', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.results[0].status, 'completed');

    const task = taskRegistry.getTask('req-orch');
    assert.strictEqual(task.kilo.status, 'success');
    assert.strictEqual(task.status, 'EXECUTING');
    assert.strictEqual(task.next_action, 'trigger_gemini');
    assert.strictEqual(task.kilo.execution_id, 'kilo-inv-req-orch');
    assert.strictEqual(task.kilo.report.commit, COMMIT);
    assert.strictEqual(task.kilo.report.status, 'success');
    assert.strictEqual(task.kilo.report.agent, 'Kilo');
  });

  await testAsync('processPushEvent: failed Kilo completion does not trigger Gemini', async () => {
    setup();
    setupTask('req-fail');
    const payload = makePushPayload('req-fail', COMMIT);
    const signal = makeValidSignal('req-fail', COMMIT, { status: 'failure' });
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-fail': signal }));

    const result = await gitWebhook.processPushEvent(payload, 'delivery-fail', {
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });

    assert.strictEqual(result.results[0].status, 'completed');
    const task = taskRegistry.getTask('req-fail');
    assert.strictEqual(task.kilo.status, 'failure');
    assert.notStrictEqual(task.status, 'EXECUTING');
  });

  // TEST 2 (async): Signature enforcement in processPushEvent
  await testAsync('processPushEvent: invalid signature is rejected (blocked)', async () => {
    setup();
    setupTask('req-sig');
    const payload = makePushPayload('req-sig', COMMIT);
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signPayload(rawBody, 'wrong-secret');
    const result = await gitWebhook.processPushEvent(payload, 'delivery-sig', {
      rawBody: rawBody,
      signature: signature,
      webhookSecret: WEBHOOK_SECRET,
      config: { repository: REPO, branch: BRANCH, ref: REF }
    });
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.stage, 'signature');
  });

  await testAsync('processPushEvent: valid signature passes and continues processing', async () => {
    setup();
    setupTask('req-sig-ok');
    const payload = makePushPayload('req-sig-ok', COMMIT);
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = signPayload(rawBody, WEBHOOK_SECRET);
    const signal = makeValidSignal('req-sig-ok', COMMIT);
    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-sig-ok': signal }));
    const result = await gitWebhook.processPushEvent(payload, 'delivery-sig-ok', {
      rawBody: rawBody,
      signature: signature,
      webhookSecret: WEBHOOK_SECRET,
      config: { repository: REPO, branch: BRANCH, ref: REF },
      githubToken: null
    });
    assert.strictEqual(result.status, 'completed');
  });

  // TEST 14: Existing Kilo → Gemini orchestration remains intact
  await testAsync('gitWebhook module: reuses existing orchestrator.triggerGemini for Gemini dispatch', async () => {
    setup();
    setupTask('req-gemini');
    const payload = makePushPayload('req-gemini', COMMIT);
    const signal = makeValidSignal('req-gemini', COMMIT);

    let dispatched = false;
    const originalTrigger = orchestrator.triggerGemini;
    orchestrator.triggerGemini = async function(requestId, token) {
      dispatched = true;
      return { success: true, message: 'Gemini dispatched' };
    };

    gitWebhook.setFetchSignalArtifact(createMockFetcher({ 'req-gemini': signal }));

    try {
      const result = await gitWebhook.processPushEvent(payload, 'delivery-gemini', {
        config: { repository: REPO, branch: BRANCH, ref: REF },
        githubToken: 'fake-token'
      });
      assert.strictEqual(result.results[0].status, 'completed');
      assert.ok(dispatched, 'Gemini should have been triggered via orchestrator');
    } finally {
      orchestrator.triggerGemini = originalTrigger;
    }
  });
}

setup();

runAsyncTests().then(() => {
  console.log('\n=== GitHub Webhook Tests: ' + passed + ' passed, ' + failed + ' failed ===');
  if (failed > 0) {
    process.exit(1);
  }
}).catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
