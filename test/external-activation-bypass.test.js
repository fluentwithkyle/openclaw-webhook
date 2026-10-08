const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload,
    ACTIVATION_INGRESS_PATH
} = require('../poc/external-activation-validator');
const { canonicalExternalActivationIngress } = require('../poc/activation-ingress');
const activationPolicy = require('../poc/activation-policy');
const taskRegistry = require('../poc/task-registry');
const { setDispatcher, dispatch } = require('../services/transport-provider');

const MAIN_WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'main.yml');
const BUILDER_WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'gemini-builder.yml');
const mainRaw = fs.readFileSync(MAIN_WF_PATH, 'utf8');
const builderRaw = fs.readFileSync(BUILDER_WF_PATH, 'utf8');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

let passCount = 0;
let failCount = 0;

function assertTrue(condition, msg) {
    if (!condition) {
        throw new Error(msg || 'Assertion failed: expected truthy value');
    }
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`PASS: ${name}`);
        passCount++;
    } catch (err) {
        console.error(`FAIL: ${name} - ${err.message}`);
        failCount++;
    }
}

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
}

async function setupDirectorApproval(requestId, target, taskMode, capabilities, permittedPaths) {
    return taskRegistry.createDirectorApproval({
        request_id: requestId,
        target: target,
        task_mode: taskMode,
        capabilities: capabilities,
        permitted_paths: permittedPaths,
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });
}

async function main() {
    process.env.ACP_POC_TRIGGER_SECRET = 'test-secret';
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';

// =========================================================
// Workflow file structure tests - prove bypass is closed
// =========================================================

await runTest('main.yml: issue_comment path has activation validation step before Gemini CLI', async () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (issue_comment)');
    assert.ok(validateIdx !== -1, 'issue_comment activation validation step missing');

    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1, 'Gemini CLI step missing');

    assert.ok(validateIdx < geminiIdx, 'activation validation must come BEFORE Gemini CLI run');
});

await runTest('main.yml: workflow_dispatch path has activation validation step before Gemini CLI', async () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (workflow_dispatch)');
    assert.ok(validateIdx !== -1, 'workflow_dispatch activation validation step missing');

    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1, 'Gemini CLI step missing');

    assert.ok(validateIdx < geminiIdx, 'activation validation must come BEFORE Gemini CLI run');
});

await runTest('main.yml: activation validation calls poc/validate-external-activation.js', async () => {
    assert.ok(mainRaw.includes('poc/validate-external-activation.js gemini-issue-comment'),
        'issue_comment validation must call poc/validate-external-activation.js');
    assert.ok(mainRaw.includes('poc/validate-external-activation.js gemini-workflow-dispatch'),
        'workflow_dispatch validation must call poc/validate-external-activation.js');
});

await runTest('main.yml: Run Gemini step is gated on activation validation output', async () => {
    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1);

    const geminiSection = mainRaw.slice(geminiIdx);
    assert.ok(/if:\s*\(.*\)?\s*steps\.validate_activation.*activation_validated\s*==\s*'true'/.test(geminiSection),
        'Run Gemini step should be gated on activation validation');

    assert.ok(!/if:\s*.*\bgithub\.event_name\s*==\s*'issue_comment'\b/.test(geminiSection),
        'Run Gemini step must NOT bypass validation via event_name escape hatch');
});

await runTest('main.yml: validation step calls Render server activation ingress endpoint', async () => {
    assert.ok(mainRaw.includes('RENDER_CALLBACK_BASE_URL'), 'should reference RENDER_CALLBACK_BASE_URL');
    assert.ok(mainRaw.includes('ACP_POC_TRIGGER_SECRET'), 'should reference ACP_POC_TRIGGER_SECRET');
});

await runTest('gemini-builder.yml: validation step exists before Gemini Builder run', async () => {
    const validateIdx = builderRaw.indexOf('Validate external activation through canonical ingress');
    assert.ok(validateIdx !== -1, 'activation validation step missing in builder workflow');

    const builderRunIdx = builderRaw.indexOf('Run Gemini Builder');
    assert.ok(builderRunIdx !== -1, 'Gemini Builder step missing');

    assert.ok(validateIdx < builderRunIdx, 'activation validation must come BEFORE Gemini Builder run');
});

await runTest('gemini-builder.yml: validation calls poc/validate-external-activation.js', async () => {
    assert.ok(builderRaw.includes('poc/validate-external-activation.js builder-workflow-dispatch'),
        'builder validation must call poc/validate-external-activation.js');
});

await runTest('gemini-builder.yml: Run Gemini Builder step is gated on activation validation', async () => {
    const builderRunIdx = builderRaw.indexOf('Run Gemini Builder');
    assert.ok(builderRunIdx !== -1);

    const builderSection = builderRaw.slice(builderRunIdx, builderRaw.indexOf('Commit and push'));
    assert.ok(/if:\s*steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(builderSection),
        'Run Gemini Builder step should be gated on activation validation');
});

await runTest('gemini-builder.yml: validation step calls Render server', async () => {
    assert.ok(builderRaw.includes('RENDER_CALLBACK_BASE_URL'), 'should reference RENDER_CALLBACK_BASE_URL');
    assert.ok(builderRaw.includes('ACP_POC_TRIGGER_SECRET'), 'should reference ACP_POC_TRIGGER_SECRET');
});

