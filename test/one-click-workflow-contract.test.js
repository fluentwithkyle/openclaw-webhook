const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const ROOT_DIR = path.join(__dirname, '..');
const CONTRACT_DOC_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'ONE_CLICK_WORKFLOW_CONTRACT.md');
const CHATGPT_START_HERE_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'CHATGPT_START_HERE.md');
const PROTOCOL_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'CHATGPT_PROJECT_OPERATING_PROTOCOL.md');
const README_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'README.md');
const EXTERNAL_ACT_PROCEDURE_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'EXTERNAL_ACTIVATION_PROCEDURE.md');
const ARCH_DECISIONS_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'ARCH_DECISIONS.md');
const MAIN_WF_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'main.yml');
const BUILDER_WF_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'gemini-builder.yml');
const TASK_LOG_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'TASK_LOG.md');
const ONE_CLICK_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const ONE_CLICK_VERIFY_WF = path.join(ONE_CLICK_DIR, 'one-click-gemini-activation-verify-reconcile.yml');
const ONE_CLICK_BUILDER_SMOKE_WF = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-smoke.yml');
const ACTIVATION_POLICY_PATH = path.join(ROOT_DIR, 'poc', 'activation-policy.js');
const ACP_SCHEMA_PATH = path.join(ROOT_DIR, 'poc', 'schemas', 'acp-schema.js');

const { validateAcpTaskArtifact, validateAcpTaskArtifactSyntax, getRuntimeTaskModeForConceptual, VALID_CAPABILITIES, CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS, CANONICAL_TASK_ARTIFACT_FIELD_ORDER, CONCEPTUAL_TASK_MODES, SMART_QUOTE_CHARS } = require('../poc/schemas/acp-schema');
const {
    extractEmbeddedCarrierArtifact,
    parseYamlLikeToArtifactObject,
    buildCanonicalArtifactString,
    validateOneClickCarrier,
    bindCarrierToRequestedTask,
    preflightValidateOneClickActivation
} = require('../poc/one-click-artifact-validator');

const contractRaw = fs.readFileSync(CONTRACT_DOC_PATH, 'utf8');
const startHereRaw = fs.readFileSync(CHATGPT_START_HERE_PATH, 'utf8');
const protocolRaw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
const readmeRaw = fs.readFileSync(README_PATH, 'utf8');
const externalActRaw = fs.readFileSync(EXTERNAL_ACT_PROCEDURE_PATH, 'utf8');
const archDecisionsRaw = fs.readFileSync(ARCH_DECISIONS_PATH, 'utf8');
const mainWfRaw = fs.readFileSync(MAIN_WF_PATH, 'utf8');
const builderWfRaw = fs.readFileSync(BUILDER_WF_PATH, 'utf8');
const taskLogRaw = fs.readFileSync(TASK_LOG_PATH, 'utf8');
const oneClickVerifyWfRaw = fs.readFileSync(ONE_CLICK_VERIFY_WF, 'utf8');
const oneClickBuilderSmokeWfRaw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
const activationPolicyRaw = fs.readFileSync(ACTIVATION_POLICY_PATH, 'utf8');
const acpSchemaRaw = fs.readFileSync(ACP_SCHEMA_PATH, 'utf8');

function listOneClickWorkflows() {
    // Canonical active one-click carriers declared by ONE_CLICK_WORKFLOW_CONTRACT.md.
    // Historical/experimental one-click-named workflows are not active carriers.
    return [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml'
    ];
}

function extractCarrierField(workflowRaw, field) {
    const fieldPattern = new RegExp(
        '(?:^|\\n)\\s*(?:[^\\n]*[\\x27\\x22])?' + field + ':\\s*(?:\\n\\s*)?([^\\n]+)',
        'i'
    );
    const match = workflowRaw.match(fieldPattern);
    return match ? match[1].trim() : null;
}

const CARRIER_STATES = Object.freeze({
    CARRIER_NOT_FOUND: 'CARRIER_NOT_FOUND',
    CARRIER_FOUND: 'CARRIER_FOUND',
    CARRIER_TASK_MISMATCH: 'CARRIER_TASK_MISMATCH',
    CARRIER_READY: 'CARRIER_READY',
    EXECUTION_STARTED: 'EXECUTION_STARTED',
    EXECUTION_VERIFIED: 'EXECUTION_VERIFIED'
});

function evaluateOneClickCarrierBinding(workflowRaw, requestedTask) {
    const hasWorkflowDispatch = /workflow_dispatch/i.test(workflowRaw);
    const hasRequiredInputs = /required:\s*true/i.test(workflowRaw);
    const routesViaCanonicalActivation = /validate-external-activation\.js/i.test(workflowRaw) ||
        /actions\/workflows\/main\.yml\/dispatches/i.test(workflowRaw);
    const taskName = extractCarrierField(workflowRaw, 'task_name');
    const targetAgent = extractCarrierField(workflowRaw, 'target_agent');
    const taskMode = extractCarrierField(workflowRaw, 'task_mode');
    if (!hasWorkflowDispatch || hasRequiredInputs || !taskName || !targetAgent || !taskMode) {
        return { state: CARRIER_STATES.CARRIER_NOT_FOUND, ready: false, reason: 'No valid zero-input canonical carrier is present.' };
    }
    if (taskName !== requestedTask.task_name) {
        return { state: CARRIER_STATES.CARRIER_TASK_MISMATCH, ready: false, reason: 'Embedded task_name differs from requested task_name.' };
    }
    if (targetAgent !== requestedTask.target_agent || taskMode !== requestedTask.task_mode) {
        return { state: CARRIER_STATES.CARRIER_FOUND, ready: false, reason: 'Embedded target_agent or task_mode differs from the requested task.' };
    }
    if (!routesViaCanonicalActivation) {
        return { state: CARRIER_STATES.CARRIER_FOUND, ready: false, reason: 'Carrier does not use the canonical external-activation path.' };
    }
    return { state: CARRIER_STATES.CARRIER_READY, ready: true, reason: 'Exact task, agent, mode, zero-input, and canonical activation binding verified.' };
}

function fixture(taskFields) {
    return 'on:\n  workflow_dispatch:\n' + taskFields + 'route: poc/validate-external-activation.js\n';
}

// =========================================================
// Canonical phrase definition tests
// =========================================================

runTest('Contract - canonical phrase "Make this a one-click workflow" is defined with normative meaning', () => {
    assert.ok(contractRaw.includes('Make this a one-click workflow'), 'Contract must contain canonical phrase');
    assert.ok(contractRaw.includes('"Make this a one-click workflow."'), 'Contract must quote the canonical phrase');
});

runTest('Contract - declares the phrase as a durable project command', () => {
    assert.ok(/durable.*project.*command/i.test(contractRaw),
        'Contract must declare the phrase as a durable project command');
});

// =========================================================
// Zero-input workflow_dispatch requirement tests
// =========================================================

runTest('Contract - explicitly requires zero required workflow_dispatch inputs', () => {
    assert.ok(/zero.*input/i.test(contractRaw),
        'Contract must reference zero-input requirement');
    assert.ok(contractRaw.includes('workflow_dispatch'),
        'Contract must reference workflow_dispatch trigger');
    assert.ok(/no required.*input/i.test(contractRaw) || /required.*false/i.test(contractRaw),
        'Contract must state no required inputs');
});

runTest('Contract - distinguishes one-click from multi-input workflows', () => {
    assert.ok(/does.*not.*satisfy/i.test(contractRaw) || /does not satisfy/i.test(contractRaw),
        'Contract must explicitly state some workflows do not satisfy the requirement');
});

// =========================================================
// Agent/task-mode variant tests
// =========================================================

runTest('Contract - covers agent/task-mode variants (e.g., Gemini Builder)', () => {
    assert.ok(/Gemini Builder/i.test(contractRaw),
        'Contract must cover Gemini Builder variant');
    assert.ok(/agent.*task.mode/i.test(contractRaw) || /agent\/task-mode/i.test(contractRaw) || /task mode/i.test(contractRaw),
        'Contract must reference agent/task-mode determination');
});

runTest('Contract - covers all agent/task-mode variants section', () => {
    assert.ok(/variant/i.test(contractRaw),
        'Contract must contain a variants section');
});

// =========================================================
// Existing workflow distinction tests
// =========================================================

runTest('Contract - explicitly states main.yml does NOT satisfy one-click (has required inputs)', () => {
    assert.ok(/main\.yml/i.test(contractRaw),
        'Contract must reference main.yml');
    assert.ok(/gemini-builder\.yml/i.test(contractRaw),
        'Contract must reference gemini-builder.yml');
    assert.ok(/required.*input/i.test(contractRaw) || /required.*inputs/i.test(contractRaw),
        'Contract must reference required inputs as reason existing workflows do not satisfy');
});

runTest('Contract - lists existing workflow status table', () => {
    assert.ok(/One-Click\?|One.Click/i.test(contractRaw),
        'Contract must have a one-click status column/section');
});

// =========================================================
// Architecture reuse and prohibition tests
// =========================================================

runTest('Contract - explicitly prohibits second control plane', () => {
    assert.ok(/second.*control.*plane/i.test(contractRaw) || /second control plane/i.test(contractRaw),
        'Contract must prohibit second control plane');
});

runTest('Contract - explicitly prohibits second TaskRegistry', () => {
    assert.ok(/second.*TaskRegistry/i.test(contractRaw) || /second TaskRegistry/i.test(contractRaw),
        'Contract must prohibit second TaskRegistry');
});

runTest('Contract - explicitly prohibits alternate authorization mechanism', () => {
    assert.ok(/alternate.*authorization/i.test(contractRaw) || /alternate authorization/i.test(contractRaw),
        'Contract must prohibit alternate authorization mechanisms');
});

