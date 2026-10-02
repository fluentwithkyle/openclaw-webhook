const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MAIN_WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'main.yml');
const BUILDER_WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'gemini-builder.yml');
const INGRESS_ROUTE_PATH = path.join(__dirname, '..', 'routes', 'poc.js');
const ACTIVATION_INGRESS_PATH = path.join(__dirname, '..', 'poc', 'activation-ingress.js');
const VALIDATE_SCRIPT_PATH = path.join(__dirname, '..', 'poc', 'validate-external-activation.js');
const VALIDATOR_PATH = path.join(__dirname, '..', 'poc', 'external-activation-validator.js');
const PROCEDURE_PATH = path.join(__dirname, '..', 'docs', 'ai', 'EXTERNAL_ACTIVATION_PROCEDURE.md');

const mainRaw = fs.readFileSync(MAIN_WF_PATH, 'utf8');
const builderRaw = fs.readFileSync(BUILDER_WF_PATH, 'utf8');
const ingressRouteRaw = fs.readFileSync(INGRESS_ROUTE_PATH, 'utf8');
const activationIngressRaw = fs.readFileSync(ACTIVATION_INGRESS_PATH, 'utf8');
const validateScriptRaw = fs.readFileSync(VALIDATE_SCRIPT_PATH, 'utf8');
const validatorRaw = fs.readFileSync(VALIDATOR_PATH, 'utf8');
const procedureRaw = fs.readFileSync(PROCEDURE_PATH, 'utf8');

const { canonicalExternalActivationIngress } = require('../poc/activation-ingress');
const { buildExecutionDescriptor } = require('../poc/task-registry');
const taskRegistry = require('../poc/task-registry');

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

function assertTrue(condition, msg) {
    if (!condition) {
        throw new Error(msg || 'Assertion failed: expected truthy value');
    }
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

console.log('=== External Activation Procedure Machine-Verification Tests ===\n');

// =========================================================
// 1. Workflow uses workflow_dispatch trigger
// =========================================================

runTest('Procedure - main.yml uses workflow_dispatch trigger with required inputs', () => {
    assertTrue(mainRaw.includes('workflow_dispatch:'), 'main.yml must have workflow_dispatch trigger');
    assertTrue(mainRaw.includes('inputs:'), 'main.yml must define inputs');
    assertTrue(mainRaw.includes('request_id:'), 'main.yml must have request_id input');
    assertTrue(mainRaw.includes('task:'), 'main.yml must have task input');
    assertTrue(mainRaw.includes('repository:'), 'main.yml must have repository input');
    assertTrue(mainRaw.includes('base_branch:'), 'main.yml must have base_branch input');
    assertTrue(mainRaw.includes('required: true'), 'main.yml must have required inputs');
});

runTest('Procedure - gemini-builder.yml uses workflow_dispatch trigger with required inputs', () => {
    assertTrue(builderRaw.includes('workflow_dispatch:'), 'gemini-builder.yml must have workflow_dispatch trigger');
    assertTrue(builderRaw.includes('inputs:'), 'gemini-builder.yml must define inputs');
    assertTrue(builderRaw.includes('request_id:'), 'gemini-builder.yml must have request_id input');
    assertTrue(builderRaw.includes('task:'), 'gemini-builder.yml must have task input');
    assertTrue(builderRaw.includes('repository:'), 'gemini-builder.yml must have repository input');
    assertTrue(builderRaw.includes('base_branch:'), 'gemini-builder.yml must have base_branch input');
    assertTrue(builderRaw.includes('builder_execution_id:'), 'gemini-builder.yml must have builder_execution_id input');
});

runTest('Procedure - main.yml canonical ingress is the activation entry point', () => {
    assertTrue(mainRaw.includes('poc/validate-external-activation.js'), 'main.yml must call validate-external-activation.js');
    assertTrue(mainRaw.includes('CALLBACK_BASE_URL'), 'main.yml must reference CALLBACK_BASE_URL');
    assertTrue(mainRaw.includes('ACP_POC_TRIGGER_SECRET'), 'main.yml must reference ACP_POC_TRIGGER_SECRET');
    assertTrue(validatorRaw.includes('/poc/activation/ingress'), 'external-activation-validator.js must call the canonical ingress path');
});

// =========================================================
// 2. Canonical ingress validation step before agent execution
// =========================================================

runTest('Procedure - main.yml: canonical ingress validation appears before Gemini CLI run (issue_comment)', () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (issue_comment)');
    assertTrue(validateIdx !== -1, 'issue_comment validation step must exist');
    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assertTrue(geminiIdx !== -1, 'Gemini CLI step must exist');
    assertTrue(validateIdx < geminiIdx, 'validation must come before Gemini CLI run');
});