// =========================================================
// Activation payload builder tests
// =========================================================

await runTest('buildActivationPayloadForIssueComment - REVIEW mode (default @gemini-cli)', async () => {
    const payload = buildActivationPayloadForIssueComment(
        '123456',
        '@gemini-cli review the architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    assert.equal(payload.target, 'Gemini');
    assert.equal(payload.task_mode, 'REVIEW');
    assert.equal(payload.activation_surface, 'github_issue_comment');
    assert.equal(payload.activation_syntax, '@gemini-cli');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only']);
    assert.deepStrictEqual(payload.constraints.permitted_paths, ['poc/']);
    assert.equal(payload.request_id, '123456');
    assert.ok(payload.task.includes('review the architecture'));
});

await runTest('buildActivationPayloadForIssueComment - FAILOVER_EXECUTE mode', async () => {
    const payload = buildActivationPayloadForIssueComment(
        '123456',
        '@gemini-cli FAILOVER_EXECUTE implement feature X',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    assert.equal(payload.target, 'Gemini');
    assert.equal(payload.task_mode, 'FAILOVER_EXECUTE');
    assert.equal(payload.activation_surface, 'github_issue_comment');
    assert.equal(payload.activation_syntax, '@gemini-cli');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
    assert.ok(payload.task.includes('implement feature X'));
    assert.ok(!payload.task.includes('FAILOVER_EXECUTE'));
});

await runTest('buildActivationPayloadForIssueComment - FAILOVER_EXECUTE without keyword defaults to REVIEW', async () => {
    const payload = buildActivationPayloadForIssueComment(
        '123456',
        '@gemini-cli what do you think about the architecture?',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    assert.equal(payload.task_mode, 'REVIEW');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only']);
});

await runTest('buildActivationPayloadForWorkflowDispatch - preserves all input fields', async () => {
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'req-123',
        task: 'test task',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/,index.js',
        verification: 'All tests must pass'
    });

    assert.equal(payload.target, 'Gemini');
    assert.equal(payload.task_mode, 'FAILOVER_EXECUTE');
    assert.equal(payload.activation_surface, 'workflow_dispatch');
    assert.equal(payload.request_id, 'req-123');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
    assert.deepStrictEqual(payload.constraints.permitted_paths, ['poc/', 'index.js']);
});

await runTest('buildBuilderActivationPayload - produces correct BUILDER payload', async () => {
    const payload = buildBuilderActivationPayload({
        request_id: 'builder-req-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    assert.equal(payload.target, 'Gemini Builder');
    assert.equal(payload.task_mode, 'BUILDER');
    assert.equal(payload.activation_surface, 'workflow_dispatch');
    assert.equal(payload.request_id, 'builder-req-1');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
});

// =========================================================
// Canonical ingress integration tests
// =========================================================

await runTest('Ingress - REVIEW mode issue_comment activation succeeds without Director approval', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-review-ic-1',
        '@gemini-cli review the architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = await canonicalExternalActivationIngress(payload, {});
    assertTrue(result.success, 'REVIEW mode should pass without approval: ' + (result.error || ''));
    assert.equal(result.activation_provenance.activation_target, 'Gemini');
    assert.equal(result.activation_provenance.activation_task_mode, 'REVIEW');
    cleanup();
});

await runTest('Ingress - FAILOVER_EXECUTE issue_comment activation fails closed without Director approval', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-fo-ic-1',
        '@gemini-cli FAILOVER_EXECUTE implement feature X',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

await runTest('Ingress - FAILOVER_EXECUTE workflow_dispatch activation fails closed without Director approval', async () => {
    cleanup();
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'ingress-fo-wfd-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE via workflow_dispatch should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

await runTest('Ingress - BUILDER activation fails closed without Director approval', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'ingress-builder-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'BUILDER should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

await runTest('Ingress - BUILDER activation succeeds with Director approval', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'ingress-builder-approved-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('ingress-builder-approved-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success, 'Approval should be created');
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
    assert.ok(result.success, 'BUILDER should succeed with Director approval: ' + (result.error || ''));
    assert.equal(result.activation_provenance.activation_target, 'Gemini Builder');
    cleanup();
});

await runTest('Ingress - FAILOVER_EXECUTE with Director approval succeeds', async () => {
    cleanup();
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'ingress-fo-approved-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = await setupDirectorApproval('ingress-fo-approved-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
    assert.ok(result.success, 'FAILOVER_EXECUTE should succeed with approval: ' + (result.error || ''));
    cleanup();
});

await runTest('Ingress - authority conflict on externally claimed task_mode fails closed', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-auth-conflict-1',
        '@gemini-cli FAILOVER_EXECUTE implement feature X',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    // Simulate a malicious payload that claims its own task_mode
    payload.claimed_authority = {
        task_mode: 'REVIEW',
        capabilities: ['read_only']
    };

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict should block activation');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

await runTest('Ingress - authority conflict on externally claimed target fails closed', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-auth-conflict-2',
        '@gemini-cli review architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    payload.claimed_authority = {
        target: 'Gemini Builder'
    };

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on target should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

await runTest('Ingress - authority conflict on externally claimed capabilities fails closed', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-auth-conflict-3',
        '@gemini-cli review architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    payload.claimed_authority = {
        authorization: { capabilities: ['read_only', 'modify_files', 'commit', 'push'] }
    };

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on capabilities should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

await runTest('Ingress - authority conflict on externally claimed permitted_paths fails closed', async () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-auth-conflict-4',
        '@gemini-cli FAILOVER_EXECUTE implement feature X',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    payload.claimed_authority = {
        constraints: { permitted_paths: ['index.js', 'services/'] }
    };

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on permitted_paths should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

await runTest('Ingress - server-derived authority overrides any externally claimed capabilities', async () => {
    cleanup();
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'ingress-server-authority-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = await setupDirectorApproval('ingress-server-authority-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
    assert.ok(result.success, 'Should succeed: ' + (result.error || ''));

    const serverCaps = result.command.authorization.capabilities;
    assert.ok(serverCaps.includes('modify_files'), 'Should have server-derived modify_files capability');
    assert.ok(serverCaps.includes('commit'), 'Should have server-derived commit capability');
    assert.ok(serverCaps.includes('push'), 'Should have server-derived push capability');
    assert.ok(serverCaps.includes('run_tests'), 'Should have server-derived run_tests capability');
    cleanup();
});

// =========================================================
// Activation surface policy tests
// =========================================================

await runTest('Policy - @gemini-cli issue_comment is permitted for Gemini FAILOVER_EXECUTE', async () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini', 'FAILOVER_EXECUTE');
    assert.ok(surfaces.includes('github_issue_comment'), 'github_issue_comment should be permitted');
    assert.ok(surfaces.includes('workflow_dispatch'), 'workflow_dispatch should be permitted');
});

await runTest('Policy - workflow_dispatch is NOT permitted for Kilo FAILOVER_EXECUTE', async () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Kilo', 'FAILOVER_EXECUTE');
    assert.ok(!surfaces.includes('workflow_dispatch'), 'workflow_dispatch should NOT be permitted for Kilo');
    assert.ok(surfaces.includes('github_issue_comment'), 'github_issue_comment should be permitted for Kilo');
});

await runTest('Policy - @gemini-cli issue_comment is permitted for Gemini Builder BUILDER', async () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini Builder', 'BUILDER');
    assert.ok(surfaces.includes('workflow_dispatch'), 'workflow_dispatch should be permitted for Builder');
});

// =========================================================
// External activation validator tests
// =========================================================

await runTest('validateExternalActivation - returns correct path constant', async () => {
    assert.equal(ACTIVATION_INGRESS_PATH, '/poc/activation/ingress');
});

await runTest('buildActivationPayloadForIssueComment - produces ACP-compliant payload structure', async () => {
    const payload = buildActivationPayloadForIssueComment(
        'payload-test-1',
        '@gemini-cli review the architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    assert.ok(payload.protocol_version, 'protocol_version missing');
    assert.ok(payload.request_id, 'request_id missing');
    assert.ok(payload.source, 'source missing');
    assert.ok(payload.target, 'target missing');
    assert.ok(payload.task_type, 'task_type missing');
    assert.ok(payload.repository, 'repository missing');
    assert.ok(payload.base_branch, 'base_branch missing');
    assert.ok(payload.task, 'task missing');
    assert.ok(payload.constraints, 'constraints missing');
    assert.ok(payload.authorization, 'authorization missing');
    assert.ok(payload.verification, 'verification missing');
    assert.ok(payload.reporting, 'reporting missing');
    assert.ok(payload.originator, 'originator missing');
    assert.ok(payload.activation_surface, 'activation_surface missing');
    assert.ok(payload.activation_syntax, 'activation_syntax missing');
});

// =========================================================
// Bypass prevention tests
// =========================================================

await runTest('Bypass prevention - main.yml workflow_dispatch cannot bypass validation when called from gemini-trigger', async () => {
    // The gemini-trigger.js triggers workflow_dispatch on main.yml.
    // Before this fix, the workflow would run Gemini directly.
    // After this fix, the validation step runs first.
    assert.ok(mainRaw.includes('Validate external activation through canonical ingress (workflow_dispatch)'),
        'workflow_dispatch validation step must exist');
    assert.ok(mainRaw.includes('steps.validate_activation_wfd.outputs.activation_validated'),
        'validation output must be checked');
});

await runTest('Bypass prevention - main.yml issue_comment cannot bypass validation for FAILOVER_EXECUTE', async () => {
    // The @gemini-cli FAILOVER_EXECUTE issue_comment path was a direct bypass.
    // After this fix, it must go through the canonical ingress.
    const payload = buildActivationPayloadForIssueComment(
        'bypass-test-1',
        '@gemini-cli FAILOVER_EXECUTE dangerous operation',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE via issue_comment must be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
});

await runTest('Bypass prevention - gemini-builder.yml cannot bypass validation', async () => {
    // The gemini-builder.yml workflow_dispatch path was a direct bypass for the Builder.
    // After this fix, it must go through the canonical ingress.
    const payload = buildBuilderActivationPayload({
        request_id: 'bypass-test-2',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const result = await canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'BUILDER via workflow_dispatch must be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
});

await runTest('Bypass prevention - issue_comment with @kilo activation is not accepted by @gemini-cli workflow', async () => {
    // The activation syntax validation ensures the correct syntax for each target.
    const result = activationPolicy.validateActivationSyntax('@kilo', 'Gemini');
    assert.ok(!result.valid, '@kilo should not be valid for Gemini target');
});

await runTest('Bypass prevention - invalid activation surface for target agent is rejected', async () => {
    // Kilo FAILOVER_EXECUTE should not accept workflow_dispatch surface
    const result = activationPolicy.validateActivationSurface('workflow_dispatch', 'Kilo', 'FAILOVER_EXECUTE');
    assert.ok(!result.valid, 'workflow_dispatch should not be valid for Kilo FAILOVER_EXECUTE');
});

await runTest('Bypass prevention - external activation validator module exists and is referenced by both workflows', async () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'poc', 'validate-external-activation.js')),
        'poc/validate-external-activation.js must exist');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'poc', 'external-activation-validator.js')),
        'poc/external-activation-validator.js must exist');
    assert.ok(mainRaw.includes('poc/validate-external-activation.js'),
        'main.yml must reference the validation script');
    assert.ok(builderRaw.includes('poc/validate-external-activation.js'),
        'gemini-builder.yml must reference the validation script');
});

