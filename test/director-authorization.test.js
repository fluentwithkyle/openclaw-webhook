const assert = require('assert');
const http = require('http');
const express = require('express');
const taskRegistry = require('../poc/task-registry');
const { setDispatcher } = require('../services/transport-provider');

process.env.DIRECTOR_APPROVAL_SECRET = `test-director-${Date.now()}`;
process.env.DEEPSEEK_COORDINATOR_SECRET = `test-coordinator-${Date.now()}`;
const { router } = require('../routes/poc');
const app = express();
app.use(express.json());
app.use('/poc', router);
const server = app.listen(3015);

function request(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3015, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
function scope(cmd) { return { request_id: cmd.request_id, target: cmd.target, task_mode: cmd.task_mode, capabilities: cmd.authorization.capabilities, permitted_paths: cmd.constraints.permitted_paths, repository: cmd.repository, base_branch: cmd.base_branch }; }
function command(requestId) {
  return { protocol_version: '0.1', request_id: requestId, source: 'Director', originator: 'Kyle', target: 'Kilo', task_type: 'implementation', repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task: 'Make the approved change', task_mode: 'BUILDER', constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] }, verification: 'Run tests', reporting: 'json', activation_syntax: '@kilo', activation_surface: 'github_issue_comment' };
}
(async () => {
  try {
    taskRegistry.resetRegistry();
    const cmd = command('director-auth-1');
    let response = await request('/poc/coordinator', { 'x-deepseek-coordinator-secret': process.env.DEEPSEEK_COORDINATOR_SECRET }, cmd);
    assert.equal(response.status, 403);
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
    console.log('PASS: Director authorization issuance, scope binding, expiry, and single-use consumption, cancellation, and supersession revocation');
  } finally { taskRegistry.resetRegistry(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
