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

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
}

function setupDirectorApproval(requestId, target, taskMode, capabilities, permittedPaths) {
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

// =========================================================
// Workflow file structure tests - prove bypass is closed
// =========================================================

runTest('main.yml: issue_comment path has activation validation step before Gemini CLI', () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (issue_comment)');
    assert.ok(validateIdx !== -1, 'issue_comment activation validation step missing');

    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1, 'Gemini CLI step missing');

    assert.ok(validateIdx < geminiIdx, 'activation validation must come BEFORE Gemini CLI run');
});

runTest('main.yml: workflow_dispatch path has activation validation step before Gemini CLI', () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (workflow_dispatch)');
    assert.ok(validateIdx !== -1, 'workflow_dispatch activation validation step missing');

    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1, 'Gemini CLI step missing');

    assert.ok(validateIdx < geminiIdx, 'activation validation must come BEFORE Gemini CLI run');
});

runTest('main.yml: activation validation calls poc/validate-external-activation.js', () => {
    assert.ok(mainRaw.includes('poc/validate-external-activation.js gemini-issue-comment'),
        'issue_comment validation must call poc/validate-external-activation.js');
    assert.ok(mainRaw.includes('poc/validate-external-activation.js gemini-workflow-dispatch'),
        'workflow_dispatch validation must call poc/validate-external-activation.js');
});

runTest('main.yml: Run Gemini step is gated on activation validation output', () => {
    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assert.ok(geminiIdx !== -1);

    const geminiSection = mainRaw.slice(geminiIdx);
    assert.ok(/if:\s*steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(geminiSection),
        'Run Gemini step should be gated on activation validation');

    assert.ok(!/if:\s*.*\bgithub\.event_name\s*==\s*'issue_comment'\b/.test(geminiSection),
        'Run Gemini step must NOT bypass validation via event_name escape hatch');
});

runTest('main.yml: validation step calls Render server activation ingress endpoint', () => {
    assert.ok(mainRaw.includes('RENDER_CALLBACK_BASE_URL'), 'should reference RENDER_CALLBACK_BASE_URL');
    assert.ok(mainRaw.includes('ACP_POC_TRIGGER_SECRET'), 'should reference ACP_POC_TRIGGER_SECRET');
});

runTest('gemini-builder.yml: validation step exists before Gemini Builder run', () => {
    const validateIdx = builderRaw.indexOf('Validate external activation through canonical ingress');
    assert.ok(validateIdx !== -1, 'activation validation step missing in builder workflow');

    const builderRunIdx = builderRaw.indexOf('Run Gemini Builder');
    assert.ok(builderRunIdx !== -1, 'Gemini Builder step missing');

    assert.ok(validateIdx < builderRunIdx, 'activation validation must come BEFORE Gemini Builder run');
});

runTest('gemini-builder.yml: validation calls poc/validate-external-activation.js', () => {
    assert.ok(builderRaw.includes('poc/validate-external-activation.js builder-workflow-dispatch'),
        'builder validation must call poc/validate-external-activation.js');
});

runTest('gemini-builder.yml: Run Gemini Builder step is gated on activation validation', () => {
    const builderRunIdx = builderRaw.indexOf('Run Gemini Builder');
    assert.ok(builderRunIdx !== -1);

    const builderSection = builderRaw.slice(builderRunIdx, builderRaw.indexOf('Commit and push'));
    assert.ok(/if:\s*steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(builderSection),
        'Run Gemini Builder step should be gated on activation validation');
});

runTest('gemini-builder.yml: validation step calls Render server', () => {
    assert.ok(builderRaw.includes('RENDER_CALLBACK_BASE_URL'), 'should reference RENDER_CALLBACK_BASE_URL');
    assert.ok(builderRaw.includes('ACP_POC_TRIGGER_SECRET'), 'should reference ACP_POC_TRIGGER_SECRET');
});

// =========================================================
// Activation payload builder tests
// =========================================================