// =========================================================
// Phase 4: Execution-claim mechanism tests
// =========================================================

await runTest('Ingress - BUILDER with carrier identity returns execution_descriptor', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'claim-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('claim-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-test-123',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success, 'BUILDER with carrier identity should succeed: ' + (result.error || ''));
    assert.ok(result.execution_descriptor, 'Should return execution_descriptor');
    assert.equal(result.execution_descriptor.request_id, 'claim-test-1');
    assert.equal(result.execution_descriptor.target_agent, 'Gemini Builder');
    assert.equal(result.execution_descriptor.task_mode, 'BUILDER');
    assert.equal(result.execution_descriptor.repository, 'fluentwithkyle/openclaw-webhook');
    assert.equal(result.execution_descriptor.base_branch, 'main');
    assert.ok(result.execution_claim_id, 'Should return execution_claim_id');
    assert.equal(result.carrier_identity, 'github-workflow-test-123');
    cleanup();
});

await runTest('Ingress - without carrier identity, task admitted but not execution-claimed', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'claim-test-2',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('claim-test-2', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: null,
        carrier_type: 'external'
    });

    assert.ok(result.success, 'Task should be admitted without carrier identity');
    assert.equal(result.execution_claimed, false, 'Should not claim execution without carrier identity');
    assert.ok(!result.execution_descriptor, 'Should not return execution_descriptor without carrier identity');
    assert.ok(!result.execution_claim_id, 'Should not have execution_claim_id without carrier identity');
    cleanup();
});