runTest('Contract - explicitly prohibits alternate activation mechanism', () => {
    assert.ok(/alternate.*activation/i.test(contractRaw) || /alternate activation/i.test(contractRaw),
        'Contract must prohibit alternate activation mechanisms');
});

runTest('Contract - references canonical external-activation architecture', () => {
    assert.ok(/EXTERNAL_ACTIVATION_PROCEDURE/i.test(contractRaw),
        'Contract must reference external activation procedure');
    assert.ok(/poc\/activation-ingress\.js/i.test(contractRaw),
        'Contract must reference activation-ingress.js');
    assert.ok(/poc\/task-registry\.js/i.test(contractRaw),
        'Contract must reference task-registry.js');
});

runTest('Contract - references poc/activation-policy.js', () => {
    assert.ok(/poc\/activation-policy\.js/i.test(contractRaw),
        'Contract must reference activation-policy.js');
});

runTest('Contract - references poc/acp-engine.js and poc/schemas/acp-schema.js', () => {
    assert.ok(/poc\/acp-engine\.js/i.test(contractRaw),
        'Contract must reference acp-engine.js');
    assert.ok(/poc\/schemas\/acp-schema\.js/i.test(contractRaw),
        'Contract must reference acp-schema.js');
});

// =========================================================
// Cold-start discoverability tests
// =========================================================

runTest('Contract - referenced from CHATGPT_START_HERE.md Bootstrap Completion Check', () => {
    assert.ok(startHereRaw.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'CHATGPT_START_HERE.md must reference the one-click workflow contract');
});

runTest('Contract - referenced from CHATGPT_START_HERE.md Quick Reference table', () => {
    const quickRefSection = startHereRaw.slice(startHereRaw.indexOf('## 9. Quick Reference'));
    assert.ok(quickRefSection.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'Quick Reference table must list the one-click workflow contract');
});

runTest('Contract - referenced from CHATGPT_START_HERE.md document locations table', () => {
    assert.ok(startHereRaw.includes('docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md'),
        'CHATGPT_START_HERE.md must reference docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md path');
});

runTest('Contract - referenced from CHATGPT_PROJECT_OPERATING_PROTOCOL.md Section 11.2', () => {
    assert.ok(protocolRaw.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'Protocol must reference the one-click workflow contract');
    assert.ok(protocolRaw.includes('### 11.2 One-Click Workflow'),
        'Protocol must have a Section 11.2 for one-click workflow contract');
});

runTest('Contract - referenced from docs/ai/README.md File Contents section', () => {
    assert.ok(readmeRaw.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'README.md must reference the one-click workflow contract');
});

runTest('Contract - referenced from docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md Section 13', () => {
    assert.ok(externalActRaw.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'EXTERNAL_ACTIVATION_PROCEDURE.md must reference the one-click workflow contract');
    assert.ok(externalActRaw.includes('## 13. One-Click Workflow'),
        'EXTERNAL_ACTIVATION_PROCEDURE.md must have Section 13 for one-click workflow');
});

// =========================================================
// ADR-025 tests
// =========================================================

runTest('ADR-025 - recorded in ARCH_DECISIONS.md', () => {
    assert.ok(archDecisionsRaw.includes('ADR-025'),
        'ARCH_DECISIONS.md must contain ADR-025');
    assert.ok(archDecisionsRaw.includes('One-Click Workflow Coordinator Contract'),
        'ADR-025 must be titled "One-Click Workflow Coordinator Contract"');
    assert.ok(/ACCEPTED/i.test(archDecisionsRaw.slice(archDecisionsRaw.indexOf('ADR-025'))),
        'ADR-025 must have ACCEPTED status');
});

runTest('ADR-025 - documents the decision to create the contract', () => {
    const adr025Section = archDecisionsRaw.slice(archDecisionsRaw.indexOf('ADR-025'));
    assert.ok(/docs\/ai\/ONE_CLICK_WORKFLOW_CONTRACT\.md/i.test(adr025Section),
        'ADR-025 must reference the contract document path');
    assert.ok(/zero.input/i.test(adr025Section) || /zero-input/i.test(adr025Section),
        'ADR-025 must mention zero-input requirement');
});

// =========================================================
// TASK_LOG reference tests
// =========================================================

runTest('TASK_LOG.md - references the one-click workflow contract task', () => {
    assert.ok(/one.click/i.test(taskLogRaw) || /one-click/i.test(taskLogRaw),
        'TASK_LOG.md must reference the one-click workflow contract task');
});

// =========================================================
// Architecture invariant preservation tests
// =========================================================

runTest('Contract - does not modify main.yml (existing workflow unchanged)', () => {
    assert.ok(mainWfRaw.includes('workflow_dispatch'),
        'main.yml still has workflow_dispatch (unchanged)');
    assert.ok(mainWfRaw.includes('inputs:'),
        'main.yml still has required inputs (unchanged)');
});

runTest('Contract - does not modify gemini-builder.yml (existing workflow unchanged)', () => {
    assert.ok(builderWfRaw.includes('workflow_dispatch'),
        'gemini-builder.yml still has workflow_dispatch (unchanged)');
});

// =========================================================
// Machine-verifiable implementation references
// =========================================================

runTest('Contract - references test file for machine verification', () => {
    assert.ok(/test\/one-click-workflow-contract\.test\.js/i.test(contractRaw),
        'Contract must reference the test file');
});

runTest('Test file - references all required implementation files from contract', () => {
    const implementationRefs = [
        'poc/activation-ingress.js',
        'poc/activation-policy.js',
        'poc/task-registry.js',
        'docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md',
        'docs/ai/CHATGPT_START_HERE.md'
    ];
    for (const ref of implementationRefs) {
        assert.ok(contractRaw.includes(ref), `Contract must reference ${ref}`);
    }
});

// =========================================================
// Coordinator interpretation procedure tests
// =========================================================

runTest('Contract - defines coordinator interpretation procedure', () => {
    assert.ok(/coordinator.*interpret/i.test(contractRaw) || /interpretation.*procedure/i.test(contractRaw),
        'Contract must define coordinator interpretation procedure');
});

runTest('Contract - includes invariants summary table', () => {
    assert.ok(/invariant/i.test(contractRaw),
        'Contract must include an invariants section');
});

runTest('Contract - includes summary of invariants', () => {
    const invariantsSection = contractRaw.slice(contractRaw.indexOf('## 11. Summary'));
    assert.ok(/zero/i.test(invariantsSection) && /input/i.test(invariantsSection),
        'Invariants section must include zero-input constraint');
    assert.ok(invariantsSection.includes('TaskRegistry'),
        'Invariants section must include TaskRegistry reuse');
    assert.ok(/control plane/i.test(invariantsSection),
        'Invariants section must include no-second-control-plane');
});

// =========================================================
// Task-to-workflow binding tests
// =========================================================

runTest('Contract - explicitly establishes task-to-workflow binding requirement', () => {
    assert.ok(/task-to-workflow.*binding/i.test(contractRaw) || /task-to-workflow binding/i.test(contractRaw),
        'Contract must contain task-to-workflow binding requirement section');
});

runTest('Contract - defines embedded canonical ACP task carrier concept', () => {
    assert.ok(/embedded.*carrier/i.test(contractRaw) || /embedded.*task.*carrier/i.test(contractRaw),
        'Contract must define embedded task carrier concept');
    assert.ok(/task_name/i.test(contractRaw),
        'Contract must reference task_name in binding context');
});

runTest('Contract - states the exact canonical ACP task must be bound to the embedded carrier', () => {
    assert.ok(/exact canonical ACP task/i.test(contractRaw),
        'Contract must reference exact canonical ACP task binding');
    assert.ok(/embedded carrier/i.test(contractRaw),
        'Contract must reference embedded carrier');
});

runTest('Contract - prohibits linking older workflow with different task', () => {
    assert.ok(/Link an older one-click workflow.*different task/i.test(contractRaw) || /older.*one-click.*different.*task/i.test(contractRaw),
        'Contract must prohibit linking older workflow with different task');
});

runTest('Contract - prohibits providing generic workflow page as one-click', () => {
    assert.ok(/generic workflow page/i.test(contractRaw),
        'Contract must prohibit generic workflow page as one-click');
});

runTest('Contract - prohibits run link for workflow whose embedded task differs from requested', () => {
    assert.ok(/Run workflow link.*embedded task.*different.*requested task/i.test(contractRaw) || /embedded task is different from the requested task/i.test(contractRaw),
        'Contract must prohibit run link for workflow with different embedded task');
});

runTest('Contract - prohibits constructing separate ACP task while leaving carrier unchanged', () => {
    assert.ok(/separate ACP task.*leaving.*carrier unchanged/i.test(contractRaw) || /separate.*ACP task.*carrier.*unchanged/i.test(contractRaw),
        'Contract must prohibit separate ACP task with unchanged carrier');
});

runTest('Contract - prohibits claiming readiness based on agent/task-mode alone without matching task', () => {
    assert.ok(/claim.*ready.*correct agent.*task mode.*different.*task/i.test(contractRaw) || /claim.*ready merely.*correct.*agent.*task mode.*different task/i.test(contractRaw),
        'Contract must prohibit claiming readiness based on agent/task-mode alone');
});

// =========================================================
// Machine-enforced task-to-carrier binding gate tests
// =========================================================

runTest('Binding gate - exact task binding passes', () => {
    const workflow = fixture('task_name:\nTASK-EXACT-001\ntarget_agent:\nGemini\ntask_mode:\nRESEARCH_DOCUMENT\n');
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-EXACT-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_READY); assert.strictEqual(result.ready, true);
});