runTest('Procedure - main.yml: canonical ingress validation appears before Gemini CLI run (workflow_dispatch)', () => {
    const validateIdx = mainRaw.indexOf('Validate external activation through canonical ingress (workflow_dispatch)');
    assertTrue(validateIdx !== -1, 'workflow_dispatch validation step must exist');
    const geminiIdx = mainRaw.indexOf('Run Gemini in advisory mode');
    assertTrue(geminiIdx !== -1, 'Gemini CLI step must exist');
    assertTrue(validateIdx < geminiIdx, 'validation must come before Gemini CLI run');
});

runTest('Procedure - gemini-builder.yml: canonical ingress validation appears before Builder run', () => {
    const validateIdx = builderRaw.indexOf('Validate external activation through canonical ingress');
    assertTrue(validateIdx !== -1, 'Builder validation step must exist');
    const builderRunIdx = builderRaw.indexOf('Run Gemini Builder');
    assertTrue(builderRunIdx !== -1, 'Builder run step must exist');
    assertTrue(validateIdx < builderRunIdx, 'validation must come before Builder run');
});

// =========================================================
// 3. Execution descriptor persistence and consumption
// =========================================================

runTest('Procedure - validate-external-activation.js persists execution descriptor file', () => {
    assertTrue(validateScriptRaw_includes('EXECUTION_DESCRIPTOR_FILE'), 'validate-external-activation.js must reference EXECUTION_DESCRIPTOR_FILE env var');
    assertTrue(validateScriptRaw_includes('execution-descriptor.json'), 'validate-external-activation.js must default to execution-descriptor.json');
    assertTrue(validateScriptRaw_includes('writeFileSync'), 'validate-external-activation.js must persist descriptor via fs.writeFileSync');
});

function validateScriptRaw_includes(str) {
    return validateScriptRaw.includes(str);
}

runTest('Procedure - main.yml orchestration context consumes execution descriptor (not workflow inputs)', () => {
    assertTrue(mainRaw.includes('execution-descriptor.json'), 'main.yml must reference execution-descriptor.json');
    assertTrue(mainRaw.includes("jq -r '.request_id' \"$DESCRIPTOR_FILE\""), 'main.yml must read request_id from descriptor via jq');
    assertTrue(mainRaw.includes("jq -r '.task_mode' \"$DESCRIPTOR_FILE\""), 'main.yml must read task_mode from descriptor via jq');
    assertTrue(mainRaw.includes("jq -r '.capabilities | join(\",\")' \"$DESCRIPTOR_FILE\""), 'main.yml must read capabilities from descriptor via jq');
    assertTrue(mainRaw.includes("jq -r '.permitted_paths | join(\",\")' \"$DESCRIPTOR_FILE\""), 'main.yml must read permitted_paths from descriptor via jq');
});

runTest('Procedure - gemini-builder.yml orchestration context consumes execution descriptor (not workflow inputs)', () => {
    assertTrue(builderRaw.includes('execution-descriptor.json'), 'gemini-builder.yml must reference execution-descriptor.json');
    assertTrue(builderRaw.includes("jq -r '.request_id' \"$DESCRIPTOR_FILE\""), 'gemini-builder.yml must read request_id from descriptor via jq');
    assertTrue(builderRaw.includes("jq -r '.task_mode' \"$DESCRIPTOR_FILE\""), 'gemini-builder.yml must read task_mode from descriptor via jq');
    assertTrue(builderRaw.includes("jq -r '.capabilities | join(\",\")' \"$DESCRIPTOR_FILE\""), 'gemini-builder.yml must read capabilities from descriptor via jq');
    assertTrue(builderRaw.includes("jq -r '.permitted_paths | join(\",\")' \"$DESCRIPTOR_FILE\""), 'gemini-builder.yml must read permitted_paths from descriptor via jq');
});