await runTest('Execution claim - exactly one authoritative claim per task (concurrent claims blocked)', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'claim-test-3',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('claim-test-3', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result1 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-carrier-A',
        carrier_type: 'github_workflow'
    });

    assert.ok(result1.success, 'First claim should succeed: ' + (result1.error || ''));
    assert.ok(result1.execution_claim_id, 'First claim should return execution_claim_id');

    const result2 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-carrier-B',
        carrier_type: 'github_workflow'
    });

    assert.ok(!result2.execution_claimed, 'Second attempt should not create new execution claim');
    assert.ok(result2.replay === true || result2.error_code === 'ALREADY_CLAIMED',
        'Second attempt should be replay or already-claimed: ' + (result2.error || result2.error_code || ''));
    cleanup();
});

await runTest('Execution claim - getExecutionClaim returns the active claim', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'claim-test-4',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('claim-test-4', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-carrier-C',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success);

    const claim = taskRegistry.getExecutionClaim('claim-test-4');
    assert.ok(claim, 'Should retrieve execution claim');
    assert.equal(claim.execution_claim_id, result.execution_claim_id);
    assert.equal(claim.carrier_identity, 'github-workflow-carrier-C');
    cleanup();
});

await runTest('Execution claim - releaseExecutionClaim clears the claim', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'claim-test-5',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('claim-test-5', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-carrier-D',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success);

    const releaseResult = await taskRegistry.releaseExecutionClaim('claim-test-5', result.execution_claim_id);
    assert.ok(releaseResult.success, 'Should release claim: ' + (releaseResult.error || ''));
    assert.equal(releaseResult.error_code, 'RELEASED');

    const claim = taskRegistry.getExecutionClaim('claim-test-5');
    assert.ok(!claim, 'Claim should be cleared after release');
    cleanup();
});

await runTest('Descriptor - buildExecutionDescriptor binds authority-bearing fields from task entry', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'desc-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('desc-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-desc-1',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success);
    const descriptor = result.execution_descriptor;

    assert.equal(descriptor.task_mode, 'BUILDER');
    assert.deepStrictEqual(descriptor.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
    assert.deepStrictEqual(descriptor.permitted_paths, ['poc/']);
    assert.equal(descriptor.target_agent, 'Gemini Builder');
    assert.equal(descriptor.repository, 'fluentwithkyle/openclaw-webhook');
    assert.equal(descriptor.base_branch, 'main');
    assert.equal(descriptor.execution_claim_id, result.execution_claim_id);
    cleanup();
});

await runTest('Ingress - no recursive re-entry: ingress returns descriptor, does not dispatch agent', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'norecurse-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('norecurse-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-norecurse-1',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success);
    assert.ok(result.execution_descriptor, 'Should return descriptor for carrier to use');
    assert.equal(result.execution_claimed, true, 'Should mark execution as claimed');
    assert.ok(result.execution_claim_id, 'Should have execution_claim_id');
    assert.ok(result.carrier_identity, 'Should include carrier_identity in response');
    assert.equal(result.task_status, 'EXECUTING');
    cleanup();
});