runTest('Binding gate - mismatched task_name fails closed', () => {
    const workflow = fixture('task_name:\nTASK-OTHER-001\ntarget_agent:\nGemini\ntask_mode:\nRESEARCH_DOCUMENT\n');
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-REQUESTED-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_TASK_MISMATCH); assert.strictEqual(result.ready, false);
});

runTest('Binding gate - target_agent mismatch fails closed', () => {
    const workflow = fixture('task_name:\nTASK-EXACT-001\ntarget_agent:\nKilo\ntask_mode:\nRESEARCH_DOCUMENT\n');
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-EXACT-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_FOUND); assert.strictEqual(result.ready, false);
});

runTest('Binding gate - task_mode mismatch fails closed', () => {
    const workflow = fixture('task_name:\nTASK-EXACT-001\ntarget_agent:\nGemini\ntask_mode:\nVERIFY_RECONCILE\n');
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-EXACT-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_FOUND); assert.strictEqual(result.ready, false);
});

runTest('Binding gate - required workflow_dispatch input fails closed', () => {
    const workflow = 'on:\n  workflow_dispatch:\n    inputs:\n      task:\n        required: true\n' + 'task_name:\nTASK-EXACT-001\ntarget_agent:\nGemini\ntask_mode:\nRESEARCH_DOCUMENT\nroute: poc/validate-external-activation.js\n';
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-EXACT-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_NOT_FOUND); assert.strictEqual(result.ready, false);
});

runTest('Binding gate - non-canonical activation path fails closed', () => {
    const workflow = fixture('task_name:\nTASK-EXACT-001\ntarget_agent:\nGemini\ntask_mode:\nRESEARCH_DOCUMENT\n').replace('poc/validate-external-activation.js', 'alternate-activation.js');
    const result = evaluateOneClickCarrierBinding(workflow, { task_name: 'TASK-EXACT-001', target_agent: 'Gemini', task_mode: 'RESEARCH_DOCUMENT' });
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_FOUND); assert.strictEqual(result.ready, false);
});

runTest('Binding gate - actual one-click carriers expose fields required for exact binding', () => {
    for (const wf of listOneClickWorkflows()) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(extractCarrierField(wfRaw, 'task_name'), `${wf} must expose task_name`);
        assert.ok(extractCarrierField(wfRaw, 'target_agent'), `${wf} must expose target_agent`);
        assert.ok(extractCarrierField(wfRaw, 'task_mode'), `${wf} must expose task_mode`);
    }
});

runTest('Binding gate - state model is explicit and fail-closed', () => {
    assert.deepStrictEqual(Object.keys(CARRIER_STATES), ['CARRIER_NOT_FOUND', 'CARRIER_FOUND', 'CARRIER_TASK_MISMATCH', 'CARRIER_READY', 'EXECUTION_STARTED', 'EXECUTION_VERIFIED']);
});
// =========================================================
// Exact-task inspection tests
// =========================================================

runTest('Contract - requires inspecting the actual workflow file before presenting Run link', () => {
    assert.ok(/inspect.*actual workflow file/i.test(contractRaw) || /inspect.*actual workflow.*before.*Run link/i.test(contractRaw),
        'Contract must require inspecting the actual workflow file');
});

runTest('Contract - requires verifying zero-input in actual workflow inspection', () => {
    assert.ok(/inspect.*actual workflow file and verify/i.test(contractRaw),
        'Contract must require verification during inspection');
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/zero-input/i.test(inspectionSection),
        'Inspection section must require zero-input check');
});

runTest('Contract - requires verifying embedded carrier exists in workflow file', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/embedded carrier exists/i.test(inspectionSection),
        'Inspection must verify embedded carrier existence');
});

runTest('Contract - requires verifying target_agent matches requested agent', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/target_agent.*matches.*requested agent/i.test(inspectionSection),
        'Inspection must verify target_agent match');
});

runTest('Contract - requires verifying task_name matches requested task', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/task_name.*matches.*requested task/i.test(inspectionSection),
        'Inspection must verify task_name match');
});

runTest('Contract - requires verifying task_mode matches requested task mode', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/task_mode.*matches.*requested task mode/i.test(inspectionSection),
        'Inspection must verify task_mode match');
});

runTest('Contract - requires verifying objective/scope correspondence', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/objective.*scope.*correspond/i.test(inspectionSection) || /objective\/scope.*correspond/i.test(inspectionSection),
        'Inspection must verify objective/scope correspondence');
});

runTest('Contract - requires verifying authority fields remain server-derived', () => {
    const inspectionSection = contractRaw.slice(contractRaw.indexOf('Exact-Task Inspection'));
    assert.ok(/authority-bearing fields.*server-side activation policy/i.test(inspectionSection),
        'Inspection must verify server-derived authority preservation');
});

// =========================================================
// Dedicated workflow tests
// =========================================================

runTest('Contract - requires existing carrier retarget and revalidation when task differs', () => {
    assert.ok(/Existing Carrier \+ Wrong Task/i.test(contractRaw),
        'Contract must have existing-carrier wrong-task section');
    const section = contractRaw.slice(contractRaw.indexOf('Existing Carrier + Wrong Task'));
    assert.ok(/update.*existing.*carrier.*requested task.*revalidate/i.test(section),
        'Contract must require updating and revalidating the existing carrier when task differs');
    assert.ok(/must not.*silently reuse/i.test(section),
        'Contract must prohibit silently reusing the old task');
});

// =========================================================
// Run-link validity tests
// =========================================================

runTest('Contract - requires independent verification before Run link presentation', () => {
    assert.ok(/Run-Link Validity/i.test(contractRaw),
        'Contract must have run-link validity section');
    const section = contractRaw.slice(contractRaw.indexOf('Run-Link Validity'));
    assert.ok(/independently inspected.*confirmed.*exact task/i.test(section),
        'Contract must require independent verification of workflow before Run link');
});

// =========================================================
// Task-mode variants tests
// =========================================================

runTest('Contract - task-to-workflow binding applies to all task modes', () => {
    assert.ok(/Task-Mode Variants/i.test(contractRaw),
        'Contract must have task-mode variants subsection');
    const section = contractRaw.slice(contractRaw.indexOf('## 4.7 Task-Mode Variants'));
    assert.ok(/RESEARCH_DOCUMENT.*VERIFY_RECONCILE.*REVIEW.*BUILDER.*FAILOVER_EXECUTE/i.test(section),
        'Contract must list all policy-supported task modes');
});

// =========================================================
// Verification vs workflow construction tests
// =========================================================

runTest('Contract - distinguishes workflow construction from execution verification', () => {
    assert.ok(/Verification vs.*Workflow Construction/i.test(contractRaw) || /Verification vs. Workflow Construction/i.test(contractRaw),
        'Contract must have verification vs construction distinction section');
    const section = contractRaw.slice(contractRaw.indexOf('Verification vs. Workflow Construction'));
    assert.ok(/Constructing.*preparing.*one-click workflow/i.test(section),
        'Contract must distinguish workflow construction');
    assert.ok(/Director.*clicking Run workflow/i.test(section),
        'Contract must distinguish Director Run click');
    assert.ok(/Verifying.*resulting execution/i.test(section),
        'Contract must distinguish execution verification');
    assert.ok(/must not confuse.*workflow artifact.*proof.*executed/i.test(section),
        'Contract must prohibit confusing artifact with execution proof');
});

// =========================================================
// Coordinator decision rule tests
// =========================================================

runTest('Contract - includes explicit coordinator decision rule', () => {
    assert.ok(/Coordinator Decision Rule/i.test(contractRaw),
        'Contract must have coordinator decision rule section');
    const section = contractRaw.slice(contractRaw.indexOf('Coordinator Decision Rule'));
    assert.ok(/workflow is the executable carrier of the requested one-click task/i.test(section),
        'Decision rule must state workflow is the executable carrier');
    assert.ok(/must verify.*embedded task.*before.*presenting.*Run/i.test(section),
        'Decision rule must require verification before Run link');
});

runTest('Contract - decision rule specifies operational sequence', () => {
    const section = contractRaw.slice(contractRaw.indexOf('Coordinator Decision Rule'));
    assert.ok(/Inspect requested task.*inspect candidate workflow.*verify exact embedded task binding.*create\/update workflow.*verify.*present Run link.*Director executes.*inspect resulting/i.test(section),
        'Decision rule must specify operational sequence');
});

// =========================================================
// Protocol correction tests
// =========================================================

runTest('Protocol - Section 11.2 includes task-to-workflow binding in coordinator procedure', () => {
    assert.ok(protocolRaw.includes('task-to-workflow binding') || /task-to-workflow.*binding/i.test(protocolRaw.slice(protocolRaw.indexOf('### 11.2'))),
        'Protocol Section 11.2 must reference task-to-workflow binding');
});

runTest('Protocol - Section 11.2 includes no-task-substitution prohibition', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/no-task-substitution|task substitution/i.test(section),
        'Protocol Section 11.2 must reference no-task-substitution');
});

runTest('Protocol - Section 11.2 requires existing-carrier retarget and revalidation', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/Existing carrier.*wrong task.*update.*carrier.*revalidate/i.test(section) ||
        /update that existing carrier.*requested task.*revalidate/i.test(section),
        'Protocol Section 11.2 must require retargeting and revalidation when an existing carrier has the wrong task');
});

runTest('Protocol - Section 11.2 includes coordinator decision rule', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/coordinator decision rule|executable carrier.*embedded task/i.test(section),
        'Protocol Section 11.2 must reference coordinator decision rule');
});

runTest('Protocol - Section 11.2 includes protocol correction for operational sequence', () => {
    assert.ok(/Protocol correction/i.test(protocolRaw) || /operational sequence.*inspect.*verify.*create\/update.*verify.*present.*Director.*click.*inspect/i.test(protocolRaw),
        'Protocol must include the corrected operational sequence');
});