runTest('buildActivationPayloadForIssueComment - REVIEW mode (default @gemini-cli)', () => {
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

runTest('buildActivationPayloadForIssueComment - FAILOVER_EXECUTE mode', () => {
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

runTest('buildActivationPayloadForIssueComment - FAILOVER_EXECUTE without keyword defaults to REVIEW', () => {
    const payload = buildActivationPayloadForIssueComment(
        '123456',
        '@gemini-cli what do you think about the architecture?',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    assert.equal(payload.task_mode, 'REVIEW');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only']);
});

runTest('buildActivationPayloadForWorkflowDispatch - preserves all input fields', () => {
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

runTest('buildBuilderActivationPayload - produces correct BUILDER payload', () => {
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

runTest('Ingress - REVIEW mode issue_comment activation succeeds without Director approval', () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-review-ic-1',
        '@gemini-cli review the architecture',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = canonicalExternalActivationIngress(payload, {});
    assertTrue(result.success, 'REVIEW mode should pass without approval: ' + (result.error || ''));
    assert.equal(result.activation_provenance.activation_target, 'Gemini');
    assert.equal(result.activation_provenance.activation_task_mode, 'REVIEW');
    cleanup();
});

runTest('Ingress - FAILOVER_EXECUTE issue_comment activation fails closed without Director approval', () => {
    cleanup();
    const payload = buildActivationPayloadForIssueComment(
        'ingress-fo-ic-1',
        '@gemini-cli FAILOVER_EXECUTE implement feature X',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

runTest('Ingress - FAILOVER_EXECUTE workflow_dispatch activation fails closed without Director approval', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE via workflow_dispatch should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

runTest('Ingress - BUILDER activation fails closed without Director approval', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'BUILDER should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

runTest('Ingress - BUILDER activation succeeds with Director approval', () => {
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

    const approval = setupDirectorApproval('ingress-builder-approved-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success, 'Approval should be created');
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
    assert.ok(result.success, 'BUILDER should succeed with Director approval: ' + (result.error || ''));
    assert.equal(result.activation_provenance.activation_target, 'Gemini Builder');
    cleanup();
});

runTest('Ingress - FAILOVER_EXECUTE with Director approval succeeds', () => {
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

    const approval = setupDirectorApproval('ingress-fo-approved-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
    assert.ok(result.success, 'FAILOVER_EXECUTE should succeed with approval: ' + (result.error || ''));
    cleanup();
});

runTest('Ingress - authority conflict on externally claimed task_mode fails closed', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict should block activation');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

runTest('Ingress - authority conflict on externally claimed target fails closed', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on target should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

runTest('Ingress - authority conflict on externally claimed capabilities fails closed', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on capabilities should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

runTest('Ingress - authority conflict on externally claimed permitted_paths fails closed', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'Authority conflict on permitted_paths should block');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

runTest('Ingress - server-derived authority overrides any externally claimed capabilities', () => {
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

    const approval = setupDirectorApproval('ingress-server-authority-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    assert.ok(approval.success);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = canonicalExternalActivationIngress(payload, { director_approval_id: payload.authorization.approval_id });
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

runTest('Policy - @gemini-cli issue_comment is permitted for Gemini FAILOVER_EXECUTE', () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini', 'FAILOVER_EXECUTE');
    assert.ok(surfaces.includes('github_issue_comment'), 'github_issue_comment should be permitted');
    assert.ok(surfaces.includes('workflow_dispatch'), 'workflow_dispatch should be permitted');
});

runTest('Policy - workflow_dispatch is NOT permitted for Kilo FAILOVER_EXECUTE', () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Kilo', 'FAILOVER_EXECUTE');
    assert.ok(!surfaces.includes('workflow_dispatch'), 'workflow_dispatch should NOT be permitted for Kilo');
    assert.ok(surfaces.includes('github_issue_comment'), 'github_issue_comment should be permitted for Kilo');
});

runTest('Policy - @gemini-cli issue_comment is permitted for Gemini Builder BUILDER', () => {
    const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini Builder', 'BUILDER');
    assert.ok(surfaces.includes('workflow_dispatch'), 'workflow_dispatch should be permitted for Builder');
});

// =========================================================
// External activation validator tests
// =========================================================

runTest('validateExternalActivation - returns correct path constant', () => {
    assert.equal(ACTIVATION_INGRESS_PATH, '/poc/activation/ingress');
});

runTest('buildActivationPayloadForIssueComment - produces ACP-compliant payload structure', () => {
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

runTest('Bypass prevention - main.yml workflow_dispatch cannot bypass validation when called from gemini-trigger', () => {
    // The gemini-trigger.js triggers workflow_dispatch on main.yml.
    // Before this fix, the workflow would run Gemini directly.
    // After this fix, the validation step runs first.
    assert.ok(mainRaw.includes('Validate external activation through canonical ingress (workflow_dispatch)'),
        'workflow_dispatch validation step must exist');
    assert.ok(mainRaw.includes('steps.validate_activation_wfd.outputs.activation_validated'),
        'validation output must be checked');
});

runTest('Bypass prevention - main.yml issue_comment cannot bypass validation for FAILOVER_EXECUTE', () => {
    // The @gemini-cli FAILOVER_EXECUTE issue_comment path was a direct bypass.
    // After this fix, it must go through the canonical ingress.
    const payload = buildActivationPayloadForIssueComment(
        'bypass-test-1',
        '@gemini-cli FAILOVER_EXECUTE dangerous operation',
        'fluentwithkyle/openclaw-webhook',
        'main'
    );

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE via issue_comment must be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
});

runTest('Bypass prevention - gemini-builder.yml cannot bypass validation', () => {
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

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'BUILDER via workflow_dispatch must be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
});

runTest('Bypass prevention - issue_comment with @kilo activation is not accepted by @gemini-cli workflow', () => {
    // The activation syntax validation ensures the correct syntax for each target.
    const result = activationPolicy.validateActivationSyntax('@kilo', 'Gemini');
    assert.ok(!result.valid, '@kilo should not be valid for Gemini target');
});

runTest('Bypass prevention - invalid activation surface for target agent is rejected', () => {
    // Kilo FAILOVER_EXECUTE should not accept workflow_dispatch surface
    const result = activationPolicy.validateActivationSurface('workflow_dispatch', 'Kilo', 'FAILOVER_EXECUTE');
    assert.ok(!result.valid, 'workflow_dispatch should not be valid for Kilo FAILOVER_EXECUTE');
});

runTest('Bypass prevention - external activation validator module exists and is referenced by both workflows', () => {
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
// Summary
// =========================================================

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');

function assertTrue(condition, msg) {
    if (!condition) {
        throw new Error(msg || 'Assertion failed: expected truthy value');
    }
}

function assertDeepStrictEqual(actual, expected, msg) {
    assert.deepStrictEqual(actual, expected, msg);
}

if (failCount > 0) {
    process.exit(1);
}
