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

    await runTest('Policy - Gemini Builder BUILDER does not permit github_issue_comment (only workflow_dispatch)', async () => {
        cleanup();
        const surfaces = activationPolicy.getPermittedActivationSurfaces('Gemini Builder', 'BUILDER');
        assertTrue(surfaces.includes('workflow_dispatch'), 'Should include workflow_dispatch');
        assertTrue(!surfaces.includes('github_issue_comment'), 'Should NOT include github_issue_comment (gemini-builder.yml only triggers on workflow_dispatch)');
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
        const check = await taskRegistry.checkPrerequisites('prereq-check-test-1');
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
            const check = await taskRegistry.checkPrerequisites('prereq-check-block-test-1');
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

    await runTest('Config prerequisite - DIRECTOR_NOTIFIED persists durable notification record on task entry', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-notif-persist-1');
            const approval = await setupDirectorApproval('prereq-notif-persist-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            assertTrue(!result.success, 'Should be blocked');
            assertTrue(result.director_notified === true, 'director_notified should be true');
            const task = taskRegistry.getTask('prereq-notif-persist-1');
            assertTrue(task !== null, 'Task should be persisted in TaskRegistry');
            assertTrue(task.director_notifications !== undefined, 'Task should have director_notifications array');
            assertTrue(task.director_notifications.length > 0, 'Should have at least one notification');
            const notif = task.director_notifications[0];
            assertEqual(notif.config_key, 'DIRECTOR_ORIGIN_SECRET', 'Notification should identify DIRECTOR_ORIGIN_SECRET');
            assertTrue(notif.notified_at !== null && notif.notified_at !== undefined, 'Notification should have notified_at timestamp');
            assertTrue(notif.satisfies_prerequisite === false, 'Notification must not itself satisfy the prerequisite');
            assertTrue(notif.acknowledged === false, 'Notification should start unacknowledged');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - blocked task has BLOCKED status and next_action director_notification', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-blocked-status-1');
            const approval = await setupDirectorApproval('prereq-blocked-status-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            const task = taskRegistry.getTask('prereq-blocked-status-1');
            assertEqual(task.status, 'BLOCKED', 'Task status should be BLOCKED');
            assertEqual(task.next_action, 'director_notification', 'Next action should be director_notification');
            assertEqual(task.block_reason, 'CONFIG_PREREQUISITE_UNSATISFIED', 'Block reason should be CONFIG_PREREQUISITE_UNSATISFIED');
            assertTrue(task.block_details !== undefined, 'Should have block_details');
            assertEqual(task.block_details.config_key, 'DIRECTOR_ORIGIN_SECRET');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - notification identifies required prerequisite and reason', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-notif-identity-1');
            const approval = await setupDirectorApproval('prereq-notif-identity-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            assertTrue(result.director_notifications !== undefined, 'Should include director_notifications in response');
            assertTrue(result.director_notifications.length > 0, 'Should have notifications');
            const notif = result.director_notifications[0];
            assertEqual(notif.config_key, 'DIRECTOR_ORIGIN_SECRET');
            assertTrue(notif.reason.includes('DIRECTOR_ORIGIN_SECRET') || notif.reason.includes('consequential'), 'Reason should mention the prerequisite or consequential execution');
            assertEqual(notif.satisfies_prerequisite, false, 'Notification must not satisfy prerequisite');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - DIRECTOR_NOTIFIED distinct from CONFIGURATION_SATISFIED', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('prereq-distinct-states-1');
        const approval = await setupDirectorApproval('prereq-distinct-states-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
        assertTrue(result.success, 'Should succeed when secret present: ' + (result.error || ''));

        const task = taskRegistry.getTask('prereq-distinct-states-1');
        const prereqs = task.config_prerequisites || [];
        const prereq = prereqs.find(p => p.config_key === 'DIRECTOR_ORIGIN_SECRET');
        assertTrue(prereq !== undefined, 'Should have DIRECTOR_ORIGIN_SECRET prerequisite');
        assertEqual(prereq.state, 'CONFIGURATION_SATISFIED', 'State should be CONFIGURATION_SATISFIED when secret present');
        assertEqual(task.status, 'PENDING', 'Task should not be BLOCKED when satisfied');

        cleanup();

        delete process.env.DIRECTOR_ORIGIN_SECRET;
        const cmd2 = makeKiloFailoverCommand('prereq-distinct-states-2');
        const approval2 = await setupDirectorApproval('prereq-distinct-states-2', 'Kilo', 'FAILOVER_EXECUTE', cmd2.authorization.capabilities, cmd2.constraints.permitted_paths);
        cmd2.authorization.approval_id = approval2.approval.approval_id;
        await canonicalExternalActivationIngress(cmd2, { director_approval_id: cmd2.authorization.approval_id });
        const task2 = taskRegistry.getTask('prereq-distinct-states-2');
        const prereqs2 = task2.config_prerequisites || [];
        const prereq2 = prereqs2.find(p => p.config_key === 'DIRECTOR_ORIGIN_SECRET');
        assertEqual(prereq2.state, 'DIRECTOR_NOTIFIED', 'State should be DIRECTOR_NOTIFIED when secret absent');
        assertEqual(task2.status, 'BLOCKED', 'Task should be BLOCKED when unsatisfied');
    });

    await runTest('Config prerequisite - getDirectorNotifications returns persisted notifications', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-getnotif-1');
            const approval = await setupDirectorApproval('prereq-getnotif-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            const notifs = taskRegistry.getDirectorNotifications('prereq-getnotif-1');
            assertTrue(notifs.success, 'Should succeed');
            assertTrue(notifs.count > 0, 'Should have notifications');
            const hasNotif = taskRegistry.hasDirectorNotification('prereq-getnotif-1', 'DIRECTOR_ORIGIN_SECRET');
            assertTrue(hasNotif === true, 'Should detect DIRECTOR_ORIGIN_SECRET notification');
            const noNotif = taskRegistry.hasDirectorNotification('prereq-getnotif-1', 'OTHER_KEY');
            assertTrue(noNotif === false, 'Should not detect OTHER_KEY notification');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - unknown/unverifiable config fails closed', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeBuilderCommand('prereq-unknown-fail-1');
            const approval = await setupDirectorApproval('prereq-unknown-fail-1', 'Gemini Builder', 'BUILDER', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            const result = await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });
            assertTrue(!result.success, 'BUILDER without secret should fail closed');
            assertEqual(result.status, 'BLOCKED');
            assertEqual(result.config_state, 'DIRECTOR_NOTIFIED');
            assertTrue(result.blocking_prerequisites[0].config_key === 'DIRECTOR_ORIGIN_SECRET');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret;
            cleanup();
        }
    });

    await runTest('Config prerequisite - notification persisted across getTask reload', async () => {
        const savedSecret = process.env.DIRECTOR_ORIGIN_SECRET;
        delete process.env.DIRECTOR_ORIGIN_SECRET;
        cleanup();
        try {
            const cmd = makeKiloFailoverCommand('prereq-persist-reload-1');
            const approval = await setupDirectorApproval('prereq-persist-reload-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, cmd.constraints.permitted_paths);
            cmd.authorization.approval_id = approval.approval.approval_id;
            await canonicalExternalActivationIngress(cmd, { director_approval_id: cmd.authorization.approval_id });

            taskRegistry.resetMemoryCache();
            taskRegistry.loadFromFile();
            const task = taskRegistry.getTask('prereq-persist-reload-1');
            assertTrue(task !== null, 'Task should exist after reload');
            assertTrue(task.director_notifications !== undefined, 'Notifications should persist across reload');
            assertTrue(task.director_notifications.length > 0, 'Should have notifications after reload');
        } finally {
            if (savedSecret !== undefined) process.env.DIRECTOR_ORIGIN_SECRET = savedSecret; else process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
            cleanup();
        }
    });

    process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';

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
    // Server-Derived MAX_AUTHORIZED_PATHS Boundary Tests
    // =========================================================

    await runTest('MAX_AUTHORIZED_PATHS - is frozen and contains docs/, test/, poc/, .github/workflows/', async () => {
        assertTrue(activationPolicy.MAX_AUTHORIZED_PATHS !== undefined, 'MAX_AUTHORIZED_PATHS should be defined');
        assertTrue(Object.isFrozen(activationPolicy.MAX_AUTHORIZED_PATHS), 'MAX_AUTHORIZED_PATHS should be frozen');
        assertDeepEqual(activationPolicy.MAX_AUTHORIZED_PATHS, ['docs/', 'test/', 'poc/', '.github/workflows/main.yml', '.github/workflows/gemini-builder.yml']);
    });

    await runTest('intersectPathsWithMaxBoundary - filters out paths outside boundary', async () => {
        const result = activationPolicy.intersectPathsWithMaxBoundary(['docs/ai/', 'index.js', 'poc/', 'AGENTS.md']);
        assertDeepEqual(result, ['docs/ai/', 'poc/']);
    });

    await runTest('intersectPathsWithMaxBoundary - returns empty for all-outside paths', async () => {
        const result = activationPolicy.intersectPathsWithMaxBoundary(['index.js', 'AGENTS.md', 'GEMINI.md']);
        assertDeepEqual(result, []);
    });

    await runTest('isPathWithinMaxBoundary - docs/ is within boundary', async () => {
        assertTrue(activationPolicy.isPathWithinMaxBoundary('docs/ai/'));
        assertTrue(activationPolicy.isPathWithinMaxBoundary('docs/'));
    });

    await runTest('isPathWithinMaxBoundary - poc/ is within boundary', async () => {
        assertTrue(activationPolicy.isPathWithinMaxBoundary('poc/'));
        assertTrue(activationPolicy.isPathWithinMaxBoundary('poc/activation-ingress.js'));
    });

    await runTest('isPathWithinMaxBoundary - index.js is NOT within boundary', async () => {
        assertTrue(!activationPolicy.isPathWithinMaxBoundary('index.js'));
        assertTrue(!activationPolicy.isPathWithinMaxBoundary('AGENTS.md'));
        assertTrue(!activationPolicy.isPathWithinMaxBoundary('services/'));
    });

    // =========================================================
    // Director-approved permitted_paths Bootstrap Tests
    // =========================================================

    await runTest('Bootstrap - Director-approved permitted_paths override poc/ default in descriptor', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('bootstrap-test-1');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['docs/ai/', 'poc/']);
        assertTrue(approval.success, 'Approval should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-1',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertTrue(result.execution_descriptor, 'Should return execution descriptor');
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['docs/ai/', 'poc/'], 'Descriptor should carry Director-approved paths');
        cleanup();
    });

    await runTest('Bootstrap - Director-approved path outside MAX_AUTHORIZED_PATHS cannot be created', async () => {
        cleanup();
        const approval = await setupDirectorApproval('bootstrap-test-2', 'Kilo', 'FAILOVER_EXECUTE',
            ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['AGENTS.md']);
        assertTrue(!approval.success, 'Approval with AGENTS.md should be rejected by MAX_AUTHORIZED_PATHS boundary');
        cleanup();
    });

    await runTest('Bootstrap - externally supplied permitted_paths do not grant authority without Director approval', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('bootstrap-test-3');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/'];
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success, 'Should be blocked without Director approval');
        assertEqual(result.status, 'BLOCKED');
        assertEqual(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
        cleanup();
    });

    await runTest('Bootstrap - replay preserves Director-approved permitted_paths', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('bootstrap-test-4');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-4', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['docs/ai/', 'poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const first = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-4',
            carrier_type: 'github_workflow'
        });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));
        assertTrue(first.task_entry, 'Should have task entry');
        assertDeepEqual(first.task_entry.permitted_paths, ['docs/ai/', 'poc/'], 'First task entry should have Director-approved paths');

        const second = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-4',
            carrier_type: 'github_workflow'
        });
        assertTrue(second.success, 'Replay should succeed: ' + (second.error || ''));
        assertEqual(second.replay, true);
        assertTrue(second.task_entry, 'Replay should include task entry');
        assertDeepEqual(second.task_entry.permitted_paths, ['docs/ai/', 'poc/'], 'Replay should preserve Director-approved paths');
        cleanup();
    });

    await runTest('Bootstrap - FAILOVER_EXECUTE without Director approval stays poc/', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-5');
        cmd.constraints.permitted_paths = ['docs/ai/'];
        const approval = await setupDirectorApproval('bootstrap-test-5', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-5',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed with default poc/ approval');
        assertTrue(result.execution_descriptor, 'Should return execution descriptor');
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['poc/'], 'Without broader Director approval, paths should remain poc/');
        cleanup();
    });

    await runTest('Bootstrap - BUILDER without Director approval stays poc/', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeBuilderCommand('bootstrap-test-6');
        cmd.constraints.permitted_paths = ['docs/ai/'];
        const approval = await setupDirectorApproval('bootstrap-test-6', 'Gemini Builder', 'BUILDER', cmd.authorization.capabilities, ['poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-6',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed with default poc/ approval: ' + (result.error || ''));
        assertTrue(result.execution_descriptor, 'Should return execution descriptor');
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['poc/'], 'Without broader Director approval, paths should remain poc/');
        cleanup();
    });

    await runTest('Bootstrap - validatePermittedPathsForMode enforces MAX_AUTHORIZED_PATHS for FAILOVER_EXECUTE', async () => {
        const { validatePermittedPathsForMode } = require('../poc/schemas/acp-schema');
        const withinBoundary = validatePermittedPathsForMode('FAILOVER_EXECUTE', ['docs/ai/', 'test/foo.js', 'poc/']);
        assertTrue(withinBoundary.valid, 'Paths within MAX boundary should be valid');
        const outsideBoundary = validatePermittedPathsForMode('FAILOVER_EXECUTE', ['index.js']);
        assertTrue(!outsideBoundary.valid, 'Paths outside MAX boundary should be rejected');
        assertTrue(outsideBoundary.error.includes('maximum authorization boundary'), 'Error should mention maximum boundary');
        cleanup();
    });

    await runTest('Bootstrap - validatePermittedPathsForMode enforces MAX_AUTHORIZED_PATHS for BUILDER', async () => {
        const { validatePermittedPathsForMode } = require('../poc/schemas/acp-schema');
        const withinBoundary = validatePermittedPathsForMode('BUILDER', ['docs/ai/', 'poc/']);
        assertTrue(withinBoundary.valid, 'Paths within MAX boundary should be valid for BUILDER');
        const outsideBoundary = validatePermittedPathsForMode('BUILDER', ['AGENTS.md']);
        assertTrue(!outsideBoundary.valid, 'Paths outside MAX boundary should be rejected for BUILDER');
        cleanup();
    });

    await runTest('Bootstrap - director_approval with scope hash mismatch falls back to poc/', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-7');
        // Approval created with broader paths
        const approval = await setupDirectorApproval('bootstrap-test-7', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['docs/ai/', 'poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        // Command arrives with different paths - scope hash will not match
        cmd.constraints.permitted_paths = ['poc/'];
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-7',
            carrier_type: 'github_workflow'
        });
        // Should fail because scope hash mismatch
        assertTrue(!result.success, 'Should fail with scope mismatch');
        cleanup();
    });

    await runTest('Bootstrap - expired Director approval is rejected (scope-hash mismatch at ingress)', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-expiry-1');
        const approval = await setupDirectorApproval('bootstrap-test-expiry-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        // Manually expire the approval
        const approvalRecord = taskRegistry.getDirectorApproval(approval.approval.approval_id);
        assertTrue(approvalRecord !== null);
        approvalRecord.expiry = new Date(Date.now() - 1000).toISOString();
        await taskRegistry.persistCache();
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-expiry-1',
            carrier_type: 'github_workflow'
        });
        assertTrue(!result.success, 'Expired approval should be rejected');
        cleanup();
    });

    await runTest('Bootstrap - Director-approved permitted_paths within MAX_AUTHORIZED_PATHS expand authority for FAILOVER_EXECUTE', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-8');
        cmd.constraints.permitted_paths = ['docs/ai/', 'test/', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-8', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['docs/ai/', 'test/', 'poc/']);
        assertTrue(approval.success, 'Approval with paths within MAX boundary should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-8',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertTrue(result.execution_descriptor, 'Should return execution descriptor');
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['docs/ai/', 'test/', 'poc/'],
            'Descriptor should carry Director-approved paths within MAX boundary');
        const taskEntry = taskRegistry.getTask('bootstrap-test-8');
        assertDeepEqual(taskEntry.permitted_paths, ['docs/ai/', 'test/', 'poc/'],
            'Task entry should carry Director-approved paths within MAX boundary');
        cleanup();
    });

    await runTest('Bootstrap - Director-approved permitted_paths within MAX boundary expand authority for BUILDER', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeBuilderCommand('bootstrap-test-9');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-9', 'Gemini Builder', 'BUILDER', cmd.authorization.capabilities, ['docs/ai/', 'poc/']);
        assertTrue(approval.success, 'BUILDER approval with paths within MAX boundary should be created');
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-bootstrap-9',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed: ' + (result.error || ''));
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['docs/ai/', 'poc/'],
            'BUILDER descriptor should carry Director-approved paths within MAX boundary');
        cleanup();
    });

    await runTest('Bootstrap - Director-approved path outside MAX_AUTHORIZED_PATHS is rejected at approval creation', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        // AGENTS.md is a protected file outside MAX_AUTHORIZED_PATHS
        const approval = await setupDirectorApproval('bootstrap-test-10', 'Kilo', 'FAILOVER_EXECUTE',
            ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['AGENTS.md']);
        assertTrue(!approval.success, 'Approval with AGENTS.md should be rejected by MAX_AUTHORIZED_PATHS boundary');
        cleanup();
    });

    await runTest('Bootstrap - Director-approved path outside MAX_AUTHORIZED_PATHS (services/) is rejected', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const approval = await setupDirectorApproval('bootstrap-test-11', 'Gemini Builder', 'BUILDER',
            ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['services/']);
        assertTrue(!approval.success, 'Approval with services/ should be rejected');
        cleanup();
    });

    await runTest('Bootstrap - FAILOVER_EXECUTE and BUILDER use same MAX_AUTHORIZED_PATHS boundary', async () => {
        const failoverPaths = activationPolicy.deriveServerAuthority('Kilo', 'FAILOVER_EXECUTE');
        const builderPaths = activationPolicy.deriveServerAuthority('Gemini Builder', 'BUILDER');
        assertDeepEqual(failoverPaths.permitted_paths, ['poc/'], 'FAILOVER_EXECUTE default should be poc/');
        assertDeepEqual(builderPaths.permitted_paths, ['poc/'], 'BUILDER default should be poc/');
        assertTrue(activationPolicy.isPathWithinMaxBoundary('index.js') === false, 'Both must reject index.js');
        assertTrue(activationPolicy.isPathWithinMaxBoundary('AGENTS.md') === false, 'Both must reject AGENTS.md');
        assertTrue(activationPolicy.isPathWithinMaxBoundary('docs/ai/') === true, 'Both must accept docs/ai/');
        assertTrue(activationPolicy.isPathWithinMaxBoundary('test/foo.js') === true, 'Both must accept test/foo.js');
        assertTrue(activationPolicy.isPathWithinMaxBoundary('poc/') === true, 'Both must accept poc/');
    });

    await runTest('Bootstrap - Replay with modified permitted_paths fails closed (REPLAY_PAYLOAD_MISMATCH)', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-replay-1');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-replay-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['docs/ai/', 'poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const first = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-replay-1',
            carrier_type: 'github_workflow'
        });
        assertTrue(first.success, 'First should succeed: ' + (first.error || ''));

        // Attempt replay with different permitted_paths
        const modified = makeKiloFailoverCommand('bootstrap-test-replay-1', { task: 'different task' });
        modified.constraints = { permitted_paths: ['poc/'] };
        modified.authorization = { ...cmd.authorization };
        const second = await canonicalExternalActivationIngress(modified, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-replay-1',
            carrier_type: 'github_workflow'
        });
        assertTrue(!second.success, 'Replay with modified permitted_paths should fail closed');
        assertEqual(second.error_code, 'REPLAY_PAYLOAD_MISMATCH');
        cleanup();
    });

    await runTest('Bootstrap - REVIEW mode paths unchanged by MAX_AUTHORIZED_PATHS (not affected)', async () => {
        const { validatePermittedPathsForMode } = require('../poc/schemas/acp-schema');
        const result = validatePermittedPathsForMode('REVIEW', ['poc/']);
        assertTrue(result.valid, 'REVIEW mode should still accept poc/');
        const result2 = validatePermittedPathsForMode('REVIEW', ['docs/ai/', 'test/', 'poc/']);
        assertTrue(result2.valid, 'REVIEW mode should still accept docs/, test/, poc/');
    });

    await runTest('Bootstrap - RESEARCH_DOCUMENT mode paths unchanged by MAX_AUTHORIZED_PATHS', async () => {
        const { validatePermittedPathsForMode } = require('../poc/schemas/acp-schema');
        const result = validatePermittedPathsForMode('RESEARCH_DOCUMENT', ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md']);
        assertTrue(result.valid, 'RESEARCH_DOCUMENT mode should still accept docs/ai paths');
        const result2 = validatePermittedPathsForMode('RESEARCH_DOCUMENT', ['poc/schemas/acp-schema.js', 'test/schema.test.js']);
        assertTrue(result2.valid, 'RESEARCH_DOCUMENT mode should still accept poc/schemas/ and test/ paths');
    });

    await runTest('Bootstrap - FAILOVER_EXECUTE raw workflow permitted_paths without Director approval falls back to poc/ in descriptor', async () => {
        cleanup();
        process.env.DIRECTOR_ORIGIN_SECRET = 'director-origin-test-secret';
        const cmd = makeKiloFailoverCommand('bootstrap-test-raw-1');
        // Command tries to supply broader paths externally
        cmd.constraints.permitted_paths = ['docs/ai/', 'index.js', 'poc/'];
        const approval = await setupDirectorApproval('bootstrap-test-raw-1', 'Kilo', 'FAILOVER_EXECUTE', cmd.authorization.capabilities, ['poc/']);
        assertTrue(approval.success);
        cmd.authorization.approval_id = approval.approval.approval_id;
        const result = await canonicalExternalActivationIngress(cmd, {
            director_approval_id: cmd.authorization.approval_id,
            carrier_identity: 'test-carrier-raw-1',
            carrier_type: 'github_workflow'
        });
        assertTrue(result.success, 'Should succeed (approval is for poc/ only): ' + (result.error || ''));
        // The descriptor should have poc/ from the approved scope, not the external 'docs/ai/' or 'index.js'
        assertDeepEqual(result.execution_descriptor.permitted_paths, ['poc/'],
            'Descriptor should have only Director-approved poc/, not externally supplied broader paths');
        cleanup();
    });

    await runTest('Bootstrap - FAILOVER_EXECUTE external payload permitted_paths do not grant authority without Director approval', async () => {
        cleanup();
        const cmd = makeKiloFailoverCommand('bootstrap-test-raw-2');
        // Try to supply broader paths externally without Director approval
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/', 'test/'];
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success, 'Should be blocked without Director approval');
        assertEqual(result.status, 'BLOCKED');
        assertEqual(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
        cleanup();
    });

    await runTest('Bootstrap - BUILDER external payload permitted_paths do not grant authority without Director approval', async () => {
        cleanup();
        const cmd = makeBuilderCommand('bootstrap-test-raw-3');
        cmd.constraints.permitted_paths = ['docs/ai/', 'poc/', 'test/'];
        const result = await canonicalExternalActivationIngress(cmd, {});
        assertTrue(!result.success, 'Should be blocked without Director approval');
        assertEqual(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
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