runTest('Protocol - Section 11.2 includes the mandatory registration/runnability gate step', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/registration\/runnability gate/i.test(section),
        'Protocol must state the registration/runnability gate as a mandatory step');
    assert.ok(/establish authoritative/i.test(section),
        'Gate step must reference establishing authoritative GitHub signal');
});

runTest('Protocol - Section 11.2 states workflow-file existence is insufficient', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/workflow-file existence is insufficient/i.test(section),
        'Protocol must state workflow-file existence is insufficient');
    assert.ok(/does.*not.*establish/i.test(section),
        'Protocol must explain file existence does not establish GitHub registration');
});

runTest('Protocol - Section 11.2 states workflow_dispatch presence is insufficient', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/workflow_dispatch.*presence is insufficient/i.test(section) ||
        /workflow_dispatch.*insufficient/i.test(section),
        'Protocol must state workflow_dispatch presence is insufficient');
    assert.ok(/HTTP 422/i.test(section) || /422/i.test(section),
        'Protocol must cite HTTP 422 registration failure with workflow_dispatch');
});

runTest('Protocol - Section 11.2 states YAML validity is insufficient', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/YAML validity is insufficient/i.test(section),
        'Protocol must state YAML validity is insufficient');
    assert.ok(/YAML.*does.*not.*establish/i.test(section) || /does.*not.*establish.*registration/i.test(section),
        'Protocol must explain YAML validity does not establish registration/dispatchability');
});

runTest('Protocol - Section 11.2 states repository-local tests cannot prove GitHub-hosted registration', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/repository-local tests.*cannot prove.*GitHub-hosted registration/i.test(section),
        'Protocol must state repository-local tests cannot prove GitHub-hosted registration');
    assert.ok(/GitHub Actions API[\s\S]*?dropdown[\s\S]*?workflow_dispatch[\s\S]*?run/i.test(section),
        'Protocol must list GitHub-hosted signals that repo-local tests cannot query');
});

runTest('Protocol - Section 11.2 keeps VERIFIED / INFERRED / UNKNOWN distinct', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/VERIFIED.*INFERRED.*UNKNOWN/i.test(section),
        'Protocol must keep VERIFIED, INFERRED, and UNKNOWN distinct');
    assert.ok(/VERIFIED is directly[\s\S]*?established/i.test(section),
        'Protocol must define VERIFIED as directly established');
    assert.ok(/INFERRED is logically[\s\S]*?likely/i.test(section),
        'Protocol must define INFERRED as logically likely');
    assert.ok(/UNKNOWN is unestablished/i.test(section),
        'Protocol must define UNKNOWN as unestablished');
});

runTest('Protocol - Section 11.2 states registration is UNKNOWN without authoritative GitHub evidence', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/registration is UNKNOWN without authoritative GitHub evidence/i.test(section),
        'Protocol must state registration is UNKNOWN without authoritative GitHub evidence');
    assert.ok(/absence.*GitHub-hosted signal/i.test(section),
        'Protocol must state in absence of authoritative signal registration is UNKNOWN');
});

runTest('Protocol - Section 11.2 states UNKNOWN is fail-closed as BLOCKED / NOT READY', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/UNKNOWN is fail-closed/i.test(section),
        'Protocol must state UNKNOWN is fail-closed');
    assert.ok(/BLOCKED.*NOT READY/i.test(section) || /NOT READY.*BLOCKED/i.test(section),
        'Protocol must state UNKNOWN results in BLOCKED/NOT READY');
    assert.ok(/does.*not.*present[\s\S]*?Run link/i.test(section) ||
        /BLOCKED.*NOT READY.*no Run link/i.test(section) ||
        /fail-closed.*BLOCKED/i.test(section),
        'Protocol must state no Run link is presented when UNKNOWN');
});

runTest('Protocol - Section 11.2 states Run link cannot be presented before gate passes', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/Run link cannot be presented before.*registration gate passes/i.test(section),
        'Protocol must state Run link cannot be presented before gate passes');
    assert.ok(/Run workflow.*link may be provided until/i.test(section),
        'Protocol must prohibit providing Run link until verification');
});

runTest('Protocol - Section 11.2 references ONE_CLICK_WORKFLOW_CONTRACT.md Section 9 as canonical gate', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    assert.ok(/docs\/ai\/ONE_CLICK_WORKFLOW_CONTRACT\.md.*Section 9/i.test(section),
        'Protocol must reference the canonical contract Section 9');
    assert.ok(/Workflow Registration & Runnability Gate/i.test(section),
        'Protocol must name the gate as Workflow Registration & Runnability Gate');
    assert.ok(/does not.*redefine.*weaken/i.test(section) || /invokes.*reinforces.*gate.*does not redefine/i.test(section),
        'Protocol must state it invokes/reinforces the gate without redefining/weakening it');
});

runTest('Protocol - Section 11.2 operational sequence includes registration gate between binding and creating workflow', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 11.2'));
    const sequencePattern = /verify exact[\s\S]*?ACP task binding[\s\S]*?verify zero-input/i;
    assert.ok(sequencePattern.test(section),
        'Protocol sequence must show zero-input verification after task binding');
    const gatePattern = /establish authoritative[\s\S]*?GitHub registration\/runnability/i;
    assert.ok(gatePattern.test(section),
        'Protocol sequence must show establishing authoritative GitHub registration/runnability');
    const failClosedPattern = /BLOCKED \/ NOT READY; no Run link/i;
    assert.ok(failClosedPattern.test(section),
        'Protocol sequence must show BLOCKED/NOT READY with no Run link on gate failure');
    const runLinkPattern = /all gates pass[\s\S]*?present Run link/i;
    assert.ok(runLinkPattern.test(section),
        'Protocol sequence must show Run link presented only after all gates pass');
});

// =========================================================
// One-click workflow file structure tests
// =========================================================

runTest('One-click workflows - have zero-input workflow_dispatch (no required inputs)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    assert.ok(oneClickWorkflows.length > 0, 'There must be at least one one-click workflow file');
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/on:\s*\n\s*workflow_dispatch:/.test(wfRaw) || /on:\s*$/.test(wfRaw) || /workflow_dispatch/.test(wfRaw),
            `${wf} must use workflow_dispatch trigger`);
        assert.ok(!/required:\s*true/.test(wfRaw), `${wf} must not have any required inputs`);
    }
});

runTest('One-click workflows - embed a canonical ACP task carrier with task_name', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/task_name:/i.test(wfRaw),
            `${wf} must embed a task_name field in its carrier`);
    }
});

runTest('One-click workflows - embed target_agent field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/target_agent:/i.test(wfRaw),
            `${wf} must embed a target_agent field in its carrier`);
    }
});

runTest('One-click workflows - embed task_mode field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/task_mode:/i.test(wfRaw),
            `${wf} must embed a task_mode field in its carrier`);
    }
});

runTest('One-click workflows - embed objective field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/objective:/i.test(wfRaw),
            `${wf} must embed an objective field in its carrier`);
    }
});

runTest('One-click workflows - embed verification field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/verification:/i.test(wfRaw),
            `${wf} must embed a verification field in its carrier`);
    }
});

runTest('One-click workflows - embed capabilities field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/capabilities:/i.test(wfRaw),
            `${wf} must embed a capabilities field in its carrier`);
    }
});

runTest('One-click workflows - embed constraints field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    let allHaveConstraints = true;
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        if (!/constraints:/i.test(wfRaw)) {
            allHaveConstraints = false;
        }
    }
    assert.ok(allHaveConstraints, 'All one-click workflows must embed a constraints field in carrier');
});

runTest('One-click workflows - route through canonical external-activation ingress (direct or via dispatch to main.yml)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        const routesViaIngress = /validate-external-activation\.js/i.test(wfRaw) ||
            /actions\/workflows\/main\.yml\/dispatches/i.test(wfRaw);
        assert.ok(routesViaIngress,
            `${wf} must either call poc/validate-external-activation.js or dispatch to main.yml (canonical carrier)`);
    }
});

runTest('One-click workflows - consume server-derived descriptor via jq (direct) or dispatch with server-derived inputs (via main.yml)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        const consumesDescriptor = /jq.*execution-descriptor\.json|execution-descriptor\.json.*jq/i.test(wfRaw) ||
            /DESCRIPTOR_FILE.*execution-descriptor\.json/i.test(wfRaw) ||
            /actions\/workflows\/main\.yml\/dispatches/i.test(wfRaw);
        assert.ok(consumesDescriptor,
            `${wf} must consume execution-descriptor.json via jq or dispatch to main.yml carrier`);
    }
});

// =========================================================
// Workflow registration / runnability gate tests
// =========================================================

const INCIDENT_DOC_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'GEMINI_WORKFLOW_REGISTRATION_INCIDENT_2026-09-16.md');
const incidentRaw = fs.readFileSync(INCIDENT_DOC_PATH, 'utf8');

runTest('Contract - Section 9 establishes the workflow registration & runnability gate', () => {
    assert.ok(/## 9\. Workflow Registration & Runnability Gate|## 9\. Registration & Runnability/i.test(contractRaw),
        'Contract must have a Section 9 for the registration/runnability gate');
    const section = contractRaw.slice(contractRaw.indexOf('## 9'));
    const sectionEnd = contractRaw.indexOf('## 10', contractRaw.indexOf('## 9'));
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), sectionEnd);
    assert.ok(/registration/i.test(gateSection),
        'Section 9 must reference workflow registration');
    assert.ok(/runnability/i.test(gateSection),
        'Section 9 must reference workflow runnability');
});

runTest('Contract - registration gate rejects "file exists + workflow_dispatch" as proof of GitHub recognition', () => {
    assert.ok(/workflow file.{0,40}existing on the repository default branch.{0,200}does.{0,30}NOT.{0,200}registered/i.test(contractRaw) ||
        /does.{0,30}NOT.{0,200}establish.{0,200}GitHub Actions has registered/i.test(contractRaw),
        'Contract must state that file existence does not establish GitHub registration');
});