await runTest('Workflow - main.yml uses $GITHUB_OUTPUT instead of deprecated ::set-output', async () => {
    assert.ok(!mainRaw.includes('::set-output'), 'main.yml should not use deprecated ::set-output');
    assert.ok(mainRaw.includes('$GITHUB_OUTPUT'), 'main.yml should use $GITHUB_OUTPUT');
});

await runTest('Workflow - gemini-builder.yml uses $GITHUB_OUTPUT instead of deprecated ::set-output', async () => {
    assert.ok(!builderRaw.includes('::set-output'), 'gemini-builder.yml should not use deprecated ::set-output');
    assert.ok(builderRaw.includes('$GITHUB_OUTPUT'), 'gemini-builder.yml should use $GITHUB_OUTPUT');
});

await runTest('Workflow - validate-external-activation.js persists execution descriptor file', async () => {
    const scriptRaw = fs.readFileSync(path.join(__dirname, '..', 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(scriptRaw.includes('EXECUTION_DESCRIPTOR_FILE'), 'Should reference EXECUTION_DESCRIPTOR_FILE env var');
    assert.ok(scriptRaw.includes('execution-descriptor.json'), 'Should default to execution-descriptor.json');
    assert.ok(scriptRaw.includes('writeFileSync'), 'Should persist descriptor via fs.writeFileSync');
});

await runTest('Workflow - main.yml orchestration context consumes execution descriptor (not workflow inputs)', async () => {
    assert.ok(mainRaw.includes('execution-descriptor.json'), 'main.yml should reference execution-descriptor.json');
    assert.ok(mainRaw.includes('jq -r \'.request_id\' "$DESCRIPTOR_FILE"'), 'main.yml should read request_id from descriptor');
    assert.ok(mainRaw.includes('jq -r \'.task_mode\' "$DESCRIPTOR_FILE"'), 'main.yml should read task_mode from descriptor');
    assert.ok(mainRaw.includes('jq -r \'.capabilities | join(",")\' "$DESCRIPTOR_FILE"'), 'main.yml should read capabilities from descriptor');
});

await runTest('Workflow - gemini-builder.yml orchestration context consumes execution descriptor (not workflow inputs)', async () => {
    assert.ok(builderRaw.includes('execution-descriptor.json'), 'gemini-builder.yml should reference execution-descriptor.json');
    assert.ok(builderRaw.includes('jq -r \'.task_mode\' "$DESCRIPTOR_FILE"'), 'gemini-builder.yml should read task_mode from descriptor');
    assert.ok(builderRaw.includes('jq -r \'.capabilities | join(",")\' "$DESCRIPTOR_FILE"'), 'gemini-builder.yml should read capabilities from descriptor');
});

await runTest('Workflow - main.yml Run Gemini step gated on replay (non-replay only)', async () => {
    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1);
    const geminiSection = mainRaw.slice(geminiIdx);
    assert.ok(/!steps\.validate_activation\.outputs\.replay/.test(geminiSection),
        'Run Gemini step should be gated to skip on replay');
    assert.ok(/!steps\.validate_activation_wfd\.outputs\.replay/.test(geminiSection),
        'Run Gemini workflow_dispatch path should be gated to skip on replay');
});

await runTest('Workflow - gemini-builder.yml Run Gemini Builder gated on replay', async () => {
    const builderIdx = builderRaw.indexOf('Run Gemini Builder');
    assert.ok(builderIdx !== -1);
    const builderSection = builderRaw.slice(builderIdx, builderRaw.indexOf('Commit and push'));
    assert.ok(/!steps\.validate_activation\.outputs\.replay/.test(builderSection),
        'Run Gemini Builder should be gated to skip on replay');
});

await runTest('Workflow - external-activation-validator.js transmits x-carrier-identity header', async () => {
    const validatorRaw = fs.readFileSync(path.join(__dirname, '..', 'poc', 'external-activation-validator.js'), 'utf8');
    assert.ok(validatorRaw.includes('x-carrier-identity'), 'Should transmit x-carrier-identity header');
    assert.ok(validatorRaw.includes('GITHUB_RUN_ID'), 'Should derive carrier identity from GITHUB_RUN_ID');
});

// =========================================================
// Phase 4: Workflow ordering and descriptor binding tests
// =========================================================

await runTest('Workflow ordering - main.yml workflow_dispatch: validation step appears before orchestration context step', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const validateIdx = mainRawLocal.indexOf('Validate external activation through canonical ingress (workflow_dispatch)');
    assert.ok(validateIdx !== -1, 'workflow_dispatch validation step must exist');

    const contextIdx = mainRawLocal.indexOf('Prepare orchestration context (workflow_dispatch)');
    assert.ok(contextIdx !== -1, 'workflow_dispatch orchestration context step must exist');

    assert.ok(validateIdx < contextIdx,
        'validation step must appear BEFORE orchestration context step in main.yml workflow_dispatch path');
});

await runTest('Workflow ordering - main.yml workflow_dispatch: orchestration context is gated on validation output', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const contextSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare orchestration context (workflow_dispatch)'));
    assert.ok(/steps\.validate_activation_wfd\.outputs\.activation_validated\s*==\s*'true'/.test(contextSection),
        'orchestration context step must be gated on steps.validate_activation_wfd.outputs.activation_validated');
});

