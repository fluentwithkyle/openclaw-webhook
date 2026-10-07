const assert = require('assert');
const http = require('http');
const express = require('express');
const taskRegistry = require('../poc/task-registry');
const { setDispatcher } = require('../services/transport-provider');
const { buildControlPlaneCommand } = require('../services/deepseek-runtime');
const geminiBuilderTrigger = require('../poc/gemini-builder-trigger');
const { canonicalExternalActivationIngress } = require('../poc/activation-ingress');
const { buildBuilderActivationPayload, buildActivationPayloadForWorkflowDispatch } = require('../poc/external-activation-validator');

process.env.DIRECTOR_APPROVAL_SECRET = `test-director-${Date.now()}`;
process.env.DEEPSEEK_COORDINATOR_SECRET = `test-coordinator-${Date.now()}`;
process.env.ACP_POC_TRIGGER_SECRET = `test-poc-trigger-${Date.now()}`;
process.env.DIRECTOR_ORIGIN_SECRET = `test-director-origin-${Date.now()}`;
const POC_TRIGGER_SECRET = process.env.ACP_POC_TRIGGER_SECRET;
const DIRECTOR_ORIGIN_SECRET = process.env.DIRECTOR_ORIGIN_SECRET;

const { router } = require('../routes/poc');
const app = express();
app.use(express.json());
app.use('/poc', router);
const server = app.listen(3015);

let passCount = 0;
let failCount = 0;
let pendingAsyncTests = [];

function request(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3015, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
function pocHeaders() { return { 'x-poc-trigger-secret': POC_TRIGGER_SECRET }; }
function directorOriginHeaders() { return { 'x-poc-trigger-secret': POC_TRIGGER_SECRET, 'x-director-origin-secret': DIRECTOR_ORIGIN_SECRET }; }
function scope(cmd) { return { request_id: cmd.request_id, target: cmd.target, task_mode: cmd.task_mode, capabilities: cmd.authorization.capabilities, permitted_paths: cmd.constraints.permitted_paths, repository: cmd.repository, base_branch: cmd.base_branch }; }
function command(requestId) {
  return { protocol_version: '0.1', request_id: requestId, source: 'Director', originator: 'Kyle', target: 'Kilo', task_type: 'implementation', repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task: 'Make the approved change', task_mode: 'BUILDER', constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] }, verification: 'Run tests', reporting: 'json', activation_syntax: '@kilo', activation_surface: 'github_issue_comment' };
}

function runTestAsync(name, fn) {
  const p = fn().then(() => {
    console.log(`PASS: ${name}`);
    passCount++;
  }).catch(err => {
    console.error(`FAIL: ${name} - ${err.message}`);
    failCount++;
  });
  pendingAsyncTests.push(p);
}