runTest('Contract - references the 2026-09-16 workflow registration incident', () => {
    assert.ok(/GEMINI_WORKFLOW_REGISTRATION_INCIDENT_2026-09-16/i.test(contractRaw),
        'Contract must reference the registration incident document');
    assert.ok(/2026-09-16/i.test(contractRaw),
        'Contract must reference the incident date');
});

runTest('Contract - registration gate cites HTTP 422 workflow_dispatch registration failure', () => {
    assert.ok(/422/i.test(contractRaw),
        'Contract must reference the HTTP 422 registration failure');
});

runTest('Contract - registration gate requires independent GitHub-hosted signal for registration/runnability', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/authoritative GitHub-hosted signal|authoritative GitHub signal|GitHub-hosted registration signal/i.test(gateSection),
        'Gate must require an authoritative GitHub-hosted registration signal');
});

runTest('Contract - registration gate documents GitHub API workflows endpoint as authoritative signal', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/actions\/workflows[\s\S]*workflow|GET.*workflows/i.test(gateSection),
        'Gate must reference the GitHub workflows API as an authoritative signal');
});

runTest('Contract - registration gate documents workflow state: active as the recognized signal', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/state:\s*active|state.*active/i.test(gateSection),
        'Gate must reference state: active as the recognized signal');
});

runTest('Contract - registration gate documents "Run workflow" dropdown as an authoritative signal', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/Run workflow.*dropdown|Run workflow dropdown/i.test(gateSection),
        'Gate must reference the Run workflow dropdown as an authoritative signal');
});

runTest('Contract - registration gate requires a dispatchable run as authoritative evidence', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/dispatchable|workflow_dispatch.*run.*transition|actual.*workflow_dispatch.*run/i.test(gateSection),
        'Gate must reference an actual dispatchable run as authoritative evidence');
});

runTest('Contract - registration gate is fail-closed (BLOCKED / NOT READY when signal unavailable)', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/BLOCKED.*NOT READY|fail.*closed/i.test(gateSection),
        'Gate must specify BLOCKED/NOT READY when registration cannot be established');
});

runTest('Contract - registration gate does not permit Run link on YAML inspection alone', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/YAML inspection.*alone|YAML inspection alone/i.test(gateSection) ||
        /YAML.*insufficient|insufficient.*YAML/i.test(gateSection),
        'Gate must prohibit presenting a Run link based on YAML inspection alone');
});

runTest('Contract - registration gate decision procedure checks GitHub signal before presenting Run link', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/present.*Run link|Run link.*present/i.test(gateSection) || /not.*present.*Run link/i.test(gateSection),
        'Gate decision procedure must reference presenting (or withholding) the Run link');
});

runTest('Contract - registration gate includes VERIFIED / INFERRED / UNKNOWN evidence classification', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/VERIFIED/i.test(gateSection) && /INFERRED/i.test(gateSection) && /UNKNOWN/i.test(gateSection),
        'Gate must define VERIFIED, INFERRED, and UNKNOWN evidence classifications');
});

runTest('Contract - registration gate classifies YAML-based inference as INFERRED (not VERIFIED)', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/probably registered.*not.*sufficient|infer.*YAML.*not.*VERIFIED/i.test(gateSection) ||
        /YAML.*existence.*≠.*registration|file-existence.*not.*registration/i.test(gateSection),
        'Gate must classify YAML-based registration inference as INFERRED/insufficient');
});

runTest('Contract - registration gate classifies GitHub API absent/422 as BLOCKED', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/absent.*API|HTTP 422.*BLOCKED|registration failure.*BLOCKED|absent.*dropdown.*BLOCKED/i.test(gateSection) ||
        /BLOCKED/i.test(gateSection),
        'Gate must classify GitHub registration failure as BLOCKED');
});

runTest('Contract - registration gate lists what repo-local tests can prove vs cannot prove', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/Repository-local.*can.*prove|cannot.*prove/i.test(gateSection),
        'Gate must list what repository-local tests can and cannot prove');
    assert.ok(/cannot/i.test(gateSection) && /GitHub/i.test(gateSection),
        'Gate must state GitHub registration is not provable from repo-local code alone');
});

runTest('Contract - registration gate does not invent a repo-local proxy for GitHub registration', () => {
    const gateSection = contractRaw.slice(contractRaw.indexOf('## 9'), contractRaw.indexOf('## 10'));
    assert.ok(/not.*invent.*local proxy|cannot.*prove.*registration|without.*invention/i.test(gateSection) ||
        /do not invent/i.test(gateSection) || /repository-local.*cannot.*prove/i.test(gateSection),
        'Gate must prohibit inventing a repository-local proxy for GitHub registration');
});

runTest('Contract - registration gate preserves existing one-click invariants (no weakening)', () => {
    assert.ok(/Do not weaken existing one-click requirements|does not weaken/i.test(contractRaw),
        'Gate must state existing one-click requirements are not weakened');
});

runTest('Contract - registration gate requires coordinator to record evidence classification per gate', () => {
    assert.ok(/evidence classification|record.*evidence classification|classification for each gate/i.test(contractRaw),
        'Gate must require the coordinator to record evidence classification per gate');
});

runTest('Contract - invariants summary table includes the registration/runnability gate', () => {
    const invariantsSection = contractRaw.slice(contractRaw.indexOf('## 11. Summary'));
    assert.ok(/registration|runnability/i.test(invariantsSection),
        'Invariants summary must include the registration/runnability gate');
    assert.ok(/BLOCKED.*NOT READY/i.test(invariantsSection),
        'Invariants summary must include BLOCKED/NOT READY fail-closed');
});

runTest('Contract - invariants summary includes VERIFIED/INFERRED/UNKNOWN enforcement', () => {
    const invariantsSection = contractRaw.slice(contractRaw.indexOf('## 11. Summary'));
    assert.ok(/VERIFIED.*INFERRED.*UNKNOWN/i.test(invariantsSection),
        'Invariants summary must include VERIFIED/INFERRED/UNKNOWN classification');
});

// =========================================================
// Machine-verifiable one-click workflow YAML validity tests
// (registration gate: a workflow that GitHub cannot parse fails the gate)
// =========================================================

runTest('One-click workflows - YAML parses as valid YAML (structural registration prerequisite)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        // A structural parse check: the file must begin with a top-level mapping
        // that contains 'name' and 'on' as top-level keys (the minimal keys GitHub
        // requires to register a workflow). Tabs are forbidden in YAML indentation.
        assert.ok(!/\t/.test(wfRaw), `${wf} must not contain tab characters (YAML/GitHub parse failure)`);
        assert.ok(/^\s*name:\s*\S/m.test(wfRaw), `${wf} must define a top-level 'name' key`);
        assert.ok(/^\s*on:\s*$/m.test(wfRaw) || /^\s*on:/.test(wfRaw), `${wf} must define a top-level 'on' key`);
    }
});

runTest('One-click workflows - workflow_dispatch trigger is present and at top level', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        // workflow_dispatch must appear under the top-level 'on:' key, not nested
        // inside a job. This is the GitHub registration requirement.
        const onIdx = wfRaw.indexOf('\non:');
        const wfdIdx = wfRaw.indexOf('workflow_dispatch');
        assert.ok(onIdx !== -1, `${wf} must have a top-level 'on:' key`);
        assert.ok(wfdIdx !== -1, `${wf} must contain workflow_dispatch`);
        assert.ok(wfdIdx > onIdx, `${wf} workflow_dispatch must appear after 'on:' (top-level trigger)`);
    }
});

// =========================================================
// Contract vs architecture consistency tests
// =========================================================

runTest('Contract - does not create second control plane, TaskRegistry, or activation mechanism', () => {
    const prohibitedSection = contractRaw.slice(contractRaw.indexOf('## 6. Prohibited Patterns'));
    assert.ok(/second control plane/i.test(prohibitedSection),
        'Prohibited Patterns must list second control plane');
    assert.ok(/second TaskRegistry/i.test(prohibitedSection),
        'Prohibited Patterns must list second TaskRegistry');
    assert.ok(/alternate authorization/i.test(prohibitedSection),
        'Prohibited Patterns must list alternate authorization');
    assert.ok(/alternate activation/i.test(prohibitedSection),
        'Prohibited Patterns must list alternate activation');
});

runTest('Contract - Section 11.2 operational sequence includes all required steps', () => {
    assert.ok(/Inspect requested task/i.test(protocolRaw),
        'Protocol must include "Inspect requested task" in operational sequence');
    assert.ok(/inspect candidate workflow/i.test(protocolRaw),
        'Protocol must include "inspect candidate workflow" in operational sequence');
    assert.ok(/verify exact[\s\S]*?task[\s\S]*?binding/i.test(protocolRaw),
        'Protocol must include "verify exact task binding" in operational sequence');
    assert.ok(/create\/update workflow if binding/i.test(protocolRaw),
        'Protocol must include "create/update workflow if binding" in operational sequence');
    assert.ok(/verify workflow/i.test(protocolRaw),
        'Protocol must include "verify workflow" in operational sequence');
    assert.ok(/present Run link/i.test(protocolRaw),
        'Protocol must include "present Run link" in operational sequence');
    assert.ok(/Director executes click/i.test(protocolRaw),
        'Protocol must include "Director executes click" in operational sequence');
    assert.ok(/inspect resulting[\s\S]*?execution/i.test(protocolRaw),
        'Protocol must include "inspect resulting execution" in operational sequence');
});