await runTest('Workflow ordering - main.yml workflow_dispatch: orchestration context is gated on non-replay', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const contextSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare orchestration context (workflow_dispatch)'));
    assert.ok(/!steps\.validate_activation_wfd\.outputs\.replay/.test(contextSection),
        'orchestration context step must be gated to skip on replay (workflow_dispatch)');
});

await runTest('Workflow ordering - main.yml workflow_dispatch: orchestration context reads descriptor file', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const contextSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare orchestration context (workflow_dispatch)'));
    assert.ok(contextSection.includes('execution-descriptor.json'), 'orchestration context must reference execution-descriptor.json');
    assert.ok(contextSection.includes('jq -r \'.request_id\' "$DESCRIPTOR_FILE"'), 'orchestration context must read request_id from descriptor');
    assert.ok(contextSection.includes('jq -r \'.task_mode\' "$DESCRIPTOR_FILE"'), 'orchestration context must read task_mode from descriptor');
    assert.ok(contextSection.includes('jq -r \'.capabilities | join(",")\' "$DESCRIPTOR_FILE"'), 'orchestration context must read capabilities from descriptor');
});

await runTest('Workflow ordering - main.yml: Gemini invocation is gated on validation (both paths)', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const geminiSection = mainRawLocal.slice(mainRawLocal.indexOf('Run Gemini in advisory mode'));
    assert.ok(/steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(geminiSection),
        'Gemini run must be gated on issue_comment validation output');
    assert.ok(/steps\.validate_activation_wfd\.outputs\.activation_validated\s*==\s*'true'/.test(geminiSection),
        'Gemini run must be gated on workflow_dispatch validation output');
    assert.ok(/!steps\.validate_activation\.outputs\.replay/.test(geminiSection),
        'Gemini run must skip on issue_comment replay');
    assert.ok(/!steps\.validate_activation_wfd\.outputs\.replay/.test(geminiSection),
        'Gemini run must skip on workflow_dispatch replay');
});

await runTest('Workflow ordering - main.yml: carrier_identity output is sourced from validation step', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const contextWfSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare orchestration context (workflow_dispatch)'), mainRawLocal.indexOf('Prepare orchestration context (issue_comment)'));
    assert.ok(contextWfSection.includes('steps.validate_activation_wfd.outputs.carrier_identity'),
        'workflow_dispatch orchestration context must source carrier_identity from validation step output');
    const contextIcSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare orchestration context (issue_comment)'));
    assert.ok(contextIcSection.includes('steps.validate_activation.outputs.carrier_identity'),
        'issue_comment orchestration context must source carrier_identity from validation step output');
});

await runTest('Descriptor binding - buildExecutionDescriptor includes carrier_identity and carrier_type', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'desc-bind-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('desc-bind-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-bind-1',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success, 'Builder with carrier identity should succeed: ' + (result.error || ''));
    assert.ok(result.execution_descriptor, 'Should return execution_descriptor');
    assert.equal(result.execution_descriptor.carrier_identity, 'github-workflow-bind-1',
        'Descriptor must bind carrier_identity');
    assert.equal(result.execution_descriptor.carrier_type, 'github_workflow',
        'Descriptor must bind carrier_type');
    assert.equal(result.execution_descriptor.execution_claim_id, result.execution_claim_id,
        'Descriptor must bind execution_claim_id');
    cleanup();
});

await runTest('Descriptor binding - buildExecutionDescriptor contains all authority-bearing fields', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'desc-bind-test-2',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('desc-bind-test-2', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-bind-2',
        carrier_type: 'github_workflow'
    });

    assert.ok(result.success);
    const descriptor = result.execution_descriptor;

    assert.ok(descriptor.request_id, 'Descriptor must contain request_id');
    assert.ok(descriptor.execution_claim_id, 'Descriptor must contain execution_claim_id');
    assert.ok(descriptor.carrier_identity, 'Descriptor must contain carrier_identity');
    assert.ok(descriptor.carrier_type, 'Descriptor must contain carrier_type');
    assert.ok(descriptor.task, 'Descriptor must contain task');
    assert.ok(descriptor.repository, 'Descriptor must contain repository');
    assert.ok(descriptor.base_branch, 'Descriptor must contain base_branch');
    assert.ok(descriptor.task_mode, 'Descriptor must contain task_mode');
    assert.ok(descriptor.capabilities, 'Descriptor must contain capabilities');
    assert.ok(descriptor.permitted_paths, 'Descriptor must contain permitted_paths');
    assert.ok(descriptor.target_agent, 'Descriptor must contain target_agent');
    cleanup();
});

await runTest('Descriptor binding - buildExecutionDescriptor returns null carrier fields when no claim', async () => {
    cleanup();
    const taskEntry = {
        task: 'test',
        repository: 'test/repo',
        base_branch: 'main',
        task_mode: 'REVIEW',
        capabilities: ['read_only'],
        permitted_paths: ['poc/'],
        current_agent: 'Gemini'
    };
    const descriptor = taskRegistry.buildExecutionDescriptor('test-req', taskEntry, null);
    assert.equal(descriptor.carrier_identity, null, 'carrier_identity should be null without claim');
    assert.equal(descriptor.carrier_type, null, 'carrier_type should be null without claim');
    assert.equal(descriptor.execution_claim_id, null, 'execution_claim_id should be null without claim');
    cleanup();
});

