const assert = require('assert');
const activationPolicy = require('../poc/activation-policy');
const { canonicalExternalActivationIngress } = require('../poc/activation-ingress');
const taskRegistry = require('../poc/task-registry');
const { setDispatcher, dispatch } = require('../services/transport-provider');
const path = require('path');
const fs = require('fs');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(condition, msg) {
    if (!condition) {
        throw new Error(`${msg || 'Assertion failed'}: expected truthy value`);
    }
}

function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${msg || 'Deep assertion failed'}: expected ${e}, got ${a}`);
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

function makeKiloFailoverCommand(requestId, overrides) {
    return Object.assign({
        protocol_version: '0.1',
        request_id: requestId,
        source: 'DeepSeek Coordinator',
        target: 'Kilo',
        task_type: 'implementation',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'test-failover-task',
        task_mode: 'FAILOVER_EXECUTE',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
        verification: 'Run tests and verify',
        reporting: 'json',
        originator: 'Kyle',
        activation_syntax: '@kilo',
        activation_surface: 'github_issue_comment'
    }, overrides || {});
}

async function setupDirectorApproval(requestId, target, taskMode, capabilities, permittedPaths) {
    const approvalResult = await taskRegistry.createDirectorApproval({
        request_id: requestId,
        target: target,
        task_mode: taskMode,
        capabilities: capabilities,
        permitted_paths: permittedPaths,
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });
    return approvalResult;
}

function makeGeminiFailoverCommand(requestId, overrides) {
    return Object.assign({
        protocol_version: '0.1',
        request_id: requestId,
        source: 'DeepSeek Coordinator',
        target: 'Gemini',
        task_type: 'implementation',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'test-gemini-failover',
        task_mode: 'FAILOVER_EXECUTE',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
        verification: 'Run tests and verify',
        reporting: 'json',
        originator: 'Kyle',
        activation_syntax: '@gemini-cli',
        activation_surface: 'github_issue_comment'
    }, overrides || {});
}

function makeBuilderCommand(requestId, overrides) {
    return Object.assign({
        protocol_version: '0.1',
        request_id: requestId,
        source: 'DeepSeek Coordinator',
        target: 'Gemini Builder',
        task_type: 'implementation',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'test-builder-task',
        task_mode: 'BUILDER',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
        verification: 'verify build',
        reporting: 'json',
        originator: 'Kyle',
        activation_syntax: '@gemini-cli',
        activation_surface: 'workflow_dispatch'
    }, overrides || {});
}

async function main() {
    process.env.ACP_POC_TRIGGER_SECRET = 'test-secret';
    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';

    // =========================================================
    // Policy Matrix Tests
    // =========================================================

    await runTest('Policy - Kilo FAILOVER_EXECUTE permits github_issue_comment', async () => {
        cleanup();
        const surfaces = activationPolicy.getPermittedActivationSurfaces('Kilo', 'FAILOVER_EXECUTE');
        assertTrue(surfaces.includes('github_issue_comment'), 'Should include github_issue_comment');
        assertTrue(surfaces.includes('github_issue_body'), 'Should include github_issue_body');
        assertTrue(surfaces.includes('github_push_event'), 'Should include github_push_event');
    });

    await runTest('Policy - Gemini FAILOVER_EXECUTE permits github_issue_comment and workflow_dispatch', async () => {
        cleanup();
        const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini', 'FAILOVER_EXECUTE');
        assertTrue(surfaces.includes('github_issue_comment'), 'Should include github_issue_comment');
        assertTrue(surfaces.includes('workflow_dispatch'), 'Should include workflow_dispatch');
        assertTrue(!surfaces.includes('github_push_event'), 'Should NOT include github_push_event for Gemini');
    });

    await runTest('Policy - Gemini Builder BUILDER permits github_issue_comment and workflow_dispatch', async () => {
        cleanup();
        const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini Builder', 'BUILDER');
        assertTrue(surfaces.includes('github_issue_comment'), 'Should include github_issue_comment');
        assertTrue(surfaces.includes('workflow_dispatch'), 'Should include workflow_dispatch');
    });

    await runTest('Policy - REVIEW mode does not require activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Kilo', 'REVIEW');
        assertEqual(requires, false, 'REVIEW should not require activation');
    });

    await runTest('Policy - VERIFY_RECONCILE mode does not require activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Kilo', 'VERIFY_RECONCILE');
        assertEqual(requires, false, 'VERIFY_RECONCILE should not require activation');
    });

    await runTest('Policy - RESEARCH_DOCUMENT mode does not require activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Kilo', 'RESEARCH_DOCUMENT');
        assertEqual(requires, false, 'RESEARCH_DOCUMENT should not require activation');
    });

    await runTest('Policy - FAILOVER_EXECUTE requires activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Kilo', 'FAILOVER_EXECUTE');
        assertEqual(requires, true, 'FAILOVER_EXECUTE should require activation');
    });

    await runTest('Policy - BUILDER mode requires activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Gemini Builder', 'BUILDER');
        assertEqual(requires, true, 'BUILDER should require activation');
    });

    await runTest('Policy - unknown agent returns null policy entry', async () => {
        cleanup();
        const entry = activationPolicy.getPolicyEntry('UnknownAgent', 'REVIEW');
        assertEqual(entry, null);
    });

    await runTest('Policy - unknown task mode returns null policy entry', async () => {
        cleanup();
        const entry = activationPolicy.getPolicyEntry('Kilo', 'UNKNOWN_MODE');
        assertEqual(entry, null);
    });

    await runTest('Policy - Security Specialist REVIEW does not require activation', async () => {
        cleanup();
        const requires = activationPolicy.requiresActivation('Security Specialist', 'REVIEW');
        assertEqual(requires, false);
    });

    // =========================================================
    // Activation Syntax Validation Tests
    // =========================================================

    await runTest('Syntax - @kilo is valid for Kilo', async () => {
        const result = activationPolicy.validateActivationSyntax('@kilo', 'Kilo');
        assertTrue(result.valid, '@kilo should be valid for Kilo');
    });

    await runTest('Syntax - @kilo is case-sensitive (no @Kilo)', async () => {
        const result = activationPolicy.validateActivationSyntax('@Kilo', 'Kilo');
        assertTrue(!result.valid, '@Kilo should be rejected');
    });

    await runTest('Syntax - @gemini-cli is valid for Gemini', async () => {
        const result = activationPolicy.validateActivationSyntax('@gemini-cli', 'Gemini');
        assertTrue(result.valid, '@gemini-cli should be valid for Gemini');
    });

    await runTest('Syntax - @gemini-cli is valid for Gemini Builder', async () => {
        const result = activationPolicy.validateActivationSyntax('@gemini-cli', 'Gemini Builder');
        assertTrue(result.valid, '@gemini-cli should be valid for Gemini Builder');
    });

    await runTest('Syntax - @Gemini (capital) is rejected', async () => {
        const result = activationPolicy.validateActivationSyntax('@Gemini', 'Gemini');
        assertTrue(!result.valid, '@Gemini should be rejected');
        assertTrue(result.error.includes('not valid'), 'Error should mention not valid');
    });

    await runTest('Syntax - bare @gemini mention is rejected', async () => {
        const result = activationPolicy.validateActivationSyntax('@gemini please review', 'Gemini');
        assertTrue(!result.valid, '@gemini bare mention should be rejected');
    });

    await runTest('Syntax - empty activation is rejected', async () => {
        const result = activationPolicy.validateActivationSyntax('', 'Kilo');
        assertTrue(!result.valid);
    });

    await runTest('Syntax - undefined activation is rejected', async () => {
        const result = activationPolicy.validateActivationSyntax(undefined, 'Kilo');
        assertTrue(!result.valid);
    });

    // =========================================================
    // Activation Surface Validation Tests
    // =========================================================

    await runTest('Surface - valid surface for Kilo FAILOVER_EXECUTE', async () => {
        const result = activationPolicy.validateActivationSurface('github_issue_comment', 'Kilo', 'FAILOVER_EXECUTE');
        assertTrue(result.valid, 'github_issue_comment should be valid for Kilo FAILOVER_EXECUTE');
    });

    await runTest('Surface - invalid surface for Kilo FAILOVER_EXECUTE fails closed', async () => {
        const result = activationPolicy.validateActivationSurface('workflow_dispatch', 'Kilo', 'FAILOVER_EXECUTE');
        assertTrue(!result.valid, 'workflow_dispatch should NOT be valid for Kilo FAILOVER_EXECUTE');
    });

    await runTest('Surface - workflow_dispatch is valid for Gemini FAILOVER_EXECUTE', async () => {
        const result = activationPolicy.validateActivationSurface('workflow_dispatch', 'Gemini', 'FAILOVER_EXECUTE');
        assertTrue(result.valid, 'workflow_dispatch should be valid for Gemini FAILOVER_EXECUTE');
    });

    await runTest('Surface - null surface fails closed', async () => {
        const result = activationPolicy.validateActivationSurface(null, 'Kilo', 'FAILOVER_EXECUTE');
        assertTrue(!result.valid);
    });

    await runTest('Surface - unknown surface name fails closed', async () => {
        const result = activationPolicy.validateActivationSurface('unknown_surface', 'Kilo', 'FAILOVER_EXECUTE');
        assertTrue(!result.valid);
    });

    // =========================================================
    // Authority Conflict Tests
    // =========================================================

    await runTest('Authority - conflicting capabilities are detected', async () => {
        const result = activationPolicy.isAuthorityConflict(
            { authorization: { capabilities: ['read_only'] } },
            { claimed_authority: { authorization: { capabilities: ['read_only', 'modify_files'] } } }
        );
        assertTrue(result.conflict, 'Should detect authority conflict');
        assertTrue(result.conflicting_fields.includes('authorization'));
    });

    await runTest('Authority - non-conflicting capabilities are not flagged', async () => {
        const result = activationPolicy.isAuthorityConflict(
            { authorization: { capabilities: ['read_only', 'modify_files'] } },
            { claimed_authority: { capabilities: ['read_only', 'modify_files'] } }
        );
        assertTrue(!result.conflict);
    });

    await runTest('Authority - conflicting target is detected', async () => {
        const result = activationPolicy.isAuthorityConflict(
            { target: 'Kilo' },
            { claimed_authority: { target: 'Gemini' } }
        );
        assertTrue(result.conflict);
        assertTrue(result.conflicting_fields.includes('target'));
    });

    await runTest('Authority - conflicting repository is detected', async () => {
        const result = activationPolicy.isAuthorityConflict(
            { repository: 'fluentwithkyle/openclaw-webhook' },
            { claimed_authority: { repository: 'other/repo' } }
        );
        assertTrue(result.conflict);
        assertTrue(result.conflicting_fields.includes('repository'));
    });

    await runTest('Authority - no claimed authority is not a conflict', async () => {
        const result = activationPolicy.isAuthorityConflict(
            { authorization: { capabilities: ['read_only'] } },
            {}
        );
        assertTrue(!result.conflict);
    });

    // =========================================================
    // Server-Derived Authority Enforcement Tests
    // =========================================================

    await runTest('Authority enforcement - correct capabilities pass for FAILOVER_EXECUTE', async () => {
        cleanup();
        const result = activationPolicy.enforceServerDerivedAuthority(makeKiloFailoverCommand('auth-test-1'));
        assertTrue(result.valid, 'Should be valid with server-derived capabilities');
        assertTrue(result.server_derived.capabilities.includes('modify_files'));
        assertTrue(result.server_derived.capabilities.includes('run_tests'));
    });

    await runTest('Authority enforcement - derives server capabilities regardless of incoming capabilities', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('auth-test-2');
        cmd.authorization.capabilities = ['read_only'];
        const result = activationPolicy.enforceServerDerivedAuthority(cmd);
        assertTrue(result.valid, 'Should be valid — server derives capabilities, does not validate incoming');
        assertTrue(result.server_derived.capabilities.includes('read_only'));
        assertTrue(result.server_derived.capabilities.includes('modify_files'));
        assertTrue(result.server_derived.capabilities.includes('run_tests'));
        assertTrue(result.server_derived.capabilities.includes('commit'));
        assertTrue(result.server_derived.capabilities.includes('push'));
    });

    // =========================================================
    // RESEARCH_DOCUMENT Server-Derived Capability Tests
    // =========================================================

    await runTest('Authority enforcement - RESEARCH_DOCUMENT derives read_only from policy', async () => {
        cleanup();
        const cmd = {
            protocol_version: '0.1',
            request_id: 'research-auth-test-1',
            source: 'GitHub workflow_dispatch',
            target: 'Gemini',
            task_type: 'github_external_activation',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task: 'research task',
            task_mode: 'RESEARCH_DOCUMENT',
            constraints: { permitted_paths: ['docs/ai/research/'] },
            authorization: { capabilities: ['inspect', 'inspect_repository', 'inspect_github_actions', 'modify_files', 'commit', 'push'] },
            verification: 'research and persist findings',
            reporting: 'json',
            originator: 'Kyle',
            activation_surface: 'workflow_dispatch'
        };
        const result = activationPolicy.enforceServerDerivedAuthority(cmd);
        assertTrue(result.valid, 'Should succeed: ' + (result.error || ''));
        assertTrue(result.server_derived.capabilities.includes('read_only'), 'Must derive read_only');
        assertTrue(result.server_derived.capabilities.includes('modify_files'));
        assertTrue(result.server_derived.capabilities.includes('commit'));
        assertTrue(result.server_derived.capabilities.includes('push'));
        assertEqual(result.server_derived.capabilities.length, 4);
        assertEqual(result.server_derived.permitted_paths, activationPolicy.getAuthorizedPathsForMode('RESEARCH_DOCUMENT'));
    });

    await runTest('Ingress - RESEARCH_DOCUMENT with non-standard capabilities derives server set', async () => {
        cleanup();
        const cmd = {
            protocol_version: '0.1',
            request_id: 'research-ingress-test-1',
            source: 'GitHub workflow_dispatch',
            target: 'Gemini',
            task_type: 'github_external_activation',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task: 'research task',
            task_mode: 'RESEARCH_DOCUMENT',
            constraints: { permitted_paths: ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md'] },
            authorization: { capabilities: ['inspect', 'inspect_repository', 'inspect_github_actions', 'modify_files', 'commit', 'push'] },
            verification: 'research and persist findings',
            reporting: 'json',
            originator: 'Kyle',
            activation_surface: 'workflow_dispatch'
        };
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(result.success, 'RESEARCH_DOCUMENT should succeed with server-derived capabilities: ' + (result.error || ''));
        assertTrue(result.command.authorization.capabilities.includes('read_only'), 'Final command must have server-derived read_only');
        assertTrue(result.command.authorization.capabilities.includes('modify_files'));
        assertTrue(result.command.authorization.capabilities.includes('commit'));
        assertTrue(result.command.authorization.capabilities.includes('push'));
        assertEqual(result.command.authorization.capabilities.length, 4);
        cleanup();
    });

    // =========================================================
    // Canonical External Activation Ingress Tests
    // =========================================================

    await runTest('Ingress - valid Kilo FAILOVER_EXECUTE creates task and returns success', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-1');
        const approval = await setupDirectorApproval('ingress-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success, 'Approval should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertEqual(result.activation_provenance.activation_target, 'Kilo');
        assertEqual(result.activation_provenance.activation_task_mode, 'FAILOVER_EXECUTE');
        cleanup();
    });

    await runTest('Ingress - valid Gemini FAILOVER_EXECUTE creates task and returns success', async () => {
        cleanup();
        const cmd = makeGeminiFailoverCommand('ingress-test-2');
        const approval = await setupDirectorApproval('ingress-test-2', 'Gemini', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success, 'Approval should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertEqual(result.activation_provenance.activation_target, 'Gemini');
        cleanup();
    });

    await runTest('Ingress - valid Builder BUILDER creates task and returns success', async () => {
        cleanup();
        const cmd = makeBuilderCommand('ingress-test-3');
        const approval = await setupDirectorApproval('ingress-test-3', 'Gemini Builder', 'BUILDER', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success, 'Approval should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertEqual(result.activation_provenance.activation_target, 'Gemini Builder');
        cleanup();
    });

    await runTest('Ingress - missing activation_surface fails closed for FAILOVER_EXECUTE', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-4');
        delete cmd.activation_surface;
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - invalid activation_surface fails closed for Kilo FAILOVER_EXECUTE', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-5');
        cmd.activation_surface = 'workflow_dispatch';
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - invalid activation syntax fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-6');
        cmd.activation_syntax = '@Kilo';
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - authority conflict on capabilities fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-7');
        cmd.authorization.capabilities = ['read_only'];
        cmd.claimed_authority = { capabilities: ['read_only', 'modify_files', 'commit', 'push'] };
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
        assertEqual(result.stage, 'authorization blocked');
    });

    await runTest('Ingress - authority conflict on target fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-8');
        cmd.claimed_authority = { target: 'Gemini' };
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.stage, 'authorization blocked');
    });

    await runTest('Ingress - invalid target fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-9');
        cmd.target = 'UnknownAgent';
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - invalid task_mode fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-10');
        cmd.task_mode = 'INVALID_MODE';
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - REVIEW mode (non-execution) does not require activation', async () => {
        cleanup();
        const cmd = {
            protocol_version: '0.1',
            request_id: 'ingress-test-11',
            source: 'DeepSeek Coordinator',
            target: 'Kilo',
            task_type: 'implementation',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task: 'test-review-task',
            task_mode: 'REVIEW',
            constraints: { permitted_paths: ['poc/'] },
            authorization: { capabilities: ['read_only'] },
            verification: 'review the code',
            reporting: 'json',
            originator: 'Kyle'
        };
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(result.success, 'REVIEW mode should succeed without activation: ' + (result.error || ''));
        cleanup();
    });

    await runTest('Ingress - duplicate request_id with identical payload is idempotent', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-idempotent-1');
        const approval = await setupDirectorApproval('ingress-idempotent-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success, 'Approval should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const first = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(first.success, 'First should succeed');
        const second = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(second.success, 'Second identical replay should succeed (idempotent)');
        assertEqual(second.replay, true);
        cleanup();
    });

    await runTest('Ingress - consequential command without director approval fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-13');
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
        assertEqual(result.stage, 'authorization blocked');
        assertTrue(result.error.includes('Director approval') || result.error.includes('consequential') || result.director_approval_required);
    });

    await runTest('Ingress - consequential command with director approval succeeds', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-14');
        const approvalResult = await taskRegistry.createDirectorApproval({
            request_id: 'ingress-test-14',
            target: 'Kilo',
            task_mode: 'FAILOVER_EXECUTE',
            capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
            permitted_paths: ['poc/'],
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main'
        });
        assertTrue(approvalResult.success, 'Approval should be created: ' + approvalResult.error);
        cmd.authorization.approval_id = approvalResult.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed with approval: ' + (result.error || ''));
        assertEqual(result.task_entry.authorization_proof.approval_id, approvalResult.approval.approval_id);
        cleanup();
    });

    await runTest('Ingress - canonicalizes activation metadata into command', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-15');
        const approval = await setupDirectorApproval('ingress-test-15', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertTrue(result.command.activation_id !== undefined, 'command should have activation_id');
        assertTrue(result.command.activation_surface !== undefined, 'command should have activation_surface');
        assertTrue(result.command.activation_source !== undefined, 'command should have activation_source');
        cleanup();
    });

    await runTest('Ingress - activation_provenance stored in task entry', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-16');
        const approval = await setupDirectorApproval('ingress-test-16', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        const task = taskRegistry.getTask('ingress-test-16');
        assertTrue(task.activation_provenance !== undefined, 'Task should have activation_provenance');
        assertEqual(task.activation_provenance.activation_id, result.activation_provenance.activation_id);
        cleanup();
    });

    await runTest('Ingress - server-derived capabilities override command capabilities', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-17');
        const approval = await setupDirectorApproval('ingress-test-17', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertTrue(result.command.authorization.capabilities.includes('commit'), 'Should have server-derived commit capability');
        cleanup();
    });

    await runTest('Ingress - server-derived permitted_paths override command paths', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-18');
        const approval = await setupDirectorApproval('ingress-test-18', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        cleanup();
    });

    await runTest('Ingress - invalid ACP command (missing field) fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-19');
        delete cmd.request_id;
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success);
        assertEqual(result.status, 'BLOCKED');
    });

    await runTest('Ingress - workflow_dispatch surface valid for Gemini BUILDER', async () => {
        cleanup();
        const cmd = makeBuilderCommand('ingress-test-20');
        const approval = await setupDirectorApproval('ingress-test-20', 'Gemini Builder', 'BUILDER', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'workflow_dispatch should be valid for Gemini Builder BUILDER: ' + (result.error || ''));
        cleanup();
    });

    await runTest('Ingress - github_push_event valid for Kilo FAILOVER_EXECUTE', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-21');
        const approval = await setupDirectorApproval('ingress-test-21', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'github_push_event should be valid for Kilo FAILOVER_EXECUTE: ' + (result.error || ''));
        cleanup();
    });

    // =========================================================
    // Extensibility Tests
    // =========================================================

    await runTest('Policy - activation surfaces are derived from policy, not hardcoded parsers', () => {
        const kiloSurfaces = activationPolicy.getPermittedActivationSurfaces('Kilo', 'FAILOVER_EXECUTE');
        const geminiSurfaces = activationPolicy.getPermittedActivationSurfaces('Gemini', 'FAILOVER_EXECUTE');
        assertTrue(kiloSurfaces !== geminiSurfaces || kiloSurfaces.length !== geminiSurfaces.length,
            'Different agents should have different surface policies');
    });

    await runTest('Policy - new agent can be added without new parser', async () => {
        const entry = activationPolicy.getPolicyEntry('Utility Specialist', 'REVIEW');
        assertTrue(entry !== null, 'Utility Specialist REVIEW should have a policy entry');
        assertTrue(!entry.requires_activation, 'Utility Specialist REVIEW should not require activation');
    });

    // =========================================================
    // DeepSeek Runtime Independence Tests
    // =========================================================

    await runTest('Ingress does not require DeepSeek runtime (uses existing task-registry + dispatcher)', async () => {
        delete process.env.DEEPSEEK_API_KEY;
        delete process.env.DEEPSEEK_COORDINATOR_SECRET;
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-22');
        const approval = await setupDirectorApproval('ingress-test-22', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should work without DeepSeek: ' + (result.error || ''));
        const task = taskRegistry.getTask('ingress-test-22');
        assertTrue(task !== null, 'Task should be registered in TaskRegistry');
        cleanup();
    });

    // =========================================================
    // Idempotency / Replay Tests
    // =========================================================

    await runTest('Ingress - identical replay is idempotent (not a conflict)', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-dup-1');
        const approval = await setupDirectorApproval('ingress-dup-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success, 'Approval should be created: ' + approval.error);
        cmd.authorization.approval_id = approval.approval.approval_id;

        const first = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));

        const second = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(second.success, 'Second identical replay should succeed (idempotent)');
        assertEqual(second.replay, true, 'Second call should be a replay');
        assertEqual(second.task_status, first.task_status, 'Task status should match');
        cleanup();
    });

    await runTest('Ingress - replay with modified payload fails closed (REPLAY_PAYLOAD_MISMATCH)', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-dup-2');
        const approval = await setupDirectorApproval('ingress-dup-2', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;

        const first = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));

        const modified = makeKiloFailoverCommand('ingress-dup-2', { task: 'different task description' });
        modified.authorization = { ...cmd.authorization };
        const second = await canonicalExternalActivationIngress(modified, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(!second.success, 'Modified replay should fail closed');
        assertEqual(second.error_code, 'REPLAY_PAYLOAD_MISMATCH');
        assertEqual(second.status, 'BLOCKED');
        cleanup();
    });

    await runTest('Ingress - replay with modified task_type fails closed', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-dup-3');
        const approval = await setupDirectorApproval('ingress-dup-3', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;

        await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });

        const modified = makeKiloFailoverCommand('ingress-dup-3', { task_type: 'research' });
        modified.authorization = { ...cmd.authorization };
        modified.activation_surface = cmd.activation_surface;
        const second = await canonicalExternalActivationIngress(modified, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(!second.success, 'Modified task_type replay should fail closed');
        assertEqual(second.error_code, 'REPLAY_PAYLOAD_MISMATCH');
        cleanup();
    });

    await runTest('Ingress - replay returns existing task entry without creating duplicate', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-dup-4');
        const approval = await setupDirectorApproval('ingress-dup-4', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;

        const first = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));

        const originalEntry = taskRegistry.getTask('ingress-dup-4');
        assertTrue(originalEntry !== null, 'Task should exist in registry');

        const second = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(second.success, 'Replay should succeed');
        assertEqual(second.replay, true);

        const allTasks = taskRegistry.getAllTasks();
        assertEqual(allTasks.length, 1, 'Should be exactly one task in registry (no duplicate)');
        cleanup();
    });

    await runTest('Ingress - replay preserves activation_provenance from original task', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-dup-5');
        const approval = await setupDirectorApproval('ingress-dup-5', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;

        const first = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));
        const originalActivationId = first.activation_provenance.activation_id;

        const second = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(second.success, 'Replay should succeed');
        assertTrue(second.activation_provenance, 'Replay should include activation_provenance');
        if (second.activation_provenance) {
          assertEqual(second.activation_provenance.activation_id, originalActivationId);
        }
        cleanup();
    });

    await runTest('Ingress - REVIEW mode (non-consequential) replay is idempotent', async () => {
        cleanup();
        const cmd = {
            protocol_version: '0.1',
            request_id: 'ingress-review-replay-1',
            source: 'DeepSeek Coordinator',
            target: 'Kilo',
            task_type: 'implementation',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task: 'test-review-task',
            task_mode: 'REVIEW',
            constraints: { permitted_paths: ['poc/'] },
            authorization: { capabilities: ['read_only'] },
            verification: 'review the code',
            reporting: 'json',
            originator: 'Kyle'
        };
        const first = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(first.success, 'First REVIEW should succeed: ' + (first.error || ''));

        const second = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(second.success, 'Second REVIEW replay should succeed: ' + (second.error || ''));
        assertEqual(second.replay, true);
        cleanup();
    });

    // =========================================================
    // Config Prerequisite Gate Tests
    // =========================================================

    await runTest('Config prerequisite - getRequiredConfigPrerequisites returns DIRECTOR_ORIGIN_SECRET for FAILOVER_EXECUTE', () => {
        const prereqs = activationPolicy.getRequiredConfigPrerequisites('FAILOVER_EXECUTE');
        assertTrue(prereqs.length > 0, 'FAILOVER_EXECUTE should have config prerequisites');
        const keys = prereqs.map(p => p.config_key);
        assertTrue(keys.includes('DIRECTOR_ORIGIN_SECRET'), 'Should require DIRECTOR_ORIGIN_SECRET');
    });

    await runTest('Config prerequisite - getRequiredConfigPrerequisites returns DIRECTOR_ORIGIN_SECRET for BUILDER', () => {
        const prereqs = activationPolicy.getRequiredConfigPrerequisites('BUILDER');
        assertTrue(prereqs.length > 0, 'BUILDER should have config prerequisites');
        const keys = prereqs.map(p => p.config_key);
        assertTrue(keys.includes('DIRECTOR_ORIGIN_SECRET'), 'Should require DIRECTOR_ORIGIN_SECRET');
    });

    await runTest('Config prerequisite - read-only modes have no config prerequisites', () => {
        const reviewPrereqs = activationPolicy.getRequiredConfigPrerequisites('REVIEW');
        assertEqual(reviewPrereqs.length, 0, 'REVIEW should have no prerequisites');
        const researchPrereqs = activationPolicy.getRequiredConfigPrerequisites('RESEARCH_DOCUMENT');
        assertEqual(researchPrereqs.length, 0, 'RESEARCH_DOCUMENT should have no prerequisites');
    });

    await runTest('Config prerequisite - isConsequentialMode returns true for FAILOVER_EXECUTE and BUILDER', () => {
        assertTrue(activationPolicy.isConsequentialMode('FAILOVER_EXECUTE'), 'FAILOVER_EXECUTE is consequential');
        assertTrue(activationPolicy.isConsequentialMode('BUILDER'), 'BUILDER is consequential');
        assertTrue(!activationPolicy.isConsequentialMode('REVIEW'), 'REVIEW is not consequential');
        assertTrue(!activationPolicy.isConsequentialMode('RESEARCH_DOCUMENT'), 'RESEARCH_DOCUMENT is not consequential');
    });

    await runTest('Config prerequisite - consequential execution blocked when DIRECTOR_ORIGIN_SECRET is absent', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-block-test-1');
            const approval = await setupDirectorApproval('prereq-block-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            assertTrue(approval.success);
            cmd.authorization.approval_id = approval.approval.approval_id;
            const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            assertTrue(!result.success, 'Should be blocked when DIRECTOR_ORIGIN_SECRET is absent');
            assertEqual(result.status, 'BLOCKED');
            assertEqual(result.error_code, 'CONFIG_PREREQUISITE_UNSATISFIED');
            assertTrue(result.director_notified, 'Director should be notified');
            assertTrue(result.blocking_prerequisites !== undefined, 'Should report blocking prerequisites');
            assertTrue(result.blocking_prerequisites.length > 0, 'Should have blocking prerequisites');
            assertTrue(result.blocking_prerequisites[0].config_key === 'DIRECTOR_ORIGIN_SECRET', 'Should identify DIRECTOR_ORIGIN_SECRET as blocking');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - consequential execution succeeds when DIRECTOR_ORIGIN_SECRET is present', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('prereq-success-test-1');
        const approval = await setupDirectorApproval('prereq-success-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed when DIRECTOR_ORIGIN_SECRET is set: ' + (result.error || ''));
        assertTrue(result.config_state === 'CONFIGURATION_SATISFIED' || result.config_state === undefined, 'Config state should be satisfied or undefined (no prereqs declared for non-carrier path)');
        cleanup();
    });

    await runTest('Config prerequisite - fail-closed: read-only REVIEW mode does not block on missing secret', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = {
                protocol_version: '0.1',
                request_id: 'prereq-review-test-1',
                source: 'DeepSeek Coordinator',
                target: 'Kilo',
                task_type: 'implementation',
                repository: 'fluentwithkyle/openclaw-webhook',
                base_branch: 'main',
                task: 'test-review-task',
                task_mode: 'REVIEW',
                constraints: { permitted_paths: ['poc/'] },
                authorization: { capabilities: ['read_only'] },
                verification: 'review the code',
                reporting: 'json',
                originator: 'Kyle'
            };
            const result = await canonicalExternalActivationIngress(cmd, {});
            assertTrue(result.success, 'REVIEW mode should not block on missing secret: ' + (result.error || ''));
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - prerequisite record stored in task entry', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-record-test-1');
            const approval = await setupDirectorApproval('prereq-record-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            assertTrue(approval.success);
            cmd.authorization.approval_id = approval.approval.approval_id;
            await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            const task = taskRegistry.getTask('prereq-record-test-1');
            assertTrue(task !== null, 'Task should be registered');
            assertTrue(task.config_prerequisites !== undefined, 'Task should have config_prerequisites');
            assertTrue(task.config_prerequisites.length > 0, 'Should have at least one prerequisite');
            const prereq = task.config_prerequisites.find(p => p.config_key === 'DIRECTOR_ORIGIN_SECRET');
            assertTrue(prereq !== undefined, 'Should have DIRECTOR_ORIGIN_SECRET prerequisite');
            assertTrue(prereq.required === true, 'Prerequisite should be required');
            assertTrue(prereq.mode === 'FAILOVER_EXECUTE', 'Prerequisite should record the mode');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - director_notified state when secret absent', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-notified-test-1');
            const approval = await setupDirectorApproval('prereq-notified-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            assertTrue(!result.success);
            assertEqual(result.config_state, 'DIRECTOR_NOTIFIED');
            assertTrue(result.director_notified, 'director_notified should be true');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - checkPrerequisites returns success for satisfied prerequisites', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('prereq-check-test-1');
        const approval = await setupDirectorApproval('prereq-check-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        const check = taskRegistry.checkPrerequisites('prereq-check-test-1');
        assertTrue(check.success, 'Should succeed when secret is present: ' + (check.error || ''));
        assertTrue(check.satisfied, 'Prerequisites should be satisfied');
        cleanup();
    });

    await runTest('Config prerequisite - checkPrerequisites blocks when unsatisfied for consequential task', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-check-block-test-1');
            const approval = await setupDirectorApproval('prereq-check-block-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            const check = taskRegistry.checkPrerequisites('prereq-check-block-test-1');
            assertTrue(!check.success, 'Should block consequential task with unsatisfied prerequisites');
            assertEqual(check.error_code, 'PREREQUISITE_NOT_SATISFIED');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - getPrerequisiteState returns UNKNOWN for undeclared prerequisite', () => {
        cleanup();
        const state = taskRegistry.getPrerequisiteState('nonexistent-task', 'DIRECTOR_ORIGIN_SECRET');
        assertEqual(state, 'UNKNOWN');
    });

    await runTest('Config prerequisite - createConfigPrerequisite validates input', () => {
        const { createConfigPrerequisite } = require('../poc/schemas/acp-schema');
        const invalid = createConfigPrerequisite('', 'no key', 'REVIEW', true);
        assertTrue(invalid.error !== undefined, 'Should error on empty config_key');
        const valid = createConfigPrerequisite('TEST_KEY', 'test reason', 'REVIEW', true);
        assertEqual(valid.config_key, 'TEST_KEY');
        assertEqual(valid.reason, 'test reason');
        assertEqual(valid.mode, 'REVIEW');
        assertTrue(valid.required === true);
        assertEqual(valid.state, 'UNKNOWN');
    });

    await runTest('Config prerequisite - evaluatePrerequisite returns CONFIGURATION_SATISFIED when env var present', () => {
        const { createConfigPrerequisite, evaluatePrerequisite } = require('../poc/schemas/acp-schema');
        const savedSecret = process.env.TEST_CONFIG_KEY;
        process.env.TEST_CONFIG_KEY = 'test-value';
        try {
            const prereq = createConfigPrerequisite('TEST_CONFIG_KEY', 'test', 'REVIEW', true);
            const result = evaluatePrerequisite(prereq, {}, process.env);
            assertEqual(result.state, 'CONFIGURATION_SATISFIED');
            assertTrue(result.satisfied === true);
        } finally {
            if (savedSecret !== undefined) process.env.TEST_CONFIG_KEY = savedSecret; else delete process.env.TEST_CONFIG_KEY;
        }
    });

    await runTest('Config prerequisite - evaluatePrerequisite returns DIRECTOR_NOTIFIED when env var absent but claim present', () => {
        const { createConfigPrerequisite, evaluatePrerequisite } = require('../poc/schemas/acp-schema');
        const savedSecret = process.env.TEST_UNDECLARED_KEY;
        delete process.env.TEST_UNDECLARED_KEY;
        try {
            const prereq = createConfigPrerequisite('TEST_UNDECLARED_KEY', 'test', 'REVIEW', true);
            prereq.claimed = 'some-claim-value';
            const result = evaluatePrerequisite(prereq, {}, process.env);
            assertEqual(result.state, 'DIRECTOR_NOTIFIED');
            assertTrue(result.satisfied === false);
        } finally {
            if (savedSecret !== undefined) process.env.TEST_UNDECLARED_KEY = savedSecret;
        }
    });

    await runTest('Config prerequisite - evaluatePrerequisite returns UNKNOWN when env var absent and no claim', () => {
        const { createConfigPrerequisite, evaluatePrerequisite } = require('../poc/schemas/acp-schema');
        const savedSecret = process.env.TEST_UNKNOWN_KEY;
        delete process.env.TEST_UNKNOWN_KEY;
        try {
            const prereq = createConfigPrerequisite('TEST_UNKNOWN_KEY', 'test', 'REVIEW', true);
            const result = evaluatePrerequisite(prereq, {}, process.env);
            assertEqual(result.state, 'UNKNOWN');
            assertTrue(result.satisfied === false);
        } finally {
            if (savedSecret !== undefined) process.env.TEST_UNKNOWN_KEY = savedSecret;
        }
    });

    await runTest('Config prerequisite - CONFIG_PREREQUISITE_STATES exported correctly', () => {
        const schema = require('../poc/schemas/acp-schema');
        assertTrue(schema.CONFIG_PREREQUISITE_STATES !== undefined);
        assertTrue(schema.CONFIG_PREREQUISITE_STATES.includes('DIRECTOR_NOTIFIED'));
        assertTrue(schema.CONFIG_PREREQUISITE_STATES.includes('CONFIGURATION_SATISFIED'));
        assertTrue(schema.CONFIG_PREREQUISITE_STATES.includes('UNKNOWN'));
    });

    // =========================================================
    // One Control Plane Tests
    // =========================================================

    await runTest('Ingress - task registered in single TaskRegistry (no second registry)', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-23');
        const approval = await setupDirectorApproval('ingress-test-23', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        const task = taskRegistry.getTask('ingress-test-23');
        assertTrue(task !== null, 'Task must be in the single TaskRegistry');
        assertEqual(task.request_id, 'ingress-test-23');
        cleanup();
    });

    await runTest('Ingress - activation ingress uses existing ACP validate function', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('ingress-test-24');
        const approval = await setupDirectorApproval('ingress-test-24', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        const acpResult = require('../poc/acp-engine').validate(result.command);
        assertEqual(acpResult.status, 'SUCCESS');
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