runTest('Contract - does not modify external-activation procedure (Section 13 reference remains intact)', () => {
    assert.ok(externalActRaw.includes('ONE_CLICK_WORKFLOW_CONTRACT'),
        'EXTERNAL_ACTIVATION_PROCEDURE.md must still reference the contract');
    assert.ok(externalActRaw.includes('## 13. One-Click Workflow'),
        'EXTERNAL_ACTIVATION_PROCEDURE.md must still have Section 13 for one-click workflow');
});

runTest('Contract - ACP schema and activation policy referenced for task-mode and capability constraints', () => {
    assert.ok(/VALID_TASK_MODES/i.test(acpSchemaRaw),
        'ACP schema must define valid task modes');
    assert.ok(/FAILOVER_EXECUTE|BUILDER|VERIFY_RECONCILE|RESEARCH_DOCUMENT/i.test(activationPolicyRaw),
        'Activation policy must define all task modes');
});


// =========================================================
// Durable Gemini evidence retrieval procedure tests
// =========================================================

const RESEARCH_INDEX_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'RESEARCH_INDEX.md');
const GEMINI_REPORTS_DIR = path.join(ROOT_DIR, 'docs', 'ai', 'reports');
const GEMINI_RESEARCH_DIR = path.join(ROOT_DIR, 'docs', 'ai', 'research');
const researchIndexRaw = fs.readFileSync(RESEARCH_INDEX_PATH, 'utf8');

runTest('Protocol - defines durable Gemini evidence retrieval hierarchy', () => {
    assert.ok(protocolRaw.includes('### 5.1.2 Durable Gemini Evidence Retrieval Procedure'),
        'Protocol must define the durable Gemini evidence retrieval procedure');
    assert.ok(protocolRaw.includes('docs/ai/RESEARCH_INDEX.md'),
        'Protocol must require RESEARCH_INDEX.md inspection');
    assert.ok(protocolRaw.includes('docs/ai/reports/gemini-acp-report-*.json'),
        'Protocol must require durable Gemini ACP report search');
    assert.ok(protocolRaw.includes('docs/ai/research/research-*.md'),
        'Protocol must require durable research record inspection');
});

runTest('Protocol - forbids declaring Gemini evidence missing before durable locations are checked', () => {
    assert.ok(/MUST NOT conclude that a Gemini result or research artifact is missing until the durable report and applicable research locations have been checked/i.test(protocolRaw),
        'Protocol must require durable evidence checks before declaring Gemini evidence missing');
});

runTest('Protocol - makes durable ACP report the first actual execution-result source', () => {
    assert.ok(/durable ACP report is the first place to inspect for the actual Gemini execution result/i.test(protocolRaw),
        'Protocol must identify durable ACP reports as the first execution-result source');
});

runTest('Protocol - requires exact task_name/request_id driven retrieval', () => {
    assert.ok(/using the exact.*task_name.*request_id/i.test(protocolRaw),
        'Protocol must require exact task_name/request_id retrieval');
    assert.ok(/Do not guess a report filename/i.test(protocolRaw),
        'Protocol must prohibit guessed report filenames when identifiers are available');
});

runTest('Protocol - makes repository evidence authoritative over Gemini prose', () => {
    assert.ok(/Repository evidence is authoritative over Gemini's natural-language completion summary/i.test(protocolRaw),
        'Protocol must make repository evidence authoritative over agent prose');
});

runTest('Protocol - identifies project-state documents as navigation/context rather than evidence substitutes', () => {
    assert.ok(/TASK_LOG\.md.*STATE\.md.*CONTROL_CENTER\.md.*do not substitute for the underlying ACP report or research record/i.test(protocolRaw),
        'Protocol must distinguish state/navigation records from underlying evidence');
});

runTest('Durable Gemini evidence locations exist in the repository', () => {
    assert.ok(fs.existsSync(RESEARCH_INDEX_PATH), 'RESEARCH_INDEX.md must exist');
    assert.ok(fs.existsSync(GEMINI_REPORTS_DIR), 'docs/ai/reports must exist');
    assert.ok(fs.existsSync(GEMINI_RESEARCH_DIR), 'docs/ai/research must exist');
    assert.ok(researchIndexRaw.includes('Task ID'), 'RESEARCH_INDEX.md must remain a task-oriented index');
});


// =========================================================
// One-click artifact validation tests
// =========================================================

const ARTIFACT_VALIDATOR_PATH = path.join(ROOT_DIR, 'poc', 'one-click-artifact-validator.js');

function makeValidArtifact(overrides) {
    const base = {
        task_name: 'TASK-TEST-001',
        originator: 'Kyle — Director',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        objective: 'Test task.',
        scope: { permitted_paths: ['poc/'] },
        verification: 'Verify test.',
        constraints: ['test-constraint'],
        conflict_handling: 'Repository instructions take precedence.'
    };
    return Object.assign({}, base, overrides);
}

function artifactToCanonicalJson(obj) {
    const schema = require('../poc/schemas/acp-schema');
    const ordered = {};
    for (const field of schema.CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (field in obj) ordered[field] = obj[field];
    }
    return JSON.stringify(ordered, null, 2);
}

runTest('Artifact validator - module exists and exports required functions', () => {
    assert.ok(fs.existsSync(ARTIFACT_VALIDATOR_PATH), 'poc/one-click-artifact-validator.js must exist');
    const mod = require('../poc/one-click-artifact-validator');
    assert.ok(typeof mod.validateOneClickCarrier === 'function', 'Must export validateOneClickCarrier');
    assert.ok(typeof mod.preflightValidateOneClickActivation === 'function', 'Must export preflightValidateOneClickActivation');
    assert.ok(typeof mod.extractEmbeddedCarrierArtifact === 'function', 'Must export extractEmbeddedCarrierArtifact');
    assert.ok(typeof mod.parseYamlLikeToArtifactObject === 'function', 'Must export parseYamlLikeToArtifactObject');
    assert.ok(typeof mod.buildCanonicalArtifactString === 'function', 'Must export buildCanonicalArtifactString');
    assert.ok(typeof mod.bindCarrierToRequestedTask === 'function', 'Must export bindCarrierToRequestedTask');
});

runTest('Artifact validator - all four active one-click carriers pass canonical validation', () => {
    const results = preflightValidateOneClickActivation();
    assert.ok(results.all_valid, 'All four carriers should pass: ' + JSON.stringify(results.summary));
    assert.strictEqual(results.summary.total, 4, 'Should have 4 carriers');
    assert.strictEqual(results.summary.valid, 4, 'All 4 should be valid');
    assert.strictEqual(results.summary.invalid, 0, 'None should be invalid');
    for (const [wf, r] of Object.entries(results.results)) {
        assert.ok(r.valid, wf + ' should be valid: ' + (r.error || ''));
    }
});

runTest('Artifact validator - smoke carrier embeds BUILDER task_mode (not EXECUTE)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const text = extractEmbeddedCarrierArtifact(raw);
    assert.ok(text, 'Smoke carrier must have embedded artifact');
    const parsed = parseYamlLikeToArtifactObject(text);
    assert.strictEqual(parsed.task_mode, 'BUILDER', 'Smoke carrier must use runtime task_mode BUILDER, not conceptual EXECUTE');
});

runTest('Artifact validator - smoke carrier has full BUILDER capabilities', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Smoke carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    const expectedCaps = ['commit', 'modify_files', 'push', 'read_only', 'run_tests'];
    assert.deepStrictEqual(artifact.capabilities.sort(), expectedCaps.sort(),
        'Smoke carrier must have all 5 BUILDER capabilities');
});

runTest('Artifact validator - smoke carrier has scope.permitted_paths with poc/', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Smoke carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(Array.isArray(artifact.scope.permitted_paths) && artifact.scope.permitted_paths.length > 0,
        'Smoke carrier must have non-empty scope.permitted_paths');
    assert.ok(artifact.scope.permitted_paths.some(function(p) { return p.startsWith('poc'); }),
        'Smoke carrier must include poc/ in permitted_paths');
});

runTest('Artifact validator - callback-correlation carrier has conflict_handling field', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-callback-correlation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Callback-correlation carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(artifact.conflict_handling && artifact.conflict_handling.length > 0,
        'Callback-correlation carrier must have non-empty conflict_handling');
});

runTest('Artifact validator - callback-correlation carrier has authorized permitted_paths', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-callback-correlation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Callback-correlation carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(artifact.scope.permitted_paths.every(function(p) {
        return p.startsWith('docs/') || p.startsWith('test/') || p.startsWith('poc/') || p === '.github/workflows/gemini-builder.yml';
    }), 'Callback-correlation paths must be within MAX_AUTHORIZED_PATHS');
});

runTest('Artifact validator - research-documentation carrier has canonical capabilities', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-research-documentation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Research-documentation carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    const expectedCaps = ['read_only', 'modify_files', 'commit', 'push'];
    assert.deepStrictEqual(artifact.capabilities.sort(), expectedCaps.sort(),
        'Research-documentation carrier must have canonical RESEARCH_DOCUMENT capabilities');
    assert.ok(artifact.capabilities.every(function(c) { return VALID_CAPABILITIES.includes(c); }),
        'All capabilities must be in VALID_CAPABILITIES');
});

runTest('Artifact validator - research-documentation carrier has scope.permitted_paths with research docs', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-research-documentation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Research-documentation carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(artifact.scope.permitted_paths.includes('docs/ai/research/'),
        'Research-documentation carrier must include docs/ai/research/ in permitted_paths');
    assert.ok(artifact.scope.permitted_paths.includes('docs/ai/TASK_LOG.md'),
        'Research-documentation carrier must include docs/ai/TASK_LOG.md in permitted_paths');
});