(async () => {
  try {
    taskRegistry.resetRegistry();
    const cmd = command('director-auth-1');
    let response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, cmd);
    assert.equal(response.status, 403);
    const serverDerivedBuilder = buildControlPlaneCommand({ operation: 'request_task', objective: 'Implement coordinator contract' });
    assert.equal(serverDerivedBuilder.target, 'Gemini Builder');
    assert.deepEqual(serverDerivedBuilder.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
    assert.deepEqual(serverDerivedBuilder.constraints.permitted_paths, ['poc/']);
    response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, serverDerivedBuilder);
    assert.equal(response.status, 403);
    const serverDerivedApproval = await request('/poc/director/approve', { 'x-director-approval-secret': process.env.DIRECTOR_APPROVAL_SECRET }, { scope: scope(serverDerivedBuilder) });
    serverDerivedBuilder.authorization.approval_id = serverDerivedApproval.body.approval_id;
    const originalBuilderDispatch = geminiBuilderTrigger.dispatchGeminiBuilder;
    process.env.ORCHESTRATOR_GH_TOKEN = 'test-gh-token';
    geminiBuilderTrigger.dispatchGeminiBuilder = async () => ({ success: true, message: 'accepted', status_code: 204 });
    try {
      response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, serverDerivedBuilder);
      assert.equal(response.status, 202);
    } finally {
      geminiBuilderTrigger.dispatchGeminiBuilder = originalBuilderDispatch;
      delete process.env.ORCHESTRATOR_GH_TOKEN;
    }
    response = await request('/poc/director/approve', { 'x-director-approval-secret': 'invalid' }, { scope: scope(cmd) });
    assert.equal(response.status, 401);
    response = await request('/poc/director/approve', { 'x-director-approval-secret': process.env.DIRECTOR_APPROVAL_SECRET }, { scope: scope(cmd) });
    assert.equal(response.status, 201);
    assert(response.body.approval_id);
    const approvalId = response.body.approval_id;
    cmd.authorization.approval_id = approvalId;
    setDispatcher(() => ({ status: 'SUCCESS' }));
    response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, cmd);
    assert.equal(response.status, 202);
    const approval = taskRegistry.createDirectorApproval({ ...scope(cmd), request_id: 'director-auth-expired' }).approval;
    approval.expiry = '2000-01-01T00:00:00.000Z';
    taskRegistry.persistCache();
    const replay = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, cmd);
    assert.equal(replay.status, 403);
    const changed = command('director-auth-2'); changed.authorization.approval_id = approvalId;
    response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, changed);
    assert.equal(response.status, 403);
    const cancelled = command('director-auth-cancelled');
    taskRegistry.createTask({ ...cancelled, task_mode: 'REVIEW', authorization: { capabilities: ['read_only'] } });
    const cancelledApproval = taskRegistry.createDirectorApproval(scope(cancelled)).approval;
    assert.equal(taskRegistry.cancelTask(cancelled.request_id, 'cancelled by Director').success, true);
    assert.equal(taskRegistry.getDirectorApproval(cancelledApproval.approval_id).status, 'REVOKED');
    cancelled.authorization.approval_id = cancelledApproval.approval_id;
    response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, cancelled);
    assert.equal(response.status, 403);

    const superseded = command('director-auth-superseded');
    taskRegistry.createTask({ ...superseded, task_mode: 'REVIEW', authorization: { capabilities: ['read_only'] } });
    const supersededApproval = taskRegistry.createDirectorApproval(scope(superseded)).approval;
    assert.equal(taskRegistry.supersedeTask(superseded.request_id, 'superseded by Director').success, true);
    assert.equal(taskRegistry.getDirectorApproval(supersededApproval.approval_id).status, 'REVOKED');
    superseded.authorization.approval_id = supersededApproval.approval_id;
    response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, superseded);
    assert.equal(response.status, 403);

    const concurrentScope = command('director-auth-3');
    const issued = await request('/poc/director/approve', { 'x-director-approval-secret': process.env.DIRECTOR_APPROVAL_SECRET }, { scope: scope(concurrentScope) });
    concurrentScope.authorization.approval_id = issued.body.approval_id;
    const results = await Promise.all([request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, concurrentScope), request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, concurrentScope)]);
    assert.deepEqual(results.map(r => r.status).sort(), [202, 403]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    taskRegistry.resetRegistry();
  }

  // =========================================================
  // Atomic Server-Side Director Authorization Tests
  // These tests verify the atomic auto-authorization path that
  // eliminates the redundant separate POST /poc/director/approve
  // round-trip for authenticated Director task admission.
  //
  // Trust boundary: director_admission is SERVER-DERIVED from
  // the X-Director-Origin-Secret header — NOT from the request body.
  // =========================================================

  runTestAsync('createTaskWithAutoDirectorAuthorization - atomically creates and consumes approval', async () => {
    taskRegistry.resetRegistry();
    const cmd = command('auto-dir-1');
    const result = await taskRegistry.createTaskWithAutoDirectorAuthorization(cmd);
    assert.equal(result.success, true, 'Should succeed: ' + (result.error || ''));
    assert.equal(result.auto_authorized, true, 'Should be auto-authorized');
    assert.ok(result.approval_id, 'Should have an approval_id');
    assert.ok(result.entry.authorization_proof, 'Should have authorization_proof on entry');
    assert.equal(result.entry.authorization_proof.approval_id, result.approval_id);
    assert.ok(result.entry.authorization_proof.scope_hash, 'Should have scope_hash');
    assert.equal(result.entry.authorization_proof.issuer, 'Kyle (Director)');
    assert.ok(result.entry.authorization_proof.consumed_at, 'Should have consumed_at');
    const approval = taskRegistry.getDirectorApproval(result.approval_id);
    assert.ok(approval, 'Approval should be retrievable');
    assert.equal(approval.status, 'CONSUMED', 'Approval should be consumed (not PENDING)');
  });

  runTestAsync('createTaskWithAutoDirectorAuthorization - non-consequential command does not require approval', async () => {
    taskRegistry.resetRegistry();
    const cmd = command('auto-dir-2');
    cmd.task_mode = 'REVIEW';
    cmd.authorization = { capabilities: ['read_only'] };
    const result = await taskRegistry.createTaskWithAutoDirectorAuthorization(cmd);
    assert.equal(result.success, true, 'Should succeed for non-consequential: ' + (result.error || ''));
    assert.equal(result.auto_authorized, undefined, 'Should not be auto-authorized for non-consequential');
  });

  runTestAsync('createTaskWithAutoDirectorAuthorization - preserves replay/idempotency', async () => {
    taskRegistry.resetRegistry();
    const cmd = command('auto-dir-3');
    const r1 = await taskRegistry.createTaskWithAutoDirectorAuthorization(cmd);
    assert.equal(r1.success, true, 'First should succeed: ' + (r1.error || ''));
    const r2 = await taskRegistry.createTaskWithAutoDirectorAuthorization(cmd);
    assert.equal(r2.success, false, 'Duplicate should fail');
    assert.equal(r2.duplicate, true, 'Should be flagged as duplicate');
  });

  runTestAsync('createTaskWithAutoDirectorAuthorization - scope mismatch fails closed on replay', async () => {
    taskRegistry.resetRegistry();
    const cmd = command('auto-dir-4');
    const r1 = await taskRegistry.createTaskWithAutoDirectorAuthorization(cmd);
    assert.equal(r1.success, true);
    const changed = command('auto-dir-4');
    changed.task = 'completely different task';
    const r2 = await taskRegistry.createTaskWithAutoDirectorAuthorization(changed);
    assert.equal(r2.success, false, 'Changed payload should fail');
    assert.equal(r2.duplicate, true, 'Should be flagged as duplicate on same request_id');
  });

  runTestAsync('Ingress - FAILOVER_EXECUTE with director_admission succeeds without pre-issued approval', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'ingress-auto-auth-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const result = await canonicalExternalActivationIngress(payload, { director_admission: true });
    assert.equal(result.success, true, 'Should succeed with director_admission: ' + (result.error || ''));
    assert.ok(result.task_entry.authorization_proof, 'Should have authorization_proof');
    assert.ok(result.task_entry.authorization_proof.approval_id, 'Should have approval_id in proof');
    const task = taskRegistry.getTask('ingress-auto-auth-1');
    assert.ok(task, 'Task should exist in registry');
    const approval = taskRegistry.getDirectorApproval(task.authorization_proof.approval_id);
    assert.ok(approval, 'Approval should exist');
    assert.equal(approval.status, 'CONSUMED', 'Approval should be consumed atomically');
  });

  runTestAsync('Ingress - BUILDER with director_admission succeeds without pre-issued approval', async () => {
    taskRegistry.resetRegistry();
    const payload = buildBuilderActivationPayload({
      request_id: 'ingress-auto-auth-2',
      task: 'implement feature X',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'BUILDER',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/'
    });
    const result = await canonicalExternalActivationIngress(payload, { director_admission: true, carrier_identity: 'github-workflow-auto-1', carrier_type: 'github_workflow' });
    assert.equal(result.success, true, 'Should succeed with director_admission: ' + (result.error || ''));
    assert.ok(result.execution_descriptor, 'Should have execution descriptor');
    assert.ok(result.task_entry.authorization_proof, 'Should have authorization_proof');
    const approval = taskRegistry.getDirectorApproval(result.task_entry.authorization_proof.approval_id);
    assert.ok(approval, 'Approval should exist');
    assert.equal(approval.status, 'CONSUMED', 'Approval should be consumed atomically');
  });

  runTestAsync('Ingress - consequential without director_admission or director_approval_id fails closed', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'ingress-no-auth-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const result = await canonicalExternalActivationIngress(payload, {});
    assert.equal(result.success, false, 'Should fail closed without Director authorization');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
  });

  runTestAsync('Ingress - pre-issued director_approval_id still works (backward compatible)', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'ingress-backward-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const approval = await taskRegistry.createDirectorApproval({
      request_id: 'ingress-backward-1', target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], permitted_paths: ['poc/'],
      repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main'
    });
    assert.ok(approval.success, 'Pre-issued approval should succeed');
    payload.authorization.approval_id = approval.approval.approval_id;
    const result = await canonicalExternalActivationIngress(payload, { director_approval_id: approval.approval.approval_id });
    assert.equal(result.success, true, 'Should succeed with pre-issued approval: ' + (result.error || ''));
    const consumedApproval = taskRegistry.getDirectorApproval(approval.approval.approval_id);
    assert.equal(consumedApproval.status, 'CONSUMED', 'Pre-issued approval should be consumed');
  });

  runTestAsync('Ingress - director_admission produces authorization_proof with required provenance fields', async () => {
    taskRegistry.resetRegistry();
    const payload = buildBuilderActivationPayload({
      request_id: 'ingress-proof-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'BUILDER',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/'
    });
    const result = await canonicalExternalActivationIngress(payload, { director_admission: true });
    assert.equal(result.success, true);
    const proof = result.task_entry.authorization_proof;
    assert.ok(proof.approval_id, 'Must have approval_id');
    assert.ok(proof.scope_hash, 'Must have scope_hash');
    assert.equal(proof.issuer, 'Kyle (Director)', 'Must have issuer');
    assert.ok(proof.consumed_at, 'Must have consumed_at');
  });

  // =========================================================
  // Route-level trust boundary tests
  // These verify that the /activation/ingress route handler
  // does NOT trust client-supplied director_admission and
  // requires a valid X-Director-Origin-Secret header.
  // =========================================================

  runTestAsync('Route - consequential FAILOVER_EXECUTE succeeds with valid Director-origin secret header', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-dir-authed-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const response = await request('/poc/activation/ingress', directorOriginHeaders(), payload);
    assert.equal(response.status, 202, 'Should succeed: ' + (response.body.error || ''));
    const task = taskRegistry.getTask('route-dir-authed-1');
    assert.ok(task, 'Task should exist');
    assert.ok(task.authorization_proof, 'Should have authorization_proof');
    assert.equal(task.authorization_proof.issuer, 'Kyle (Director)');
    const approval = taskRegistry.getDirectorApproval(task.authorization_proof.approval_id);
    assert.equal(approval.status, 'CONSUMED', 'Approval should be consumed atomically');
  });

  runTestAsync('Route - generic POC secret alone (without Director-origin secret) fails closed for FAILOVER_EXECUTE', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-no-dir-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const response = await request('/poc/activation/ingress', pocHeaders(), payload);
    assert.equal(response.status, 403, 'Should fail closed without Director-origin secret');
    assert.equal(response.body.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
  });

  runTestAsync('Route - client-supplied director_admission in body is ignored', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-body-injection-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    payload.director_admission = true;
    payload.authorization.director_admission = true;
    const response = await request('/poc/activation/ingress', pocHeaders(), payload);
    assert.equal(response.status, 403, 'Client-supplied director_admission must be ignored');
    assert.equal(response.body.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
  });

  runTestAsync('Route - BUILDER fails closed without Director-origin secret', async () => {
    taskRegistry.resetRegistry();
    const payload = buildBuilderActivationPayload({
      request_id: 'route-no-dir-builder-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'BUILDER',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/'
    });
    const response = await request('/poc/activation/ingress', pocHeaders(), payload);
    assert.equal(response.status, 403, 'BUILDER should fail without Director-origin secret');
    assert.equal(response.body.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
  });

  runTestAsync('Route - BUILDER succeeds with Director-origin secret header', async () => {
    taskRegistry.resetRegistry();
    const payload = buildBuilderActivationPayload({
      request_id: 'route-dir-builder-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'BUILDER',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/'
    });
    const response = await request('/poc/activation/ingress', directorOriginHeaders(), payload);
    assert.equal(response.status, 202, 'BUILDER should succeed with Director-origin secret: ' + (response.body.error || ''));
    const task = taskRegistry.getTask('route-dir-builder-1');
    assert.ok(task.authorization_proof, 'Should have authorization_proof');
    assert.equal(task.authorization_proof.issuer, 'Kyle (Director)');
  });

  runTestAsync('Route - invalid Director-origin secret fails closed', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-bad-secret-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const response = await request('/poc/activation/ingress', { 'x-poc-trigger-secret': POC_TRIGGER_SECRET, 'x-director-origin-secret': 'wrong-secret' }, payload);
    assert.equal(response.status, 403, 'Invalid Director-origin secret should fail closed');
    assert.equal(response.body.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
  });

  runTestAsync('Route - REVIEW mode succeeds without Director-origin secret (non-consequential)', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-review-1',
      task: 'review this code',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'REVIEW',
      capabilities: 'read_only',
      permitted_paths: 'poc/',
      verification: 'none'
    });
    const response = await request('/poc/activation/ingress', pocHeaders(), payload);
    assert.equal(response.status, 202, 'REVIEW should succeed without Director-origin secret');
  });

  runTestAsync('Route - pre-issued approval_id works without Director-origin secret', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-preissued-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const approval = await taskRegistry.createDirectorApproval({
      request_id: 'route-preissued-1', target: 'Gemini', task_mode: 'FAILOVER_EXECUTE',
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], permitted_paths: ['poc/'],
      repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main'
    });
    assert.ok(approval.success, 'Pre-issued approval should succeed');
    payload.authorization.approval_id = approval.approval.approval_id;
    const response = await request('/poc/activation/ingress', pocHeaders(), payload);
    assert.equal(response.status, 202, 'Pre-issued approval should work without Director-origin secret');
    const task = taskRegistry.getTask('route-preissued-1');
    assert.ok(task.authorization_proof, 'Should have authorization_proof');
    assert.equal(task.authorization_proof.approval_id, approval.approval.approval_id);
    const consumed = taskRegistry.getDirectorApproval(approval.approval.approval_id);
    assert.equal(consumed.status, 'CONSUMED');
  });

  runTestAsync('Route - atomic auto-authorization preserves replay/idempotency', async () => {
    taskRegistry.resetRegistry();
    const payload = buildActivationPayloadForWorkflowDispatch({
      request_id: 'route-replay-1',
      task: 'implement feature',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: 'read_only,modify_files,run_tests,commit,push',
      permitted_paths: 'poc/',
      verification: 'tests must pass'
    });
    const response1 = await request('/poc/activation/ingress', directorOriginHeaders(), payload);
    assert.equal(response1.status, 202, 'First request should succeed');
    const response2 = await request('/poc/activation/ingress', directorOriginHeaders(), payload);
    assert.equal(response2.status, 200, 'Replay should return 200 (matched existing)');
    assert.equal(response2.body.replay, true, 'Should be flagged as replay');
  });

  runTestAsync('Manual Builder director_origin_assertion without DIRECTOR_ORIGIN_SECRET cannot establish authorization', async () => {
    const { generateDirectorOriginAssertion, verifyDirectorOriginAssertion } = require('../poc/external-activation-validator');

    const forgedAssertion = generateDirectorOriginAssertion('attacker-request', null, 'guessed-secret');
    assert(forgedAssertion, 'Forged assertion should be generated (but will fail verification)');

    const verified = verifyDirectorOriginAssertion(forgedAssertion, 'attacker-request', DIRECTOR_ORIGIN_SECRET);
    assert.equal(verified, false,
      'Forged assertion using guessed secret must fail verification against real DIRECTOR_ORIGIN_SECRET');

    const decoded = Buffer.from(forgedAssertion, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    assert.notEqual(parsed.token, DIRECTOR_ORIGIN_SECRET,
      'Assertion token must not contain the raw DIRECTOR_ORIGIN_SECRET');
  });

  runTestAsync('Server-generated Builder assertion with correct request_id establishes authorization', async () => {
    const { generateDirectorOriginAssertion, verifyDirectorOriginAssertion } = require('../poc/external-activation-validator');

    const validRequestId = 'server-generated-request';
    const executionClaimId = 'claim-123';
    const validAssertion = generateDirectorOriginAssertion(validRequestId, executionClaimId, DIRECTOR_ORIGIN_SECRET);

    const verified = verifyDirectorOriginAssertion(validAssertion, validRequestId, DIRECTOR_ORIGIN_SECRET);
    assert.equal(verified, true,
      'Valid server-generated assertion should verify against real DIRECTOR_ORIGIN_SECRET');
  });

  await Promise.all(pendingAsyncTests);
  console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
  server.close();
})();