await runTest('Gemini invocation - consumes descriptor values via orchestration_context outputs', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const geminiSection = mainRawLocal.slice(mainRawLocal.indexOf('Run Gemini in advisory mode'));

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.request_id'),
        'Gemini invocation must consume request_id from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.request_id'),
        'Gemini invocation must also consume request_id from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.task'),
        'Gemini invocation must consume task from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.task'),
        'Gemini invocation must also consume task from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.repository'),
        'Gemini invocation must consume repository from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.repository'),
        'Gemini invocation must also consume repository from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.base_branch'),
        'Gemini invocation must consume base_branch from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.base_branch'),
        'Gemini invocation must also consume base_branch from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.task_mode'),
        'Gemini invocation must consume task_mode from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.task_mode'),
        'Gemini invocation must also consume task_mode from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.capabilities'),
        'Gemini invocation must consume capabilities from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.capabilities'),
        'Gemini invocation must also consume capabilities from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.permitted_paths'),
        'Gemini invocation must consume permitted_paths from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.permitted_paths'),
        'Gemini invocation must also consume permitted_paths from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.execution_claim_id'),
        'Gemini invocation must consume execution_claim_id from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.execution_claim_id'),
        'Gemini invocation must also consume execution_claim_id from issue_comment orchestration context (descriptor)');

    assert.ok(geminiSection.includes('steps.orchestration_context_wfd.outputs.carrier_identity'),
        'Gemini invocation must consume carrier_identity from workflow_dispatch orchestration context (descriptor)');
    assert.ok(geminiSection.includes('steps.orchestration_context_ic.outputs.carrier_identity'),
        'Gemini invocation must also consume carrier_identity from issue_comment orchestration context (descriptor)');
});

await runTest('Callback - preserves request/claim/carrier correlation in ACP report payload', async () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const callbackSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare ACP report payload'));

    assert.ok(callbackSection.includes('steps.orchestration_context_wfd.outputs.execution_claim_id') ||
               callbackSection.includes('steps.orchestration_context_ic.outputs.execution_claim_id'),
        'Callback payload must include execution_claim_id from orchestration context');
    assert.ok(callbackSection.includes('steps.orchestration_context_wfd.outputs.carrier_identity') ||
               callbackSection.includes('steps.orchestration_context_ic.outputs.carrier_identity'),
        'Callback payload must include carrier_identity from orchestration context');
    assert.ok(callbackSection.includes('x-gemini-callback-secret'),
        'Callback must include authentication header');
    assert.ok(callbackSection.includes('RENDER_GEMINI_CALLBACK_URL'),
        'Callback must reference Render callback URL');
});

await runTest('Replay safety - matching replay does not produce second execution claim', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'replay-safety-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('replay-safety-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result1 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-safety-A',
        carrier_type: 'github_workflow'
    });
    assert.ok(result1.success, 'First claim should succeed');
    assert.equal(result1.execution_claimed, true);

    const result2 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-safety-B',
        carrier_type: 'github_workflow'
    });
    assert.ok(result2.success, 'Replay should succeed (idempotent): ' + (result2.error || ''));
    assert.equal(result2.replay, true, 'Second attempt should be detected as replay');
    assert.equal(result2.execution_claimed, undefined, 'Replay should not set execution_claimed');
    cleanup();
});

await runTest('Replay safety - changed payload fails closed (carrier mismatch)', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'replay-safety-test-2',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('replay-safety-test-2', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result1 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-safety-C',
        carrier_type: 'github_workflow'
    });
    assert.ok(result1.success, 'First claim should succeed');

    assert.equal(result1.execution_descriptor.carrier_identity, 'github-workflow-replay-safety-C',
        'First descriptor must bind the correct carrier');

    const modifiedPayload = { ...payload, task: 'completely different task' };
    modifiedPayload.authorization = { ...payload.authorization, approval_id: approval.approval.approval_id };
    const result2 = await canonicalExternalActivationIngress(modifiedPayload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-safety-D',
        carrier_type: 'github_workflow'
    });
    assert.ok(!result2.success, 'Changed payload should fail closed');
    assert.ok(
        result2.error_code === 'REPLAY_PAYLOAD_MISMATCH' ||
        result2.error_code === 'DUPLICATE_REQUEST_ID' ||
        result2.stage === 'conflict',
        'Changed payload should fail with conflict or mismatch error: ' + (result2.error || result2.error_code || '')
    );
    cleanup();
});

await runTest('Workflow - routes/poc.js passes carrier_identity from request header', async () => {
    const routesRaw = fs.readFileSync(path.join(__dirname, '..', 'routes', 'poc.js'), 'utf8');
    assert.ok(routesRaw.includes('x-carrier-identity'), 'Route should read x-carrier-identity header');
    assert.ok(routesRaw.includes('carrier_identity: carrierIdentity'), 'Route should pass carrier_identity to dispatchContext');
});

await runTest('Ingress - replay does not set execution_claimed', async () => {
    cleanup();
    const payload = buildBuilderActivationPayload({
        request_id: 'replay-claim-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const approval = await setupDirectorApproval('replay-claim-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result1 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-1',
        carrier_type: 'github_workflow'
    });
    assert.ok(result1.success);
    assert.equal(result1.execution_claimed, true);

    const result2 = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-replay-2',
        carrier_type: 'github_workflow'
    });
    assert.ok(result2.success, 'Replay should succeed: ' + (result2.error || ''));
    assert.equal(result2.replay, true);
    assert.equal(result2.execution_claimed, undefined, 'Replay should not set execution_claimed');
    cleanup();
});