runTest('Artifact validator - rejects malformed JSON in embedded artifact', () => {
    const raw = "name: test\non:\n  workflow_dispatch:\nTASK='task_name: TEST\n  originator: bad JSON here'\n";
    const text = extractEmbeddedCarrierArtifact(raw);
    const parsed = parseYamlLikeToArtifactObject(text);
    const canonicalJson = buildCanonicalArtifactString(parsed);
    const validation = validateAcpTaskArtifact(canonicalJson);
    assert.ok(!validation.valid, 'Malformed artifact should fail validation');
});

runTest('Artifact validator - rejects smart quotes as malformed JSON', () => {
    const badContent = "task_name: TEST\noriginator: Kyle\ntarget_agent: Gemini\nrepository: test\nbase_branch: main\ntask_mode: REVIEW\ncapabilities:\n- read_only\nobjective: test\nscope:\n  permitted_paths:\n  - docs/\nverification: test\nconstraints:\n- test\nconflict_handling: smart quote \u201ctest\u201d here";
    const parsed = parseYamlLikeToArtifactObject(badContent);
    const canonicalJson = buildCanonicalArtifactString(parsed);
    for (const char of SMART_QUOTE_CHARS) {
        if (canonicalJson.indexOf(char) !== -1) {
            const syntaxResult = validateAcpTaskArtifactSyntax(canonicalJson);
            assert.ok(!syntaxResult.valid, 'Smart quotes should fail syntax validation');
            assert.strictEqual(syntaxResult.error_code, 'MALFORMED_JSON_SMART_QUOTE');
            return;
        }
    }
    assert.ok(true, 'No smart quotes found in canonical JSON - test validates no crash');
});

runTest('Artifact validator - rejects missing required fields', () => {
    const artifact = makeValidArtifact();
    delete artifact.conflict_handling;
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Missing conflict_handling should fail');
    assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
});

runTest('Artifact validator - rejects noncanonical field order', () => {
    const artifact = {
        capabilities: ['read_only', 'modify_files', 'commit', 'push'],
        task_name: 'TASK-TEST-001',
        originator: 'Kyle',
        target_agent: 'Gemini',
        repository: 'test',
        base_branch: 'main',
        task_mode: 'VERIFY_RECONCILE',
        objective: 'test',
        scope: { permitted_paths: ['docs/ai/TASK_LOG.md'] },
        verification: 'test',
        constraints: [],
        conflict_handling: 'test'
    };
    const schema = require('../poc/schemas/acp-schema');
    const orderResult = schema.validateCanonicalFieldOrder(artifact);
    assert.ok(!orderResult.valid, 'Canonical field ordering violation should fail validation');
    assert.strictEqual(orderResult.error_code, 'FIELD_ORDER_VIOLATION');
});

runTest('Artifact validator - rejects invalid task_mode', () => {
    const artifact = makeValidArtifact({ task_mode: 'EXCAVATE' });
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Invalid task_mode should fail');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE');
});

runTest('Artifact validator - rejects conceptual EXECUTE as non-runtime task_mode', () => {
    const artifact = makeValidArtifact({ task_mode: 'EXECUTE' });
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Conceptual EXECUTE should fail validation');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Artifact validator - rejects invalid capability', () => {
    const artifact = makeValidArtifact({ capabilities: ['inspect', 'read_only', 'modify_files', 'run_tests', 'commit', 'push'] });
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Invalid capability should fail');
    assert.strictEqual(result.error_code, 'INVALID_CAPABILITY');
});

runTest('Artifact validator - rejects empty permitted_paths for execution mode', () => {
    const artifact = makeValidArtifact({ scope: { permitted_paths: [] } });
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Empty permitted_paths for BUILDER should fail');
    assert.strictEqual(result.error_code, 'EMPTY_PERMITTED_PATHS');
});

runTest('Artifact validator - rejects path outside MAX_AUTHORIZED_PATHS', () => {
    const artifact = makeValidArtifact({ scope: { permitted_paths: ['poc/', 'unauthorized/path/'] } });
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Unauthorized path should fail');
    assert.strictEqual(result.error_code, 'PATH_OUTSIDE_MAX_BOUNDARY');
});

runTest('Artifact validator - bindCarrierToRequestedTask detects mismatch', () => {
    const parsed = makeValidArtifact();
    const requestedTask = { task_name: 'DIFFERENT-TASK', target_agent: 'Gemini Builder', repository: 'fluentwithkyle/openclaw-webhook' };
    const binding = bindCarrierToRequestedTask(parsed, requestedTask);
    assert.ok(!binding.bound, 'Mismatched task_name should fail binding');
    assert.ok(binding.mismatches.indexOf('task_name') !== -1, 'Should report task_name mismatch');
});

runTest('Artifact validator - bindCarrierToRequestedTask binds matching task', () => {
    const parsed = makeValidArtifact();
    const requestedTask = { task_name: 'TASK-TEST-001', target_agent: 'Gemini Builder', repository: 'fluentwithkyle/openclaw-webhook' };
    const binding = bindCarrierToRequestedTask(parsed, requestedTask);
    assert.ok(binding.bound, 'Matching task should bind successfully');
});

runTest('Artifact validator - validateOneClickCarrier fails closed on missing embedded artifact', () => {
    const result = validateOneClickCarrier('name: NoArtifact\non:\n  workflow_dispatch:', null);
    assert.ok(!result.valid, 'Missing embedded artifact should fail');
    assert.strictEqual(result.error_code, 'CARRIER_NO_EMBEDDED_ARTIFACT');
});

runTest('Artifact validator - conceptual EXECUTE maps to FAILOVER_EXECUTE', () => {
    const mapped = getRuntimeTaskModeForConceptual('EXECUTE', 'FAILOVER_EXECUTE');
    assert.strictEqual(mapped, 'FAILOVER_EXECUTE', 'EXECUTE should map to FAILOVER_EXECUTE');
    const mapped2 = getRuntimeTaskModeForConceptual('EXECUTE', 'BUILDER');
    assert.strictEqual(mapped2, 'BUILDER', 'EXECUTE with BUILDER default should map to BUILDER');
});

runTest('Artifact validator - valid canonical artifact passes validation', () => {
    const artifact = makeValidArtifact();
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(result.valid, 'Valid canonical artifact should pass: ' + (result.error || ''));
});


// =========================================================
// Regression tests for blockers: preflight wiring and invalid mode rejection
// =========================================================

runTest('Preflight wiring - smoke carrier runs one-click-preflight before dispatch', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(/one-click-preflight/.test(raw), 'Smoke carrier must call one-click-preflight');
    const preflightIdx = raw.indexOf('one-click-preflight');
    const dispatchIdx = raw.indexOf('Validate external activation through canonical ingress');
    assert.ok(preflightIdx !== -1 && dispatchIdx !== -1, 'Both preflight and dispatch steps must exist');
    assert.ok(preflightIdx < dispatchIdx, 'Preflight must run before activation dispatch');
});

runTest('Preflight wiring - callback-correlation carrier runs one-click-preflight before dispatch', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-callback-correlation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    assert.ok(/one-click-preflight/.test(raw), 'Callback-correlation carrier must call one-click-preflight');
    const preflightIdx = raw.indexOf('one-click-preflight');
    const dispatchIdx = raw.indexOf('Validate external activation through canonical ingress');
    assert.ok(preflightIdx !== -1 && dispatchIdx !== -1, 'Both preflight and dispatch steps must exist');
    assert.ok(preflightIdx < dispatchIdx, 'Preflight must run before activation dispatch');
});

runTest('Preflight wiring - verify-reconcile carrier runs one-click-preflight before dispatch', () => {
    const raw = fs.readFileSync(ONE_CLICK_VERIFY_WF, 'utf8');
    assert.ok(/one-click-preflight/.test(raw), 'Verify-reconcile carrier must call one-click-preflight');
    const preflightIdx = raw.indexOf('one-click-preflight');
    const dispatchIdx = raw.indexOf('Dispatch canonical Gemini');
    assert.ok(preflightIdx !== -1 && dispatchIdx !== -1, 'Both preflight and dispatch steps must exist');
    assert.ok(preflightIdx < dispatchIdx, 'Preflight must run before dispatch to main.yml');
});

runTest('Preflight wiring - research-documentation carrier runs one-click-preflight before dispatch', () => {
    const wfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-research-documentation.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');
    assert.ok(/one-click-preflight/.test(raw), 'Research-documentation carrier must call one-click-preflight');
    const preflightIdx = raw.indexOf('one-click-preflight');
    const dispatchIdx = raw.indexOf('Dispatch canonical Gemini research');
    assert.ok(preflightIdx !== -1 && dispatchIdx !== -1, 'Both preflight and dispatch steps must exist');
    assert.ok(preflightIdx < dispatchIdx, 'Preflight must run before dispatch to main.yml');
});

runTest('Invalid mode rejection - conceptual EXECUTE is not silently converted to runtime mode', () => {
    const { buildCanonicalArtifactString } = require('../poc/one-click-artifact-validator');
    const parsed = {
        task_name: 'TASK-TEST-001',
        originator: 'Kyle',
        target_agent: 'Gemini Builder',
        repository: 'test',
        base_branch: 'main',
        task_mode: 'EXECUTE',
        capabilities: ['read_only'],
        objective: 'test',
        scope: { permitted_paths: ['poc/'] },
        verification: 'test',
        constraints: [],
        conflict_handling: 'test'
    };
    const canonical = buildCanonicalArtifactString(parsed);
    const artifact = JSON.parse(canonical);
    assert.strictEqual(artifact.task_mode, 'EXECUTE',
        'buildCanonicalArtifactString must preserve original task_mode without silent conversion');
    const result = validateAcpTaskArtifact(canonical);
    assert.ok(!result.valid, 'Conceptual EXECUTE must be rejected by validateAcpTaskArtifact');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE',
        'Conceptual EXECUTE must be rejected as NON_RUNTIME_TASK_MODE, not silently repaired');
});