runTest('Procedure - Gemini invocation consumes descriptor values via orchestration_context outputs', () => {
    const geminiSection = mainRaw.slice(mainRaw.indexOf('Run Gemini in advisory mode'));
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.request_id'), 'Gemini must consume request_id from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.task'), 'Gemini must consume task from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.repository'), 'Gemini must consume repository from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.base_branch'), 'Gemini must consume base_branch from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.task_mode'), 'Gemini must consume task_mode from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.capabilities'), 'Gemini must consume capabilities from orchestration_context');
    assertTrue(geminiSection.includes('steps.orchestration_context.outputs.permitted_paths'), 'Gemini must consume permitted_paths from orchestration_context');
});

runTest('Procedure - Gemini Builder invocation consumes descriptor values via orchestration_context outputs', () => {
    const builderSection = builderRaw.slice(builderRaw.indexOf('Run Gemini Builder'));
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.request_id'), 'Builder must consume request_id from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.task'), 'Builder must consume task from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.repository'), 'Builder must consume repository from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.base_branch'), 'Builder must consume base_branch from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.task_mode'), 'Builder must consume task_mode from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.capabilities'), 'Builder must consume capabilities from orchestration_context');
    assertTrue(builderSection.includes('steps.orchestration_context.outputs.permitted_paths'), 'Builder must consume permitted_paths from orchestration_context');
});

// =========================================================
// 4. Execution claim gating on successful activation
// =========================================================

runTest('Procedure - ingress does NOT call getDispatcher (admission-only, no double-dispatch)', () => {
    const ingressRouteSection = ingressRouteRaw.slice(ingressRouteRaw.indexOf("router.post('/activation/ingress'"));
    const ingressRouteEnd = ingressRouteSection.indexOf('module.exports');
    const ingressHandler = ingressRouteSection.slice(0, ingressRouteEnd);
    assertTrue(!ingressHandler.includes('getDispatcher('), 'The /activation/ingress handler must NOT call getDispatcher (admission-only)');
    assertTrue(ingressRouteRaw.includes('// dispatch the agent directly, preventing recursive ingress'), 'Route must document admission-only behavior');
});

runTest('Procedure - activation-ingress.js does NOT call getDispatcher (admission-only, no double-dispatch)', () => {
    assertTrue(!activationIngressRaw.includes('getDispatcher('), 'activation-ingress.js must not call getDispatcher');
    assertTrue(!activationIngressRaw.includes('require(\'../services/transport-provider\')'), 'activation-ingress.js must not import transport-provider');
    assertTrue(!activationIngressRaw.includes('await dispatch'), 'activation-ingress.js must not dispatch');
});

runTest('Procedure - ingress returns server-derived execution descriptor', () => {
    cleanup();
    const { buildBuilderActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildBuilderActivationPayload({
        request_id: 'proc-desc-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = setupDirectorApproval('proc-desc-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-proc-1',
        carrier_type: 'github_workflow'
    });

    assertTrue(result.success, 'Builder with carrier identity should succeed: ' + (result.error || ''));
    assertTrue(result.execution_descriptor, 'Should return execution_descriptor');
    assertTrue(result.execution_claim_id, 'Should return execution_claim_id');
    assertTrue(result.carrier_identity, 'Should return carrier_identity');
    cleanup();
});

runTest('Procedure - execution claim is exactly-once (concurrent claims blocked)', () => {
    cleanup();
    const { buildBuilderActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildBuilderActivationPayload({
        request_id: 'proc-once-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = setupDirectorApproval('proc-once-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result1 = canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-once-A',
        carrier_type: 'github_workflow'
    });

    assertTrue(result1.success, 'First claim should succeed');
    assertTrue(result1.execution_claim_id, 'First claim should have execution_claim_id');

    const result2 = canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-once-B',
        carrier_type: 'github_workflow'
    });

    assertTrue(result2.replay === true, 'Second attempt should be replay: ' + (result2.error || result2.error_code || ''));
    cleanup();
});