// =========================================================
// Phase 5: Raw workflow/task permitted_paths bypass prevention
// =========================================================

await runTest('Bypass prevention - workflow_dispatch permitted_paths input cannot expand authority beyond Director approval', async () => {
    cleanup();
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
    // Workflow input supplies broader paths, but Director approval only authorizes 'poc/'
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'bypass-wfd-paths-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'docs/ai/,poc/,index.js',
        verification: 'tests must pass'
    });

    // Director approval only authorizes poc/
    const approval = await setupDirectorApproval('bypass-wfd-paths-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assertTrue(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-bypass-wfd-1',
        carrier_type: 'github_workflow'
    });

    assertTrue(result.success, 'Should succeed (approval is for poc/ only): ' + (result.error || ''));
    // The descriptor must only contain the Director-approved paths, not the workflow input paths
    assert.deepStrictEqual(result.execution_descriptor.permitted_paths, ['poc/'],
        'Execution descriptor must use Director-approved paths, not workflow input paths');
    cleanup();
});

await runTest('Bypass prevention - Builder workflow permitted_paths input cannot expand authority beyond Director approval', async () => {
    cleanup();
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
    const payload = buildBuilderActivationPayload({
        request_id: 'bypass-builder-paths-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'docs/ai/,poc/,services/'
    });

    const approval = await setupDirectorApproval('bypass-builder-paths-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assertTrue(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-bypass-builder-1',
        carrier_type: 'github_workflow'
    });

    assertTrue(result.success, 'Should succeed (approval is for poc/ only): ' + (result.error || ''));
    assert.deepStrictEqual(result.execution_descriptor.permitted_paths, ['poc/'],
        'Execution descriptor must use Director-approved paths, not workflow input paths');
    cleanup();
});

await runTest('Bypass prevention - task text with permitted_paths JSON cannot grant authority', async () => {
    cleanup();
    const cmd = {
        protocol_version: '0.1',
        request_id: 'bypass-task-text-1',
        source: 'GitHub issue_comment',
        target: 'Gemini',
        task_type: 'github_external_activation',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'FAILOVER_EXECUTE implement this. permitted_paths: ["AGENTS.md", "index.js"]',
        task_mode: 'FAILOVER_EXECUTE',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
        verification: 'tests must pass',
        reporting: 'json',
        originator: 'Kyle',
        activation_syntax: '@gemini-cli',
        activation_surface: 'github_issue_comment'
    };

    // No Director approval - should be blocked
    const result = await canonicalExternalActivationIngress(cmd, {});
    assertTrue(!result.success, 'Should be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

await runTest('Bypass prevention - externally claimed permitted_paths in payload are overwritten by server-derived authority', async () => {
    cleanup();
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'bypass-claim-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = await setupDirectorApproval('bypass-claim-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assertTrue(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    // Simulate malicious payload that tries to claim its own permitted_paths authority
    payload.claimed_authority = {
        constraints: { permitted_paths: ['AGENTS.md', 'index.js', 'services/'] }
    };

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id
    });

    assertTrue(!result.success, 'Claimed authority on permitted_paths should conflict and be blocked');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

await runTest('Bypass prevention - scope-hash mismatch falls back to safe poc/ default (broader scope not applied)', async () => {
    cleanup();
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'bypass-hash-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'docs/ai/,poc/',
        verification: 'tests must pass'
    });

    // Approval created with only poc/ scope
    const approval = await setupDirectorApproval('bypass-hash-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assertTrue(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id
    });

    // Scope hash mismatch means the broader scope is NOT applied.
    // The command should still succeed but with safe poc/ default (not blocked, not expanded)
    assertTrue(result.success, 'Task should succeed with safe default when scope hash mismatches');
    assertTrue(result.task_entry, 'Should have task entry');
    // The scope hash mismatch means the broader paths are NOT applied
    // The permitted_paths should remain poc/ (the server-safe default)
    assert.deepStrictEqual(result.task_entry.permitted_paths, ['poc/'],
        'When scope hash mismatches, broader paths must NOT be applied; stays at poc/');
    cleanup();
});

await runTest('Bypass prevention - Director-approved broader scope reaches execution descriptor within MAX boundary', async () => {
    cleanup();
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'bypass-valid-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'docs/ai/,poc/',
        verification: 'tests must pass'
    });

    // Director approval with broader scope within MAX_AUTHORIZED_PATHS
    const approval = await setupDirectorApproval('bypass-valid-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['docs/ai/', 'poc/']);
    assertTrue(approval.success, 'Approval with docs/ai/ and poc/ should be valid');
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = await canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-bypass-valid-1',
        carrier_type: 'github_workflow'
    });

    assertTrue(result.success, 'Should succeed with valid Director approval: ' + (result.error || ''));
    assertTrue(result.execution_descriptor, 'Should return execution descriptor');
    assert.deepStrictEqual(result.execution_descriptor.permitted_paths, ['docs/ai/', 'poc/'],
        'Execution descriptor must contain Director-approved paths within MAX boundary');
    cleanup();
});

// =========================================================
// Summary
// =========================================================

    console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