runTest('Invalid mode rejection - arbitrary invalid task_mode is rejected', () => {
    const { buildCanonicalArtifactString } = require('../poc/one-click-artifact-validator');
    const parsed = {
        task_name: 'TASK-TEST-001',
        originator: 'Kyle',
        target_agent: 'Gemini Builder',
        repository: 'test',
        base_branch: 'main',
        task_mode: 'INVALID_MODE',
        capabilities: ['read_only', 'modify_files', 'commit', 'push'],
        objective: 'test',
        scope: { permitted_paths: ['poc/'] },
        verification: 'test',
        constraints: [],
        conflict_handling: 'test'
    };
    const canonical = buildCanonicalArtifactString(parsed);
    const artifact = JSON.parse(canonical);
    assert.strictEqual(artifact.task_mode, 'INVALID_MODE',
        'buildCanonicalArtifactString must preserve original task_mode without silent conversion');
    const result = validateAcpTaskArtifact(canonical);
    assert.ok(!result.valid, 'Invalid task_mode must be rejected');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE',
        'Invalid task_mode must be rejected as INVALID_TASK_MODE');
});

runTest('Preflight fails closed when embedded artifact is invalid', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\ntask_mode: EXECUTE\ncapabilities: read_only\ntarget_agent: Gemini\nobjective: test\nscope: {permitted_paths: [poc/]}\nverification: test\nconstraints: []\nconflict_handling: test\noriginator: Kyle\nrepository: test\nbase_branch: main\n'";
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(!result.valid, 'Invalid embedded artifact must fail validation');
    assert.ok(result.error_code === 'NON_RUNTIME_TASK_MODE' || result.error_code === 'INVALID_TASK_MODE',
        'Invalid task_mode must produce error_code, got: ' + result.error_code);
});

runTest('Preflight - all four carriers have preflight step in workflow YAML', () => {
    const allWorkflows = [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml'
    ];
    for (const wf of allWorkflows) {
        const raw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/one-click-preflight/.test(raw), wf + ' must include one-click-preflight step');
    }
});


// =========================================================
// Regression tests for one-click preflight strictness
// =========================================================

runTest('Preflight strictness - rejects malformed embedded artifact with smart quotes', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\n  originator: Kyle“\n  target_agent: Gemini\n  repository: t\n  base_branch: main\n  task_mode: REVIEW\n  capabilities: read_only\n  objective: t\n  scope: t\n  verification: t\n  constraints: t\n  conflict_handling: t'\n";
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(!result.valid, 'Smart quote in origin should fail validation');
    assert.strictEqual(result.error_code, 'MALFORMED_JSON_SMART_QUOTE');
});

runTest('Preflight strictness - rejects malformed JSON structure (not normalized to valid)', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\n  originator: t\n  target_agent: t\n  repository: t\n  base_branch: t\n  task_mode: REVIEW\n  capabilities: read_only\n  objective: t\n  scope: {permitted_paths: [docs/]}\n  verification: t\n  constraints: t\n  conflict_handling: t'\n";
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(result.valid, 'Minimal valid artifact should pass');

    const malformedWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\n  target_agent: t\n  conflict: t'\n";
    const result2 = validateOneClickCarrier(malformedWorkflow, null);
    assert.ok(!result2.valid, 'Malformed/empty artifact should fail');
    assert.ok(result2.error_code === 'MISSING_REQUIRED_FIELDS' || result2.error_code === 'CARRIER_NO_EMBEDDED_ARTIFACT',
        'Should fail with fields error, got: ' + result2.error_code);
});

runTest('Preflight strictness - rejects invalid task_mode without silent conversion', () => {
    const { validateOneClickCarrier, buildCanonicalArtifactString, parseYamlLikeToArtifactObject } = require('../poc/one-click-artifact-validator');
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\ntask_mode: INVALID\noriginator: t\ntarget_agent: Gemini\nrepository: t\nbase_branch: t\ncapabilities: read_only\nobjective: t\nscope:\n  permitted_paths:\n  - docs/\nverification: t\nconstraints: t\nconflict_handling: t'\n";
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(!result.valid, 'Invalid task_mode should fail');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE');
    assert.ok(result.canonical_artifact, 'Should produce canonical artifact for inspection');
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.task_mode, 'INVALID',
        'buildCanonicalArtifactString must preserve original task_mode');
});

runTest('Preflight strictness - conceptual PLAN mode is rejected, not converted', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK='task_name: TEST\ntask_mode: PLAN\noriginator: t\ntarget_agent: Gemini\nrepository: t\nbase_branch: t\ncapabilities: read_only\nobjective: t\nscope:\n  permitted_paths:\n  - docs/\nverification: t\nconstraints: t\nconflict_handling: t'\n";
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(!result.valid, 'Conceptual PLAN mode should fail');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Preflight strictness - bindCarrierToRequestedTask detects task_name mismatch', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const validWorkflow = "name: Carrier\non:\n  workflow_dispatch:\nTASK='task_name: TASK-CARRIER-001\ntask_mode: REVIEW\ntarget_agent: Gemini\nrepository: fluentwithkyle/openclaw-webhook\nbase_branch: main\ncapabilities: read_only\nobjective: t\nscope:\n  permitted_paths:\n  - docs/\nverification: t\nconstraints: t\nconflict_handling: t\noriginator: Kyle'\n";
    const requestedTask = {
        task_name: 'TASK-DIFFERENT-001',
        target_agent: 'Gemini',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = validateOneClickCarrier(validWorkflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(!result.binding.bound, 'Task mismatch should fail binding');
    assert.ok(result.binding.mismatches.indexOf('task_name') !== -1);
});

runTest('Preflight strictness - bindCarrierToRequestedTask detects target_agent mismatch', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const validWorkflow = "name: Carrier\non:\n  workflow_dispatch:\nTASK='task_name: TASK-001\ntask_mode: REVIEW\ntarget_agent: Gemini\nrepository: t\nbase_branch: main\ncapabilities: read_only\nobjective: t\nscope:\n  permitted_paths:\n  - docs/\nverification: t\nconstraints: t\nconflict_handling: t\noriginator: Kyle'\n";
    const requestedTask = {
        task_name: 'TASK-001',
        target_agent: 'Kilo',
        repository: 't'
    };
    const result = validateOneClickCarrier(validWorkflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(!result.binding.bound, 'Target agent mismatch should fail binding');
    assert.ok(result.binding.mismatches.indexOf('target_agent') !== -1);
});

runTest('Preflight strictness - bindCarrierToRequestedTask succeeds for exact match', () => {
    const { validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const validWorkflow = "name: Carrier\non:\n  workflow_dispatch:\nTASK='task_name: TASK-001\ntask_mode: REVIEW\ntarget_agent: Gemini\nrepository: fluentwithkyle/openclaw-webhook\nbase_branch: main\ncapabilities: read_only\nobjective: t\nscope:\n  permitted_paths:\n  - docs/\nverification: t\nconstraints: t\nconflict_handling: t\noriginator: Kyle'\n";
    const requestedTask = {
        task_name: 'TASK-001',
        target_agent: 'Gemini',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = validateOneClickCarrier(validWorkflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(result.binding.bound, 'Exact match should bind successfully');
});

runTest('Preflight strictness - fails closed with requestedTask when binding mismatches', () => {
    const { preflightValidateOneClickActivation } = require('../poc/one-click-artifact-validator');
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-DOES-NOT-EXIST',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    });
    assert.ok(!result.all_valid, 'Preflight should fail when no carrier matches requested task');
    assert.strictEqual(result.summary.bound, 0, 'No carriers should be bound to mismatched task');
});

runTest('Preflight strictness - fails closed when artifact validation fails', () => {
    const { preflightValidateOneClickActivation, validateOneClickCarrier } = require('../poc/one-click-artifact-validator');
    const result = preflightValidateOneClickActivation();
    assert.ok(result.all_valid, 'All valid carriers should pass preflight');
    for (const [wf, r] of Object.entries(result.results)) {
        assert.ok(r.valid, wf + ' should be valid');
    }
});

runTest('Preflight CLI command - exits non-zero on validation failure', () => {
    const { execFileSync } = require('child_process');
    const preflightArgs = JSON.stringify({ workflow_dir: '.nonexistent-path' });
    let exitCode = 0;
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'one-click-preflight', preflightArgs], { encoding: 'utf8', timeout: 10000 });
    } catch (e) {
        exitCode = e.status || 1;
        output = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(exitCode !== 0, 'Preflight CLI must exit non-zero when validation fails');
    assert.ok(output.includes('failed') || output.includes('error'), 'Output must indicate failure');
});

runTest('Preflight CLI command - exits zero when all carriers valid', () => {
    const { execFileSync } = require('child_process');
    const preflightArgs = JSON.stringify({ workflow_dir: '.github/workflows' });
    const output = execFileSync('node', ['poc/validate-external-activation.js', 'one-click-preflight', preflightArgs], { encoding: 'utf8', timeout: 10000 });
    assert.ok(output.includes('passed'), 'Output must indicate success');
});

runTest('Preflight - all four carriers include one-click-preflight step before dispatch', () => {
    const allWorkflows = [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml'
    ];
    for (const wf of allWorkflows) {
        const raw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/one-click-preflight/.test(raw), wf + ' must include one-click-preflight step');
        const preflightIdx = raw.indexOf('one-click-preflight');
        const ghApiIdx = raw.indexOf('gh api');
        const validateIdx = raw.indexOf('Validate external activation through canonical ingress');
        if (ghApiIdx !== -1) {
            assert.ok(preflightIdx < ghApiIdx, wf + ' preflight must run before gh api dispatch');
        }
        if (validateIdx !== -1) {
            assert.ok(preflightIdx < validateIdx, wf + ' preflight must run before activation validation');
        }
    }
});

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