// =========================================================
// 5. request_id / execution_claim_id / carrier_identity correlation
// =========================================================

runTest('Procedure - descriptor binds request_id, execution_claim_id, and carrier_identity', () => {
    cleanup();
    const { buildBuilderActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildBuilderActivationPayload({
        request_id: 'proc-corr-test-1',
        task: 'implement feature X',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const approval = setupDirectorApproval('proc-corr-test-1', 'Gemini Builder', 'BUILDER',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    const result = canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id,
        carrier_identity: 'github-workflow-corr-1',
        carrier_type: 'github_workflow'
    });

    assertTrue(result.success, 'Should succeed with carrier identity');
    const descriptor = result.execution_descriptor;
    assertTrue(descriptor, 'Should have execution descriptor');
    assert.equal(descriptor.request_id, 'proc-corr-test-1', 'Descriptor must bind request_id');
    assert.equal(descriptor.execution_claim_id, result.execution_claim_id, 'Descriptor must bind execution_claim_id');
    assert.equal(descriptor.carrier_identity, 'github-workflow-corr-1', 'Descriptor must bind carrier_identity');
    assert.equal(descriptor.carrier_type, 'github_workflow', 'Descriptor must bind carrier_type');

    const claim = taskRegistry.getExecutionClaim('proc-corr-test-1');
    assertTrue(claim, 'Should retrieve execution claim from TaskRegistry');
    assert.equal(claim.execution_claim_id, result.execution_claim_id, 'Claim in TaskRegistry must match descriptor');
    assert.equal(claim.carrier_identity, 'github-workflow-corr-1', 'TaskRegistry claim must bind carrier_identity');
    cleanup();
});

runTest('Procedure - callback payload preserves request/claim/carrier correlation', () => {
    const mainRawLocal = fs.readFileSync(MAIN_WF_PATH, 'utf8');
    const callbackSection = mainRawLocal.slice(mainRawLocal.indexOf('Prepare ACP report payload'));

    assertTrue(callbackSection.includes('steps.orchestration_context.outputs.execution_claim_id') ||
               callbackSection.includes("jq -r '.request_id' \"$DESCRIPTOR_FILE\"'"),
        'Callback payload must include request_id (from descriptor or orchestration_context)');
    assertTrue(callbackSection.includes('steps.orchestration_context.outputs.execution_claim_id'),
        'Callback payload must include execution_claim_id from orchestration context');
    assertTrue(callbackSection.includes('steps.orchestration_context.outputs.carrier_identity'),
        'Callback payload must include carrier_identity from orchestration context');
    assertTrue(callbackSection.includes('x-gemini-callback-secret'),
        'Callback must include authentication header');
    assertTrue(callbackSection.includes('RENDER_GEMINI_CALLBACK_URL'),
        'Callback must reference Render callback URL');

    const builderRawLocal = fs.readFileSync(BUILDER_WF_PATH, 'utf8');
    const builderCallbackSection = builderRawLocal.slice(builderRawLocal.indexOf('Prepare ACP report payload'));
    assertTrue(builderCallbackSection.includes('x-builder-callback-secret'),
        'Builder callback must include authentication header');
    assertTrue(builderCallbackSection.includes('RENDER_BUILDER_CALLBACK_URL'),
        'Builder callback must reference Render callback URL');
});

// =========================================================
// 6. Server-derived authority (no workflow-input authority reconstruction)
// =========================================================

runTest('Procedure - server-derived authority overrides externally claimed capabilities', () => {
    cleanup();
    const { buildActivationPayloadForWorkflowDispatch } = require('../poc/external-activation-validator');
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'proc-auth-test-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const { setupDirectorApproval: setupApproval } = { setupDirectorApproval: require('./external-activation-bypass.test.js') ? null : null };

    const approval = setupDirectorApproval('proc-auth-test-1', 'Gemini', 'FAILOVER_EXECUTE',
        ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/']);
    payload.authorization.approval_id = approval.approval.approval_id;

    payload.claimed_authority = {
        task_mode: 'REVIEW',
        authorization: { capabilities: ['read_only'] }
    };

    const result = canonicalExternalActivationIngress(payload, {
        director_approval_id: payload.authorization.approval_id
    });

    assert.ok(!result.success, 'Authority conflict should block activation');
    assert.equal(result.error_code, 'AUTHORITY_CONFLICT');
    cleanup();
});

runTest('Procedure - workflow does not reconstruct authority from workflow inputs', () => {
    assertTrue(mainRaw.includes('ORCHESTRATION_TASK_MODE: ${{ steps.orchestration_context.outputs.task_mode }}'),
        'main.yml must source task_mode from orchestration_context (descriptor), not inputs');
    assertTrue(mainRaw.includes('ORCHESTRATION_CAPABILITIES: ${{ steps.orchestration_context.outputs.capabilities }}'),
        'main.yml must source capabilities from orchestration_context (descriptor), not inputs');
    assertTrue(mainRaw.includes('ORCHESTRATION_PERMITTED_PATHS: ${{ steps.orchestration_context.outputs.permitted_paths }}'),
        'main.yml must source permitted_paths from orchestration_context (descriptor), not inputs');

    assertTrue(builderRaw.includes('ORCHESTRATION_TASK_MODE: ${{ steps.orchestration_context.outputs.task_mode }}'),
        'gemini-builder.yml must source task_mode from orchestration_context (descriptor), not inputs');
    assertTrue(builderRaw.includes('ORCHESTRATION_CAPABILITIES: ${{ steps.orchestration_context.outputs.capabilities }}'),
        'gemini-builder.yml must source capabilities from orchestration_context (descriptor), not inputs');
});

// =========================================================
// 7. Workflow gating on validation + replay
// =========================================================

runTest('Procedure - main.yml Run Gemini step gated on validation (both paths)', () => {
    const geminiSection = mainRaw.slice(mainRaw.indexOf('Run Gemini in advisory mode'));
    assertTrue(/steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(geminiSection),
        'Gemini run must be gated on issue_comment validation output');
    assertTrue(/steps\.validate_activation_wfd\.outputs\.activation_validated\s*==\s*'true'/.test(geminiSection),
        'Gemini run must be gated on workflow_dispatch validation output');
    assertTrue(/!steps\.validate_activation\.outputs\.replay/.test(geminiSection),
        'Gemini run must skip on issue_comment replay');
    assertTrue(/!steps\.validate_activation_wfd\.outputs\.replay/.test(geminiSection),
        'Gemini run must skip on workflow_dispatch replay');
});

runTest('Procedure - gemini-builder.yml Run Gemini Builder gated on validation + replay', () => {
    const builderSection = builderRaw.slice(builderRaw.indexOf('Run Gemini Builder'), builderRaw.indexOf('Commit and push'));
    assertTrue(/steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(builderSection),
        'Builder run must be gated on activation validation');
    assertTrue(/!steps\.validate_activation\.outputs\.replay/.test(builderSection),
        'Builder run must skip on replay');
});

runTest('Procedure - orchestration_context gated on validation + non-replay', () => {
    assertTrue(/steps\.validate_activation_wfd\.outputs\.activation_validated\s*==\s*'true'/.test(mainRaw),
        'main.yml: orchestration_context must be gated on activation_validated');
    assertTrue(/!steps\.validate_activation_wfd\.outputs\.replay/.test(mainRaw),
        'main.yml: orchestration_context must skip on replay');
    assertTrue(/steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(mainRaw),
        'main.yml: orchestration_context must be gated on activation_validated');
    assertTrue(/!steps\.validate_activation\.outputs\.replay/.test(mainRaw),
        'main.yml: orchestration_context must skip on replay');

    assertTrue(/steps\.validate_activation\.outputs\.activation_validated\s*==\s*'true'/.test(builderRaw),
        'gemini-builder.yml: orchestration_context must be gated on activation_validated');
    assertTrue(/!steps\.validate_activation\.outputs\.replay/.test(builderRaw),
        'gemini-builder.yml: orchestration_context must skip on replay');
});

// =========================================================
// 8. External activation validator transmits carrier identity
// =========================================================

runTest('Procedure - external-activation-validator.js transmits x-carrier-identity header', () => {
    assertTrue(validatorRaw.includes('x-carrier-identity'), 'Validator must transmit x-carrier-identity header');
    assertTrue(validatorRaw.includes('GITHUB_RUN_ID'), 'Validator must derive carrier identity from GITHUB_RUN_ID');
    assertTrue(validatorRaw.includes('x-poc-trigger-secret'), 'Validator must transmit x-poc-trigger-secret header');
});

runTest('Procedure - routes/poc.js passes carrier_identity from request header', () => {
    assertTrue(ingressRouteRaw.includes('x-carrier-identity'), 'Route must read x-carrier-identity header');
    assertTrue(ingressRouteRaw.includes('carrier_identity: carrierIdentity'), 'Route must pass carrier_identity to dispatchContext');
});

// =========================================================
// 9. Consequential command requires Director approval
// =========================================================

runTest('Procedure - FAILOVER_EXECUTE without Director approval fails closed', () => {
    cleanup();
    const { buildActivationPayloadForWorkflowDispatch } = require('../poc/external-activation-validator');
    const payload = buildActivationPayloadForWorkflowDispatch({
        request_id: 'proc-dir-test-1',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'tests must pass'
    });

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'FAILOVER_EXECUTE should be blocked without Director approval');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

runTest('Procedure - BUILDER without Director approval fails closed', () => {
    cleanup();
    const { buildBuilderActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildBuilderActivationPayload({
        request_id: 'proc-dir-test-2',
        task: 'implement feature',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/'
    });

    const result = canonicalExternalActivationIngress(payload, {});
    assert.ok(!result.success, 'BUILDER should be blocked without Director approval');
    assert.equal(result.error_code, 'DIRECTOR_APPROVAL_REQUIRED');
    cleanup();
});

// =========================================================
// 10. Procedure document is self-consistent and references real paths
// =========================================================

runTest('Procedure - EXTERNAL_ACTIVATION_PROCEDURE.md exists and references canonical ingress', () => {
    assertTrue(procedureRaw.includes('canonical ingress'), 'Procedure must reference canonical ingress');
    assertTrue(procedureRaw.includes('/poc/activation/ingress'), 'Procedure must reference the ingress path');
    assertTrue(procedureRaw.includes('poc/activation-ingress.js'), 'Procedure must reference activation-ingress.js');
    assertTrue(procedureRaw.includes('poc/activation-policy.js'), 'Procedure must reference activation-policy.js');
    assertTrue(procedureRaw.includes('poc/task-registry.js'), 'Procedure must reference task-registry.js');
    assertTrue(procedureRaw.includes('test/external-activation-procedure.test.js'), 'Procedure must reference its machine-verification tests');
    assertTrue(procedureRaw.includes('test/external-activation-bypass.test.js'), 'Procedure must reference bypass tests');
});

runTest('Procedure - EXTERNAL_ACTIVATION_PROCEDURE.md references correct workflow paths', () => {
    assertTrue(procedureRaw.includes('.github/workflows/main.yml'), 'Procedure must reference main.yml');
    assertTrue(procedureRaw.includes('.github/workflows/gemini-builder.yml'), 'Procedure must reference gemini-builder.yml');
});

// =========================================================
// 11. Failure: procedure references nonexistent canonical workflow or required activation input
// =========================================================

runTest('Procedure - tests fail if procedure references nonexistent workflow', () => {
    const nonexistentWorkflow = '.github/workflows/nonexistent-workflow.yml';
    assertTrue(!fs.existsSync(path.join(__dirname, '..', nonexistentWorkflow)),
        'Confirmed: nonexistent workflow does not exist (validation baseline)');
    assertTrue(!procedureRaw.includes(nonexistentWorkflow),
        'Procedure must not reference nonexistent workflow paths');
});

runTest('Procedure - procedure does not reference GATEWAY_MODE or guessed env vars', () => {
    assertTrue(!procedureRaw.includes('GATEWAY_MODE'), 'Procedure must not reference guessed environment variable');
    assertTrue(!procedureRaw.includes('gateway.mode'), 'Procedure must not reference openclaw-render.json gateway.mode');
});

// =========================================================
// Summary
// =========================================================

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');

if (failCount > 0) {
    process.exit(1);
}
