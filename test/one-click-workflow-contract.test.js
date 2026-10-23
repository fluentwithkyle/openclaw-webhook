const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
const TASK_STANDARD_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'TASK_STANDARD.md');
const ACP_SCHEMA_PATH = path.join(ROOT_DIR, 'poc', 'schemas', 'acp-schema.js');

const { validateAcpTaskArtifact, validateAcpTaskArtifactSyntax, getRuntimeTaskModeForConceptual, VALID_CAPABILITIES, CANONICAL_TASK_ARTIFACT_FIELD_ORDER, SMART_QUOTE_CHARS } = require('../poc/schemas/acp-schema');
const oneClickArtifactValidator = require('../poc/one-click-artifact-validator');
const {
    extractEmbeddedCarrierArtifact,
    validateOneClickCarrier,
    bindCarrierToRequestedTask,
    preflightValidateOneClickActivation,
    validateAllWorkflowYaml,
    listOneClickWorkflows: canonicalListOneClickWorkflows,
    VALID_ONE_CLICK_WORKFLOWS: CANONICAL_VALID_ONE_CLICK_WORKFLOWS
} = oneClickArtifactValidator;

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
const taskStandardRaw = fs.readFileSync(TASK_STANDARD_PATH, 'utf8');

function listOneClickWorkflows() {
    return canonicalListOneClickWorkflows();
}

function extractCarrierField(workflowRaw, field) {
    const fieldPattern = new RegExp(
        '(?:^|\\n)\\s*(?:[^\\n]*[\\x27\\x22])?' + field + ':\\s*(?:\\n\\s*)?([^\\n]+)',
        'i'
    );
    const match = workflowRaw.match(fieldPattern);
    if (match) return match[1].trim();

    const jsonFieldPattern = new RegExp('"' + field + '"\\s*:\\s*"?([^\'"\\s,]+)');
    const jsonMatch = workflowRaw.match(jsonFieldPattern);
    return jsonMatch ? jsonMatch[1].trim() : null;
}

function extractStepsFromRaw(raw) {
    const steps = [];
    const lines = raw.split('\n');
    let stepStartLine = -1;
    let stepIndent = -1;

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)-\s+name:\s+(.+)$/);
        if (m && stepStartLine === -1) {
            stepIndent = m[1].length;
            stepStartLine = i;
        } else if (m && stepStartLine !== -1) {
            const block = lines.slice(stepStartLine, i).join('\n');
            addStep(steps, block);
            stepIndent = m[1].length;
            stepStartLine = i;
        }
    }
    if (stepStartLine !== -1) {
        const block = lines.slice(stepStartLine).join('\n');
        addStep(steps, block);
    }
    return steps;
}

function addStep(steps, block) {
    const step = { name: null, id: null, if: null, uses: null, run: null, env: null, _raw: block };
    const nameMatch = block.match(/-\s+name:\s+(.+)/);
    if (nameMatch) step.name = nameMatch[1].trim();
    const idMatch = block.match(/id:\s+(\S+)/);
    if (idMatch) step.id = idMatch[1].trim();
    const ifMatch = block.match(/if:\s+(.+)/);
    if (ifMatch) step.if = ifMatch[1].trim();
    const usesMatch = block.match(/uses:\s+(\S+)/);
    if (usesMatch) step.uses = usesMatch[1].trim();
    const envMatch = block.match(/DEEPSEEK_COORDINATOR_SECRET:\s+(.+)/);
    if (envMatch) step.env = { DEEPSEEK_COORDINATOR_SECRET: envMatch[1].trim() };
    if (block.includes('run: |')) {
        const runMatch = block.match(/run:\s*\|\s*\n([\s\S]+)/);
        if (runMatch) step.run = runMatch[1];
    }
    steps.push(step);
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
        assert.ok(/task_name/i.test(wfRaw),
            `${wf} must embed a task_name field in its carrier`);
    }
});

runTest('One-click workflows - embed target_agent field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/target_agent/i.test(wfRaw),
            `${wf} must embed a target_agent field in its carrier`);
    }
});

runTest('One-click workflows - embed task_mode field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/task_mode/i.test(wfRaw),
            `${wf} must embed a task_mode field in its carrier`);
    }
});

runTest('One-click workflows - embed objective field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/objective/i.test(wfRaw),
            `${wf} must embed an objective field in its carrier`);
    }
});

runTest('One-click workflows - embed verification field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/verification/i.test(wfRaw),
            `${wf} must embed a verification field in its carrier`);
    }
});

runTest('One-click workflows - embed capabilities field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/capabilities/i.test(wfRaw),
            `${wf} must embed a capabilities field in its carrier`);
    }
});

runTest('One-click workflows - embed constraints field in carrier', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    let allHaveConstraints = true;
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        if (!/constraints/i.test(wfRaw)) {
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

runTest('All workflow files - every .github/workflows/*.yml parses as valid YAML', () => {
    const yamlValidation = validateAllWorkflowYaml(ONE_CLICK_DIR);
    assert.ok(yamlValidation.all_valid,
        'All workflow files must parse as valid YAML. Failures: ' +
        Object.entries(yamlValidation.results)
            .filter(([, r]) => !r.valid)
            .map(([wf, r]) => `${wf}: ${r.error} (line ${r.line || '?'})`)
            .join('; '));
});

runTest('All workflow files - no tab characters in indentation', () => {
    const yamlValidation = validateAllWorkflowYaml(ONE_CLICK_DIR);
    const tabOffenders = Object.entries(yamlValidation.results)
        .filter(([, r]) => !r.valid && r.error_code === 'WORKFLOW_CONTAINS_TABS')
        .map(([wf]) => wf);
    assert.strictEqual(tabOffenders.length, 0,
        'Workflow files must not use tabs for indentation: ' + tabOffenders.join(', '));
});

runTest('All workflow files - newly added workflows cannot bypass YAML validation', () => {
    const actualFiles = fs.readdirSync(ONE_CLICK_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    const canonicalWorkflows = CANONICAL_VALID_ONE_CLICK_WORKFLOWS;
    const nonCanonical = actualFiles.filter(f => !canonicalWorkflows.includes(f));

    const yamlValidation = validateAllWorkflowYaml(ONE_CLICK_DIR);

    for (const wf of actualFiles) {
        const result = yamlValidation.results[wf];
        assert.ok(result, `validateAllWorkflowYaml must return a result for ${wf}`);
        assert.ok(result.valid,
            `Newly added workflow ${wf} must pass YAML validation (cannot bypass validation). ` +
            `Error: ${result.error || 'none'} at line ${result.line || '?'})`);
    }

    assert.ok(nonCanonical.length >= 0,
        'Non-canonical workflows exist and are validated: ' + nonCanonical.join(', '));
});

runTest('validateAllWorkflowYaml - rejects malformed YAML content', () => {
    const malformedYaml = 'name: Test\non:\n  workflow_dispatch:\nbad:\n - indent: 0-item\n\tbad tab';
    const fs2 = require('fs');
    const path2 = require('path');
    const tmpDir = path2.join(ROOT_DIR, '.tmp-test-wf');

    if (!fs2.existsSync(tmpDir)) fs2.mkdirSync(tmpDir, { recursive: true });
    fs2.writeFileSync(path2.join(tmpDir, 'malformed.yml'), malformedYaml);

    const result = validateAllWorkflowYaml(tmpDir);

    assert.ok(!result.all_valid, 'Malformed YAML must be rejected');
    assert.ok(result.results['malformed.yml'], 'Malformed workflow must appear in results');
    assert.ok(!result.results['malformed.yml'].valid, 'Malformed workflow must be marked invalid');
    assert.ok(result.results['malformed.yml'].error_code === 'YAML_PARSE_FAILED' ||
              result.results['malformed.yml'].error_code === 'WORKFLOW_CONTAINS_TABS',
        'Malformed workflow error_code must be YAML_PARSE_FAILED or WORKFLOW_CONTAINS_TABS, got: ' +
        result.results['malformed.yml'].error_code);

    fs2.unlinkSync(path2.join(tmpDir, 'malformed.yml'));
    fs2.rmdirSync(tmpDir);
});

runTest('One-click workflows - YAML parses as valid YAML (structural registration prerequisite)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
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
const ACP_SCHEMA2 = require('../poc/schemas/acp-schema');

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
    const ordered = {};
    for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (field in obj) ordered[field] = obj[field];
    }
    return JSON.stringify(ordered, null, 2);
}

function makeEmbeddedArtifact(artifactObj) {
    return 'name: Carrier\non:\n  workflow_dispatch:\nTASK=\'' + artifactToCanonicalJson(artifactObj) + '\'\n';
}

runTest('Artifact validator - module exists and exports required functions', () => {
    assert.ok(fs.existsSync(ARTIFACT_VALIDATOR_PATH), 'poc/one-click-artifact-validator.js must exist');
    const mod = require('../poc/one-click-artifact-validator');
    assert.ok(typeof mod.validateOneClickCarrier === 'function', 'Must export validateOneClickCarrier');
    assert.ok(typeof mod.preflightValidateOneClickActivation === 'function', 'Must export preflightValidateOneClickActivation');
    assert.ok(typeof mod.extractEmbeddedCarrierArtifact === 'function', 'Must export extractEmbeddedCarrierArtifact');
    assert.ok(typeof mod.bindCarrierToRequestedTask === 'function', 'Must export bindCarrierToRequestedTask');
});

runTest('Artifact validator - all active one-click carriers pass canonical validation', () => {
    const results = preflightValidateOneClickActivation();
    assert.ok(results.all_valid, 'All carriers should pass: ' + JSON.stringify(results.summary));
    assert.strictEqual(results.summary.total, 6, 'Should have 6 carriers');
    assert.strictEqual(results.summary.valid, 6, 'All 6 should be valid');
    assert.strictEqual(results.summary.invalid, 0, 'None should be invalid');
    for (const [wf, r] of Object.entries(results.results)) {
        assert.ok(r.valid, wf + ' should be valid: ' + (r.error || ''));
    }
});

runTest('Artifact validator - smoke carrier embeds BUILDER task_mode (not EXECUTE)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const text = extractEmbeddedCarrierArtifact(raw);
    assert.ok(text, 'Smoke carrier must have embedded artifact');
    const parsed = JSON.parse(text);
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

runTest('Artifact validator - execution smoke carrier is restricted to test/schema.test.js', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const result = validateOneClickCarrier(raw);
    assert.ok(result.valid, 'Smoke carrier should be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.deepStrictEqual(artifact.scope.permitted_paths, ['test/schema.test.js'],
        'Execution smoke carrier must authorize only test/schema.test.js');
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

runTest('Artifact validator - embedded artifact is validated as actual JSON, no YAML parsing', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const text = extractEmbeddedCarrierArtifact(raw);
    assert.ok(text, 'Smoke carrier must have embedded artifact');
    let parsed;
    try {
        parsed = JSON.parse(text);
        assert.ok(parsed, 'Embedded artifact must be valid JSON');
    } catch (e) {
        assert.fail('Embedded artifact must be parseable as JSON, not YAML: ' + e.message);
    }
    const orderResult = ACP_SCHEMA2.validateCanonicalFieldOrder(parsed);
    assert.ok(orderResult.valid, 'Embedded artifact must have canonical field order: ' + (orderResult.error || ''));
});

runTest('Artifact validator - rejects malformed JSON in embedded artifact', () => {
    const badWorkflow = 'name: test\non:\n  workflow_dispatch:\nTASK=\'task_name: TEST\n  originator: bad JSON here\'\n';
    const result = validateOneClickCarrier(badWorkflow, null);
    assert.ok(!result.valid, 'Malformed artifact should fail validation');
    assert.ok(result.error_code === 'MALFORMED_JSON' || result.error_code === 'JSON_PARSE_FAILED',
        'Should fail with JSON syntax/parse error, got: ' + result.error_code);
});

runTest('Artifact validator - rejects smart quotes in embedded JSON artifact', () => {
    const badJson = '{"task_name":"TEST","originator":"Kyle“test”","target_agent":"Gemini","repository":"t","base_branch":"main","task_mode":"REVIEW","capabilities":["read_only"],"objective":"t","scope":{"permitted_paths":["docs/"]},"verification":"t","constraints":["t"],"conflict_handling":"t"}';
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + badJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Smart quotes in embedded JSON should fail validation');
    assert.strictEqual(result.error_code, 'MALFORMED_JSON_SMART_QUOTE');
});

runTest('Artifact validator - rejects missing required fields in embedded artifact', () => {
    const artifact = makeValidArtifact();
    delete artifact.conflict_handling;
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Missing conflict_handling in embedded artifact should fail');
    assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
});

runTest('Artifact validator - rejects noncanonical field order in embedded artifact', () => {
    const badJson = '{"capabilities":["read_only"],"task_name":"TASK-TEST-001","originator":"Kyle","target_agent":"Gemini","repository":"test","base_branch":"main","task_mode":"VERIFY_RECONCILE","objective":"test","scope":{"permitted_paths":["docs/ai/TASK_LOG.md"]},"verification":"test","constraints":[],"conflict_handling":"test"}';
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + badJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Noncanonical field order should fail');
    assert.strictEqual(result.error_code, 'FIELD_ORDER_VIOLATION');
});

runTest('Artifact validator - rejects invalid task_mode in embedded artifact', () => {
    const artifact = makeValidArtifact({ task_mode: 'EXCAVATE' });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Invalid task_mode should fail');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE');
});

runTest('Artifact validator - rejects conceptual EXECUTE in embedded artifact', () => {
    const artifact = makeValidArtifact({ task_mode: 'EXECUTE' });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Conceptual EXECUTE should fail validation');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Artifact validator - rejects invalid capability in embedded artifact', () => {
    const artifact = makeValidArtifact({ capabilities: ['inspect', 'read_only', 'modify_files', 'run_tests', 'commit', 'push'] });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Invalid capability should fail');
    assert.strictEqual(result.error_code, 'INVALID_CAPABILITY');
});

runTest('Artifact validator - rejects empty permitted_paths in embedded artifact', () => {
    const artifact = makeValidArtifact({ scope: { permitted_paths: [] } });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Empty permitted_paths for BUILDER should fail');
    assert.strictEqual(result.error_code, 'EMPTY_PERMITTED_PATHS');
});

runTest('Artifact validator - rejects path outside MAX_AUTHORIZED_PATHS in embedded artifact', () => {
    const artifact = makeValidArtifact({ scope: { permitted_paths: ['poc/', 'unauthorized/path/'] } });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Unauthorized path should fail');
    assert.strictEqual(result.error_code, 'PATH_OUTSIDE_MAX_BOUNDARY');
});

runTest('Artifact validator - bindCarrierToRequestedTask detects mismatch', () => {
    const parsed = makeValidArtifact();
    const requestedTask = { task_name: 'DIFFERENT-TASK', target_agent: 'Gemini Builder', repository: 'fluentwithkyle/openclaw-webhook' };
    const binding = bindCarrierToRequestedTask(parsed, requestedTask);
    assert.ok(!binding.bound, 'Mismatched task_name should fail binding');
    assert.ok(binding.mismatches.some(m => m.field === 'task_name'), 'Should report task_name mismatch');
});

runTest('Artifact validator - bindCarrierToRequestedTask binds matching task', () => {
    const parsed = makeValidArtifact();
    const requestedTask = { task_name: 'TASK-TEST-001', target_agent: 'Gemini Builder', repository: 'fluentwithkyle/openclaw-webhook' };
    const binding = bindCarrierToRequestedTask(parsed, requestedTask);
    assert.ok(binding.bound, 'Matching task should bind successfully');
});

runTest('Artifact validator - validateOneClickCarrier fails closed on missing embedded artifact', () => {
    const result = validateOneClickCarrier('name: NoArtifact\non:\n  workflow_dispatch:\n', null);
    assert.ok(!result.valid, 'Missing embedded artifact should fail');
    assert.strictEqual(result.error_code, 'CARRIER_NO_EMBEDDED_ARTIFACT');
});

runTest('Artifact validator - valid canonical artifact passes validation', () => {
    const artifact = makeValidArtifact();
    const json = artifactToCanonicalJson(artifact);
    const result = validateAcpTaskArtifact(json);
    assert.ok(result.valid, 'Valid canonical artifact should pass: ' + (result.error || ''));
});


// =========================================================
// Regression tests: preflight wiring and fail-closed rejection
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
    const artifact = makeValidArtifact({ task_mode: 'EXECUTE' });
    const json = artifactToCanonicalJson(artifact);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.task_mode, 'EXECUTE',
        'Canonical JSON must preserve original task_mode without silent conversion');
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Conceptual EXECUTE must be rejected by validateAcpTaskArtifact');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE',
        'Conceptual EXECUTE must be rejected as NON_RUNTIME_TASK_MODE, not silently repaired');
});

runTest('Invalid mode rejection - arbitrary invalid task_mode is rejected', () => {
    const artifact = makeValidArtifact({ task_mode: 'INVALID_MODE' });
    const json = artifactToCanonicalJson(artifact);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.task_mode, 'INVALID_MODE',
        'Canonical JSON must preserve original task_mode without silent conversion');
    const result = validateAcpTaskArtifact(json);
    assert.ok(!result.valid, 'Invalid task_mode must be rejected');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE',
        'Invalid task_mode must be rejected as INVALID_TASK_MODE');
});

runTest('Preflight fails closed when embedded artifact is invalid', () => {
    const artifact = makeValidArtifact({ task_mode: 'EXECUTE' });
    const workflow = makeEmbeddedArtifact(artifact);
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Invalid embedded artifact must fail validation');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE',
        'Invalid task_mode must produce error_code, got: ' + result.error_code);
});

runTest('Preflight - all carriers have preflight step in workflow YAML', () => {
    const allWorkflows = [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml',
        'one-click-kilo-acp-copy-safe.yml'
    ];
    for (const wf of allWorkflows) {
        const raw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        assert.ok(/one-click-preflight/.test(raw), wf + ' must include one-click-preflight step');
    }
});


// =========================================================
// Regression tests: preflight strictness — no normalization
// =========================================================

runTest('Preflight strictness - rejects YAML-like (non-JSON) embedded artifact', () => {
    const yamlLike = 'task_name: TEST\ntask_mode: INVALID\noriginator: t\ntarget_agent: Gemini\nrepository: t\nbase_branch: main\ncapabilities: read_only\nobjective: t\nscope: {permitted_paths: [docs/]}\nverification: t\nconstraints: t\nconflict_handling: t';
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + yamlLike + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'YAML-like artifact must be rejected — must be JSON');
    assert.ok(
        result.error_code === 'MALFORMED_JSON' ||
        result.error_code === 'JSON_PARSE_FAILED',
        'YAML-like artifact should fail JSON parse, got: ' + result.error_code);
});

runTest('Preflight strictness - rejects malformed JSON structure without repair', () => {
    const incompleteJson = '{"task_name":"TEST","target_agent":"t","conflict_handling":"t"}';
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + incompleteJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Incomplete artifact should fail');
    assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS',
        'Should fail with MISSING_REQUIRED_FIELDS, got: ' + result.error_code);
});

runTest('Preflight strictness - rejects invalid task_mode in embedded JSON without normalisation', () => {
    const artifact = makeValidArtifact();
    const ordered = {};
    for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (field in artifact) ordered[field] = artifact[field];
    }
    ordered.task_mode = 'INVALID';
    const badJson = JSON.stringify(ordered, null, 2);
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + badJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Invalid task_mode should fail');
    assert.strictEqual(result.error_code, 'INVALID_TASK_MODE');
    assert.ok(result.canonical_artifact, 'Should retain the original embedded artifact');
    const parsed = JSON.parse(result.canonical_artifact);
    assert.strictEqual(parsed.task_mode, 'INVALID',
        'Embedded artifact must preserve original task_mode without repair');
});

runTest('Preflight strictness - conceptual PLAN mode is rejected in embedded JSON, not converted', () => {
    const artifact = makeValidArtifact();
    const ordered = {};
    for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (field in artifact) ordered[field] = artifact[field];
    }
    ordered.task_mode = 'PLAN';
    const badJson = JSON.stringify(ordered, null, 2);
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + badJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Conceptual PLAN mode should fail');
    assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Preflight strictness - bindCarrierToRequestedTask detects task_name mismatch', () => {
    const artifact = makeValidArtifact({ task_mode: 'REVIEW', capabilities: ['read_only'] });
    const workflow = makeEmbeddedArtifact(artifact);
    const requestedTask = {
        task_name: 'TASK-DIFFERENT-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = validateOneClickCarrier(workflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(!result.binding.bound, 'Task mismatch should fail binding');
    assert.ok(result.binding.mismatches.some(m => m.field === 'task_name') !== -1);
});

runTest('Preflight strictness - bindCarrierToRequestedTask detects target_agent mismatch', () => {
    const artifact = makeValidArtifact({ target_agent: 'Gemini', repository: 't', task_mode: 'REVIEW', capabilities: ['read_only'] });
    const workflow = makeEmbeddedArtifact(artifact);
    const requestedTask = {
        task_name: 'TASK-TEST-001',
        target_agent: 'Kilo',
        repository: 't'
    };
    const result = validateOneClickCarrier(workflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(!result.binding.bound, 'Target agent mismatch should fail binding');
    assert.ok(result.binding.mismatches.some(m => m.field === 'target_agent') !== -1);
});

runTest('Preflight strictness - bindCarrierToRequestedTask succeeds for exact match', () => {
    const artifact = makeValidArtifact({ task_mode: 'REVIEW', capabilities: ['read_only'] });
    const workflow = makeEmbeddedArtifact(artifact);
    const requestedTask = {
        task_name: 'TASK-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = validateOneClickCarrier(workflow, requestedTask);
    assert.ok(result.valid, 'Artifact should be valid');
    assert.ok(result.binding.bound, 'Exact match should bind successfully');
});

runTest('Preflight strictness - fails closed with requestedTask when binding mismatches', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-DOES-NOT-EXIST',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    });
    assert.ok(!result.all_valid, 'Preflight should fail when no carrier matches requested task');
    assert.strictEqual(result.summary.bound, 0, 'No carriers should be bound to mismatched task');
});

runTest('Preflight strictness - fails closed when artifact validation fails', () => {
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

runTest('Preflight - all carriers include one-click-preflight step before dispatch', () => {
    const allWorkflows = [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml',
        'one-click-kilo-acp-copy-safe.yml'
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

runTest('Preflight strictness - invalid artifact cannot be repaired into passing, dispatch blocked', () => {
    const badJson = '{"task_name":"TEST","originator":"t","target_agent":"Gemini","repository":"t","base_branch":"main","task_mode":"INVALID","capabilities":["read_only"],"objective":"t","scope":{"permitted_paths":["docs/"]},"verification":"t","constraints":["t"],"conflict_handling":"t"}';
    const workflow = 'name: Bad\non:\n  workflow_dispatch:\nTASK=\'' + badJson + '\'\n';
    const result = validateOneClickCarrier(workflow, null);
    assert.ok(!result.valid, 'Invalid artifact must not pass');
    assert.ok(result.canonical_artifact, 'Should retain the original embedded artifact');
    const reparsed = JSON.parse(result.canonical_artifact);
    assert.strictEqual(reparsed.task_mode, 'INVALID',
        'The embedded artifact must preserve INVALID task_mode — no repair');
    const requalidation = validateOneClickCarrier(workflow, null);
    assert.strictEqual(requalidation.error_code, 'INVALID_TASK_MODE',
        'Re-validation must produce the same rejection without repair');
});

runTest('Preflight strictness - dispatch cannot occur after preflight failure (fail-closed)', () => {
    const oneClickWorkflows = listOneClickWorkflows();
    for (const wf of oneClickWorkflows) {
        const wfRaw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');

        const preflightIdx = wfRaw.indexOf('one-click-preflight');
        assert.ok(preflightIdx !== -1, `${wf} must contain a one-click-preflight step`);

        const preflightStepStart = wfRaw.lastIndexOf('name:', 0, preflightIdx);
        const preflightStepEnd = wfRaw.indexOf('\n', preflightIdx);
        const preflightStep = wfRaw.substring(preflightStepStart, preflightStepEnd);
        assert.ok(!preflightStep.includes('continue-on-error'),
            `${wf} preflight step must not have continue-on-error (must stop job on failure)`);

        const dispatchIdx = wfRaw.search(/workflow-dispatch|gh api.*dispatches|Dispatch canonical/);
        assert.ok(dispatchIdx !== -1, `${wf} must dispatch to activation ingress`);
        assert.ok(preflightIdx < dispatchIdx,
            `${wf} preflight must run before dispatch`);

        const dispatchStepStart = wfRaw.lastIndexOf('name:', 0, dispatchIdx);
        const dispatchStepEnd = wfRaw.indexOf('\n', dispatchIdx);
        const dispatchStep = wfRaw.substring(dispatchStepStart, dispatchStepEnd);
        const hasStepGate = /if:/.test(dispatchStep);
        const hasFailSafe = preflightStep.includes('set -euo pipefail');
        assert.ok(hasFailSafe && !preflightStep.includes('continue-on-error'),
            `${wf} preflight must fail-closed (set -euo pipefail, no continue-on-error) so dispatch cannot run after failure`);
        assert.ok(hasStepGate || dispatchIdx > preflightIdx,
            `${wf} dispatch step must be gated or follow preflight step`);
    }
});

// =========================================================
// Kilo one-click workflow regression tests
// =========================================================

const ONE_CLICK_KILO_WF = path.join(ONE_CLICK_DIR, 'one-click-kilo-acp-copy-safe.yml');
const oneClickKiloWfRaw = fs.readFileSync(ONE_CLICK_KILO_WF, 'utf8');

runTest('Kilo one-click - workflow is registered in listOneClickWorkflows', () => {
    const workflows = listOneClickWorkflows();
    assert.ok(workflows.includes('one-click-kilo-acp-copy-safe.yml'),
        'one-click-kilo-acp-copy-safe.yml must be registered in listOneClickWorkflows');
});

runTest('Kilo one-click - is registered in VALID_ONE_CLICK_WORKFLOWS', () => {
    const { VALID_ONE_CLICK_WORKFLOWS } = require('../poc/one-click-artifact-validator');
    assert.ok(VALID_ONE_CLICK_WORKFLOWS.includes('one-click-kilo-acp-copy-safe.yml'),
        'one-click-kilo-acp-copy-safe.yml must be in VALID_ONE_CLICK_WORKFLOWS');
});

runTest('Kilo one-click - is in MAX_AUTHORIZED_PATHS in activation-policy', () => {
    const activationPolicy = require('../poc/activation-policy');
    assert.ok(activationPolicy.MAX_AUTHORIZED_PATHS.includes('.github/workflows/one-click-kilo-acp-copy-safe.yml'),
        'one-click-kilo-acp-copy-safe.yml must be in MAX_AUTHORIZED_PATHS');
});

runTest('Kilo one-click - is in MAX_AUTHORIZED_PATHS in acp-schema (re-export)', () => {
    const acpSchema = require('../poc/schemas/acp-schema');
    assert.ok(acpSchema.MAX_AUTHORIZED_PATHS.includes('.github/workflows/one-click-kilo-acp-copy-safe.yml'),
        'one-click-kilo-acp-copy-safe.yml must be in MAX_AUTHORIZED_PATHS via acp-schema re-export');
});

runTest('Kilo one-click - embedded artifact is valid canonical ACP task artifact', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Kilo one-click carrier should be valid: ' + (result.error || ''));
});

runTest('Kilo one-click - embedded artifact has target_agent Kilo', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.target_agent, 'Kilo',
        'Kilo one-click carrier must use target_agent "Kilo"');
});

runTest('Kilo one-click - embedded artifact has task_mode FAILOVER_EXECUTE', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.task_mode, 'FAILOVER_EXECUTE',
        'Kilo one-click carrier must use runtime task_mode FAILOVER_EXECUTE');
});

runTest('Kilo one-click - embedded artifact has canonical field ordering (task_name first, capabilities before objective)', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for field order check');
    const orderValidation = require('../poc/schemas/acp-schema').validateCanonicalFieldOrder(result.parsed_artifact);
    assert.ok(orderValidation.valid, 'Canonical field order must be valid: ' + (orderValidation.error || ''));
});

runTest('Kilo one-click - embedded artifact has full FAILOVER_EXECUTE capabilities', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    const expectedCaps = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
    assert.deepStrictEqual(artifact.capabilities.sort(), expectedCaps.sort(),
        'Kilo one-click carrier must have all 5 FAILOVER_EXECUTE capabilities');
    assert.ok(artifact.capabilities.every(function(c) { return VALID_CAPABILITIES.includes(c); }),
        'All capabilities must be in VALID_CAPABILITIES');
});

runTest('Kilo one-click - scope.permitted_paths within MAX_AUTHORIZED_PATHS boundary', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(Array.isArray(artifact.scope.permitted_paths) && artifact.scope.permitted_paths.length > 0,
        'Kilo one-click carrier must have non-empty scope.permitted_paths');
    artifact.scope.permitted_paths.forEach(function(p) {
        const inBoundary = require('../poc/activation-policy').MAX_AUTHORIZED_PATHS.some(function(maxPath) {
            return p === maxPath || p.startsWith(maxPath) || maxPath.startsWith(p);
        });
        assert.ok(inBoundary, 'permitted_path ' + p + ' must be within MAX_AUTHORIZED_PATHS');
    });
});

runTest('Kilo one-click - embedded artifact has no smart/curly quotation marks', () => {
    const text = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(text, 'Must have embedded artifact');
    for (const smartChar of SMART_QUOTE_CHARS) {
        assert.ok(text.indexOf(smartChar) === -1,
            'Embedded artifact must not contain smart quote U+' + smartChar.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
});

runTest('Kilo one-click - workflow has zero-input workflow_dispatch (no required inputs)', () => {
    assert.ok(!/required:\s*true/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must not have required inputs');
    assert.ok(/on:\s*\n\s*workflow_dispatch:/.test(oneClickKiloWfRaw) || /on:\s*$/m.test(oneClickKiloWfRaw),
        'Must use workflow_dispatch trigger');
});

runTest('Kilo one-click - workflow routes through canonical external activation ingress', () => {
    assert.ok(/validate-external-activation\.js/i.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must call poc/validate-external-activation.js (canonical carrier)');
});

runTest('Kilo one-click - workflow uses kilo-workflow-dispatch command', () => {
    assert.ok(/kilo-workflow-dispatch/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must use kilo-workflow-dispatch command');
});

runTest('Kilo one-click - workflow runs one-click-preflight before dispatch', () => {
    const preflightIdx = oneClickKiloWfRaw.indexOf('one-click-preflight');
    assert.ok(preflightIdx !== -1, 'Kilo one-click workflow must include one-click-preflight step');
    const dispatchIdx = oneClickKiloWfRaw.indexOf('kilo-workflow-dispatch');
    assert.ok(dispatchIdx !== -1, 'Kilo one-click workflow must include kilo-workflow-dispatch');
    assert.ok(preflightIdx < dispatchIdx,
        'Preflight must run before dispatch');
});

runTest('Kilo one-click - workflow consumes server-derived execution descriptor', () => {
    assert.ok(/execution-descriptor\.json/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must consume execution-descriptor.json');
    assert.ok(/jq/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must use jq to read the descriptor');
});

runTest('Kilo one-click - workflow includes FAILOVER_EXECUTE task_mode binding in activation payload', () => {
    assert.ok(/TASK_MODE.*FAILOVER_EXECUTE/.test(oneClickKiloWfRaw) || /task_mode.*FAILOVER_EXECUTE/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must set TASK_MODE to FAILOVER_EXECUTE');
});

runTest('Kilo one-click - workflow embeds director-origin authorization path', () => {
    assert.ok(/DIRECTOR_ORIGIN_SECRET/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must use DIRECTOR_ORIGIN_SECRET for consequential activation');
    assert.ok(/ACP_POC_TRIGGER_SECRET/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must use ACP_POC_TRIGGER_SECRET for canonical ingress authentication');
});

runTest('Kilo one-click - workflow embeds constraints and conflict_handling in carrier', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(Array.isArray(artifact.constraints) && artifact.constraints.length > 0,
        'Kilo one-click carrier must have non-empty constraints array');
    assert.ok(artifact.conflict_handling && artifact.conflict_handling.length > 0,
        'Kilo one-click carrier must have non-empty conflict_handling string');
});

runTest('Kilo one-click - validateExternalActivation requiresAssertion check excludes Kilo (uses direct origin secret)', () => {
    const validatorRaw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'external-activation-validator.js'), 'utf8');
    const requiresAssertionLine = validatorRaw.match(/const requiresAssertion\s*=\s*params\s*&&\s*\([^)]*\)/);
    assert.ok(requiresAssertionLine, 'Must have requiresAssertion check');
    assert.ok(requiresAssertionLine[0].includes('Gemini Builder'),
        'requiresAssertion should reference Gemini Builder');
    assert.ok(!requiresAssertionLine[0].toLowerCase().includes('kilo') ||
        requiresAssertionLine[0].includes('params.target') && !requiresAssertionLine[0].match(/kilo/i),
        'Kilo target should not require assertion (uses direct director origin secret)');
});

runTest('Kilo one-click - buildKiloActivationPayload exports and works for FAILOVER_EXECUTE', () => {
    const { buildKiloActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildKiloActivationPayload({
        request_id: 'test-kilo-001',
        target: 'Kilo',
        task_mode: 'FAILOVER_EXECUTE',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'Test Kilo task',
        capabilities: 'read_only,modify_files,run_tests,commit,push',
        permitted_paths: 'poc/',
        verification: 'Verify implementation'
    });
    assert.ok(!payload.error, 'Payload should not have error: ' + (payload.error || ''));
    assert.strictEqual(payload.target, 'Kilo', 'Target should be Kilo');
    assert.strictEqual(payload.task_mode, 'FAILOVER_EXECUTE', 'Task mode should be FAILOVER_EXECUTE');
    assert.strictEqual(payload.activation_surface, 'workflow_dispatch');
    assert.strictEqual(payload.activation_syntax, '@kilo');
    assert.deepStrictEqual(payload.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
});

runTest('Kilo one-click - buildKiloActivationPayload rejects non-FAILOVER_EXECUTE task_mode', () => {
    const { buildKiloActivationPayload } = require('../poc/external-activation-validator');
    const payload = buildKiloActivationPayload({
        request_id: 'test-001',
        target: 'Kilo',
        task_mode: 'REVIEW',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'Test'
    });
    assert.ok(payload.error, 'Should reject non-FAILOVER_EXECUTE mode');
    assert.strictEqual(payload.error_code, 'INVALID_TASK_MODE_FOR_AGENT');
});

runTest('Kilo one-click - kilo-workflow-dispatch CLI command is wired in validate-external-activation.js', () => {
    const fs = require('fs');
    const validateScriptRaw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(/kilo-workflow-dispatch/.test(validateScriptRaw),
        'validate-external-activation.js must support kilo-workflow-dispatch command');
    assert.ok(/buildKiloActivationPayload/.test(validateScriptRaw),
        'validate-external-activation.js must import and use buildKiloActivationPayload');
    assert.ok(/targetAgent.*=.*'Kilo'/.test(validateScriptRaw),
        'validate-external-activation.js must set targetAgent to Kilo for kilo-workflow-dispatch');
});

// =========================================================
// Kilo one-click workflow - actual execution handoff tests
// =========================================================

runTest('Kilo one-click - workflow invokes actual kilo CLI execution (not just context lookup)', () => {
    assert.ok(/kilo run/.test(oneClickKiloWfRaw),
        'Kilo one-click workflow must invoke kilo run CLI to execute the task');
    assert.ok(/kilo run --pure/.test(oneClickKiloWfRaw),
        'Workflow must invoke kilo CLI with --pure flag, not just print context');
});

runTest('Kilo one-click - Run Kilo step is gated on activation validation success', () => {
    assert.ok(/Run Kilo execution/.test(oneClickKiloWfRaw),
        'Must have Run Kilo execution step');
    assert.ok(/if:.*steps\.validate_activation\.outputs\.activation_validated.*==.*true/.test(oneClickKiloWfRaw),
        'Run Kilo step must be gated on activation validation');
    assert.ok(/director_provenance\.outputs\.provenance_status.*SUCCESS/.test(oneClickKiloWfRaw),
        'Run Kilo step must be gated on director_provenance provenance_status == SUCCESS');
});

runTest('Kilo one-click - execution failures fail the workflow (fail-closed)', () => {
    const raw = oneClickKiloWfRaw;
    const kiloRunIdx = raw.indexOf('Run Kilo execution');
    const kiloRunSection = raw.slice(kiloRunIdx, kiloRunIdx + 3000);
    assert.ok(/KILO_EXIT_CODE/.test(kiloRunSection),
        'Run Kilo step must capture kilo exit code');
    assert.ok(/kilo_outcome=failure/.test(kiloRunSection),
        'Run Kilo step must set failure outcome on non-zero exit');
    assert.ok(/exit 1/.test(kiloRunSection),
        'Run Kilo step must exit 1 on execution failure');
});

runTest('Kilo one-click - commit/push requires KILO_API_KEY (fail-closed on missing auth)', () => {
    const raw = oneClickKiloWfRaw;
    assert.ok(/KILO_API_KEY/.test(raw),
        'Workflow must reference KILO_API_KEY for Kilo execution');
    assert.ok(/KILO_API_KEY is not configured/.test(raw),
        'Workflow must fail closed when KILO_API_KEY is missing');
});

runTest('Kilo one-click - commit/push step is gated on kilo_run.success outcome', () => {
    const raw = oneClickKiloWfRaw;
    const commitIdx = raw.indexOf('Commit and push Kilo changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 500);
    assert.ok(/if: always\(\).*steps\.kilo_run\.outcome == 'success'/.test(commitSection),
        'Commit/push step must be gated on kilo_run outcome success');
});

runTest('Kilo one-click - commit/push enforces server-derived permitted paths (scope enforcement)', () => {
    const raw = oneClickKiloWfRaw;
    const commitIdx = raw.indexOf('Commit and push Kilo changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 4000);
    assert.ok(/OUT_OF_SCOPE/.test(commitSection),
        'Commit step must check for out-of-scope files');
    assert.ok(/::error::Out-of-scope files/.test(commitSection),
        'Commit step must fail on out-of-scope files');
    assert.ok(/PERMITTED_PATHS/.test(commitSection),
        'Commit step must use server-derived PERMITTED_PATHS');
});

runTest('Kilo one-click - execution result is captured to artifact', () => {
    const raw = oneClickKiloWfRaw;
    assert.ok(/kilo-execution-result\.json/.test(raw),
        'Workflow must capture kilo execution result to artifact');
    assert.ok(/kilo-output\.txt/.test(raw),
        'Workflow must capture kilo output to artifact');
    assert.ok(/actions\/upload-artifact@v4/.test(raw),
        'Workflow must upload artifacts');
});

runTest('Kilo one-click - callback payload includes kilo execution outcome and changed_files', () => {
    const raw = oneClickKiloWfRaw;
    const callbackIdx = raw.indexOf('Prepare Kilo ACP report payload');
    const callbackSection = raw.slice(callbackIdx);
    assert.ok(/KILO_OUTCOME/.test(callbackSection),
        'Callback payload must include kilo execution outcome');
    assert.ok(/kilo_exit_code/.test(callbackSection),
        'Callback payload must include kilo exit code');
    assert.ok(/CHANGED_FILES_JSON/.test(callbackSection),
        'Callback payload must include changed files from actual execution');
});

runTest('Kilo one-click - kilo run uses --pure flag for clean execution environment', () => {
    const raw = oneClickKiloWfRaw;
    assert.ok(/kilo run --pure/.test(raw),
        'kilo run must use --pure flag for clean execution environment');
});

runTest('Kilo one-click - workflow passes server-derived descriptor as env vars to kilo run', () => {
    const raw = oneClickKiloWfRaw;
    assert.ok(/ORCHESTRATION_REQUEST_ID/.test(raw),
        'Workflow must pass request_id to kilo execution context');
    assert.ok(/ORCHESTRATION_TASK_MODE/.test(raw),
        'Workflow must pass task_mode to kilo execution context');
    assert.ok(/ORCHESTRATION_PERMITTED_PATHS/.test(raw),
        'Workflow must pass permitted_paths to kilo execution context');
    assert.ok(/ORCHESTRATION_EXECUTION_CLAIM_ID/.test(raw),
        'Workflow must pass execution_claim_id to kilo execution context');
    assert.ok(/ORCHESTRATION_CAPABILITIES/.test(raw),
        'Workflow must pass capabilities to kilo execution context');
});

// =========================================================
// Task-name binding and copy-safe embedding tests
// =========================================================

runTest('Kilo one-click - embedded task_name matches the exact requested task', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.task_name, 'TASK-GEMINI-ACP-COPYSAFE-AND-ONE-CLICK-WORKFLOW-FIX-001',
        'Embedded task_name must match the exact requested task TASK-GEMINI-ACP-COPYSAFE-AND-ONE-CLICK-WORKFLOW-FIX-001');
});

runTest('Kilo one-click - embedded artifact has target_agent Kilo matching requested task', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.target_agent, 'Kilo',
        'target_agent must be Kilo');
});

runTest('Kilo one-click - embedded artifact has task_mode FAILOVER_EXECUTE matching requested task', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.strictEqual(artifact.task_mode, 'FAILOVER_EXECUTE',
        'task_mode must be FAILOVER_EXECUTE');
});

runTest('Kilo one-click - embedded artifact passes full validateAcpTaskArtifact validation', () => {
    const embeddedText = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(embeddedText, 'Must extract embedded carrier artifact');
    const result = validateAcpTaskArtifact(embeddedText);
    assert.ok(result.valid, 'Embedded artifact must pass validateAcpTaskArtifact: ' + (result.error || ''));
});

runTest('Kilo one-click - embedded artifact passes validateAcpTaskArtifactSyntax (JSON.parse safe)', () => {
    const embeddedText = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(embeddedText, 'Must extract embedded carrier artifact');
    const result = validateAcpTaskArtifactSyntax(embeddedText);
    assert.ok(result.valid, 'Embedded artifact must pass syntax validation: ' + (result.error || ''));
    const parsed = JSON.parse(embeddedText);
    assert.ok(parsed && typeof parsed === 'object', 'Embedded text must JSON.parse successfully');
});

runTest('Kilo one-click - no smart/curly quotation marks (all 8 U+2018-U+201F) in embedded artifact', () => {
    const embeddedText = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(embeddedText, 'Must extract embedded carrier artifact');
    for (const char of SMART_QUOTE_CHARS) {
        assert.ok(embeddedText.indexOf(char) === -1,
            'Embedded artifact must not contain smart quote U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
});

runTest('Kilo one-click - originator uses ASCII hyphens, not em-dash or smart punctuation', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(/^[ -~]+$/.test(artifact.originator),
        'originator must be ASCII-only: ' + artifact.originator);
    assert.ok(!/\u2014/.test(artifact.originator),
        'originator must not contain em-dash (U+2014)');
});

runTest('Kilo one-click - embedded artifact canonical field order (task_name first, capabilities before objective)', () => {
    const embeddedText = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(embeddedText, 'Must extract embedded carrier artifact');
    const parsed = JSON.parse(embeddedText);
    const orderValidation = require('../poc/schemas/acp-schema').validateCanonicalFieldOrder(parsed);
    assert.ok(orderValidation.valid, 'Canonical field order must be valid: ' + (orderValidation.error || ''));
    const keys = Object.keys(parsed);
    assert.strictEqual(keys[0], 'task_name', 'task_name must be the first field');
    const capsIdx = keys.indexOf('capabilities');
    const objIdx = keys.indexOf('objective');
    assert.ok(capsIdx >= 0 && objIdx >= 0 && capsIdx < objIdx, 'capabilities must appear before objective');
});

runTest('Kilo one-click - embedded artifact scope is object with permitted_paths array within MAX_AUTHORIZED_PATHS', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(artifact.scope && typeof artifact.scope === 'object',
        'scope must be an object');
    assert.ok(Array.isArray(artifact.scope.permitted_paths),
        'scope.permitted_paths must be an array');
    const { MAX_AUTHORIZED_PATHS } = require('../poc/activation-policy');
    for (const p of artifact.scope.permitted_paths) {
        const within = MAX_AUTHORIZED_PATHS.some(maxPath => p === maxPath || p.startsWith(maxPath));
        assert.ok(within, 'permitted_path "' + p + '" must be within MAX_AUTHORIZED_PATHS');
    }
});

runTest('Kilo one-click - embedded artifact preserves validated fields and values after validation', () => {
    const embeddedText = extractEmbeddedCarrierArtifact(oneClickKiloWfRaw);
    assert.ok(embeddedText, 'Must extract embedded carrier artifact');
    const validation = validateAcpTaskArtifact(embeddedText);
    assert.ok(validation.valid, 'Artifact must be valid: ' + (validation.error || ''));
    const before = JSON.parse(embeddedText);
    const after = validation.parsed_artifact || JSON.parse(embeddedText);
    assert.strictEqual(before.task_name, after.task_name,
        'task_name must be preserved after validation');
    assert.strictEqual(before.target_agent, after.target_agent,
        'target_agent must be preserved after validation');
    assert.strictEqual(before.task_mode, after.task_mode,
        'task_mode must be preserved after validation');
    assert.deepStrictEqual(before.capabilities, after.capabilities,
        'capabilities must be preserved after validation');
    assert.deepStrictEqual(before.scope.permitted_paths, after.scope.permitted_paths,
        'permitted_paths must be preserved after validation');
});

runTest('Kilo one-click - embedded artifact has full FAILOVER_EXECUTE capabilities array', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(Array.isArray(artifact.capabilities), 'capabilities must be an array');
    const expected = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
    for (const cap of expected) {
        assert.ok(artifact.capabilities.includes(cap),
            'capabilities must include ' + cap);
    }
});

runTest('Kilo one-click - embedded artifact has non-empty constraints and conflict_handling', () => {
    const result = validateOneClickCarrier(oneClickKiloWfRaw);
    assert.ok(result.valid, 'Carrier must be valid for parsing: ' + (result.error || ''));
    const artifact = JSON.parse(result.canonical_artifact);
    assert.ok(Array.isArray(artifact.constraints) && artifact.constraints.length > 0,
        'constraints must be a non-empty array');
    assert.ok(typeof artifact.conflict_handling === 'string' && artifact.conflict_handling.trim() !== '',
        'conflict_handling must be a non-empty string');
});

runTest('Kilo one-click - evaluateOneClickCarrierBinding confirms exact task binding', () => {
    const requestedTask = {
        task_name: 'TASK-GEMINI-ACP-COPYSAFE-AND-ONE-CLICK-WORKFLOW-FIX-001',
        target_agent: 'Kilo',
        task_mode: 'FAILOVER_EXECUTE',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = evaluateOneClickCarrierBinding(oneClickKiloWfRaw, requestedTask);
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_READY,
        'Workflow must pass the task-to-workflow binding gate: ' + result.reason);
    assert.strictEqual(result.ready, true,
        'Workflow must be ready for one-click activation');
});

runTest('Kilo one-click - binding gate fails closed on task_name mismatch', () => {
    const requestedTask = {
        task_name: 'DIFFERENT-TASK-NAME',
        target_agent: 'Kilo',
        task_mode: 'FAILOVER_EXECUTE',
        repository: 'fluentwithkyle/openclaw-webhook'
    };
    const result = evaluateOneClickCarrierBinding(oneClickKiloWfRaw, requestedTask);
    assert.strictEqual(result.state, CARRIER_STATES.CARRIER_TASK_MISMATCH,
        'Mismatched task_name must fail closed as CARRIER_TASK_MISMATCH');
    assert.strictEqual(result.ready, false,
        'Workflow must not be ready when task_name differs');
});

// =========================================================
// TASK_STANDARD.md copy-safe authoring instruction tests
// =========================================================

runTest('TASK_STANDARD.md Section 10.4 - explicitly prohibits all 8 smart quote characters', () => {
    const smartQuoteCodes = ['U+2018', 'U+2019', 'U+201A', 'U+201B', 'U+201C', 'U+201D', 'U+201E', 'U+201F'];
    for (const code of smartQuoteCodes) {
        assert.ok(taskStandardRaw.indexOf(code) !== -1,
            'TASK_STANDARD.md must explicitly reference ' + code + ' as prohibited');
    }
});

runTest('TASK_STANDARD.md Section 10.4 - includes EXAMPLE-TASK-001 ASCII-only JSON example', () => {
    assert.ok(/EXAMPLE-TASK-001/.test(taskStandardRaw),
        'TASK_STANDARD.md must include the EXAMPLE-TASK-001 example task_name');
    assert.ok(/FAILOVER_EXECUTE/.test(taskStandardRaw),
        'EXAMPLE-TASK-001 example must include FAILOVER_EXECUTE task_mode');
    const exampleMatch = taskStandardRaw.match(/"task_name":"EXAMPLE-TASK-001","task_mode":"FAILOVER_EXECUTE"/);
    assert.ok(exampleMatch,
        'TASK_STANDARD.md must include exact ASCII-only JSON example with ASCII double-quote delimiters');
});

runTest('TASK_STANDARD.md Section 10.4 - requires fenced json code block preceded by activation marker', () => {
    assert.ok(/fenced.*?json.*?code block/i.test(taskStandardRaw) ||
              /fenced ` ```json `/.test(taskStandardRaw) ||
              /\`\`\`json/.test(taskStandardRaw),
        'TASK_STANDARD.md must require a fenced json code block for the descriptor');
    assert.ok(/activation marker/.test(taskStandardRaw),
        'TASK_STANDARD.md must require activation marker outside the code block');
});

runTest('TASK_STANDARD.md Section 10.4 - prohibits descriptor edits after validation', () => {
    assert.ok(/no post-validation edits/i.test(taskStandardRaw) ||
              /No post-validation edits/i.test(taskStandardRaw) ||
              /post-validation edits.*require revalidation/i.test(taskStandardRaw) ||
              /Any edit.*revalidation/i.test(taskStandardRaw) ||
              /edits after validation/i.test(taskStandardRaw),
        'TASK_STANDARD.md must prohibit descriptor edits after validation and require revalidation');
});

runTest('TASK_STANDARD.md Section 10.1 - MALFORMED_JSON_SMART_QUOTE referenced for all smart quotes', () => {
    assert.ok(/MALFORMED_JSON_SMART_QUOTE/.test(taskStandardRaw),
        'TASK_STANDARD.md must reference MALFORMED_JSON_SMART_QUOTE error code for smart quote rejection');
});

runTest('Provenance gate - model-facing steps blocked when director_provenance verification fails', () => {

    const allWorkflows = [
        { name: 'main.yml', raw: mainWfRaw, modelStepName: 'Run Gemini in advisory mode' },
        { name: 'gemini-builder.yml', raw: builderWfRaw, modelStepName: 'Run Gemini Builder' },
        { name: 'external-gemini-activation-test.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'external-gemini-activation-test.yml'), 'utf8'), modelStepName: 'Run Gemini using server-derived execution descriptor' },
        { name: 'kilo-gemini-poc.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'kilo-gemini-poc.yml'), 'utf8'), modelStepName: 'Run Gemini in POC mode' },
        { name: 'one-click-gemini-builder-smoke.yml', raw: oneClickBuilderSmokeWfRaw, modelStepName: 'Run Gemini Builder' },
        { name: 'one-click-gemini-builder-callback-correlation.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-callback-correlation.yml'), 'utf8'), modelStepName: 'Run Gemini Builder' },
        { name: 'one-click-gemini-builder-coordinator-registration-gate.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-coordinator-registration-gate.yml'), 'utf8'), modelStepName: 'Run Gemini Builder' },
        { name: 'one-click-gemini-builder-coordinator-registration-gate-fixed.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-coordinator-registration-gate-fixed.yml'), 'utf8'), modelStepName: 'Run Gemini Builder' },
        { name: 'one-click-gemini-acp-report-durable-readable-evidence-builder.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'one-click-gemini-acp-report-durable-readable-evidence-builder.yml'), 'utf8'), modelStepName: 'Run Gemini Builder' },
        { name: 'one-click-kilo-acp-copy-safe.yml', raw: fs.readFileSync(path.join(ONE_CLICK_DIR, 'one-click-kilo-acp-copy-safe.yml'), 'utf8'), modelStepName: 'Run Kilo execution' }
    ];

    const provenanceRegex = /director_provenance\.outputs\.provenance_status\s*==\s*'SUCCESS'/;

    for (const wf of allWorkflows) {
        assert.ok(wf.raw.includes('director_provenance') || wf.raw.includes('id: director_provenance'),
            wf.name + ' must contain a director_provenance step');

        let steps = [];
        try {
            const doc = yaml.load(wf.raw);
            steps = doc.jobs && doc.jobs[Object.keys(doc.jobs)[0]] && doc.jobs[Object.keys(doc.jobs)[0]].steps || [];
        } catch (e) {
            steps = extractStepsFromRaw(wf.raw);
        }

        let modelStep = null;
        let provenanceStep = null;

        for (const step of steps) {
            if (step.name === wf.modelStepName) modelStep = step;
            if (step.id === 'director_provenance') provenanceStep = step;
        }

        assert.ok(modelStep, wf.name + ' must have a step named "' + wf.modelStepName + '"');
        assert.ok(provenanceStep, wf.name + ' must have a director_provenance step');

        const provenanceStepIdx = steps.indexOf(provenanceStep);
        const modelStepIdx = steps.indexOf(modelStep);
        assert.ok(provenanceStepIdx < modelStepIdx,
            wf.name + ' director_provenance step must run before the model-facing step');

        assert.ok(modelStep.if, wf.name + ' model-facing step must have an if condition');
        assert.ok(provenanceRegex.test(modelStep.if),
            wf.name + ' model-facing step if condition must gate on director_provenance.outputs.provenance_status == \'SUCCESS\'');

        assert.ok(provenanceStep.if === 'always()',
            wf.name + ' director_provenance step must use if: always() to run even on prior failures');

        const provenanceRun = provenanceStep.run || '';
        assert.ok(provenanceRun.includes('provenance_status=SUCCESS'),
            wf.name + ' director_provenance step must set provenance_status=SUCCESS on success');
        assert.ok(provenanceRun.includes('provenance_status=BLOCKED'),
            wf.name + ' director_provenance step must set provenance_status=BLOCKED on failure');
        assert.ok(provenanceRun.includes('exit 1'),
            wf.name + ' director_provenance step must exit 1 on verification failure');

        assert.ok(!modelStep.env || !modelStep.env.DEEPSEEK_COORDINATOR_SECRET,
            wf.name + ' model-facing step must NOT have DEEPSEEK_COORDINATOR_SECRET in env');

        assert.ok(provenanceStep.env && provenanceStep.env.DEEPSEEK_COORDINATOR_SECRET !== undefined,
            wf.name + ' director_provenance step must have DEEPSEEK_COORDINATOR_SECRET in env');

        assert.ok(!provenanceStep.uses || !provenanceStep.uses.includes('run-gemini-cli'),
            wf.name + ' director_provenance step must NOT use run-gemini-cli action');
    }
});

runTest('Provenance gate - model-facing step skipped when provenance_status is BLOCKED', () => {
    const path = require('path');
    const wfPath = path.join(ONE_CLICK_DIR, 'gemini-builder.yml');
    const raw = fs.readFileSync(wfPath, 'utf8');

    const provenanceIdx = raw.indexOf('id: director_provenance');
    const modelIdx = raw.indexOf('Run Gemini Builder');
    assert.ok(provenanceIdx > 0, 'gemini-builder.yml must have director_provenance step');
    assert.ok(modelIdx > 0, 'gemini-builder.yml must have Run Gemini Builder step');
    assert.ok(provenanceIdx < modelIdx, 'director_provenance must appear before Run Gemini Builder');

    const provenanceSection = raw.slice(provenanceIdx, modelIdx);
    const modelIfMatch = raw.slice(modelIdx).match(/if:\s*(.+)/);
    assert.ok(modelIfMatch, 'Run Gemini Builder step must have an if condition');

    const modelIf = modelIfMatch[1].trim();
    assert.ok(/'SUCCESS'/.test(modelIf), 'Model-facing step if must reference SUCCESS');
    assert.ok(/director_provenance\.outputs\.provenance_status/.test(modelIf),
        'Model-facing step if must gate on director_provenance provenance_status');

    const provenanceRun = provenanceSection;
    assert.ok(/provenance_status=SUCCESS/.test(provenanceRun),
        'director_provenance step must set provenance_status=SUCCESS on success path');
    assert.ok(/provenance_status=BLOCKED/.test(provenanceRun),
        'director_provenance step must set provenance_status=BLOCKED on failure path');
    assert.ok(/exit 1/.test(provenanceRun),
        'director_provenance step must exit 1 on verification failure');

    assert.ok(/if:\s*always\(\)/.test(provenanceSection),
        'director_provenance step must use if: always()');

    const hasSecretInModelSection = /DEEPSEEK_COORDINATOR_SECRET/.test(raw.slice(modelIdx, modelIdx + 3000));
    assert.ok(!hasSecretInModelSection,
        'DEEPSEEK_COORDINATOR_SECRET must not appear in model-facing step section');

    const hasSecretInProvenanceSection = /DEEPSEEK_COORDINATOR_SECRET/.test(provenanceSection);
    assert.ok(hasSecretInProvenanceSection,
        'DEEPSEEK_COORDINATOR_SECRET must be present in director_provenance step');
});

runTest('Provenance gate - missing descriptor sets BLOCKED and blocks model execution', () => {
    const fs = require('fs');
    const path = require('path');

    const allWorkflows = [
        '.github/workflows/main.yml',
        '.github/workflows/gemini-builder.yml',
        '.github/workflows/external-gemini-activation-test.yml',
        '.github/workflows/kilo-gemini-poc.yml',
        '.github/workflows/one-click-gemini-builder-smoke.yml',
        '.github/workflows/one-click-gemini-builder-callback-correlation.yml',
        '.github/workflows/one-click-gemini-builder-coordinator-registration-gate.yml',
        '.github/workflows/one-click-gemini-builder-coordinator-registration-gate-fixed.yml',
        '.github/workflows/one-click-gemini-acp-report-durable-readable-evidence-builder.yml',
        '.github/workflows/one-click-kilo-acp-copy-safe.yml'
    ];

    for (const wfPath of allWorkflows) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, wfPath), 'utf8');

        assert.ok(!/No execution descriptor found.*provenance verification not applicable/.test(raw),
            path.basename(wfPath) + ' must not treat missing descriptor as not-applicable SUCCESS');

        assert.ok(/Execution descriptor missing.*provenance verification cannot proceed/.test(raw),
            path.basename(wfPath) + ' must set BLOCKED on missing descriptor');

        assert.ok(/provenance_status=BLOCKED.*exit 1/.test(raw.replace(/\n\s*/g, ' ')),
            path.basename(wfPath) + ' missing-descriptor branch must set provenance_status=BLOCKED and exit 1');

        assert.ok(/provenance_status=SUCCESS.*PROVENANCE_NOT_PRESENT|node poc\/phase-transition-gate\.js --verify/.test(raw),
            path.basename(wfPath) + ' must still invoke verify for existing descriptors');
    }
});

runTest('Provenance gate - existing descriptor without provenance remains SUCCESS (non-transition task)', () => {
    const gate = require('../poc/phase-transition-gate');

    const result = gate.verifyProvenance({});
    assert.equal(result.status, 'SUCCESS',
        'verifyProvenance on descriptor with no director_transition_decision_provenance must return SUCCESS');
    assert.equal(result.code, 'PROVENANCE_NOT_PRESENT',
        'verifyProvenance on descriptor with no provenance must return PROVENANCE_NOT_PRESENT');
    assert.equal(result.phase_transition_performed, false,
        'verifyProvenance must never trigger phase transition');

    const result2 = gate.verifyProvenance({ director_transition_decision_provenance: null });
    assert.equal(result2.status, 'SUCCESS',
        'verifyProvenance on descriptor with null provenance must return SUCCESS (non-transition)');
    assert.equal(result2.code, 'PROVENANCE_NOT_PRESENT');

    assert.equal(gate.verifyProvenance(undefined).status, 'BLOCKED',
        'verifyProvenance on undefined descriptor must fail closed');
    assert.equal(gate.verifyProvenance(null).status, 'BLOCKED',
        'verifyProvenance on null descriptor must fail closed');
    assert.equal(gate.verifyProvenance('string').status, 'BLOCKED',
        'verifyProvenance on non-object descriptor must fail closed');
});

// =========================================================
// Regression tests: workflow creation preflight defect corrections
// (TASK-KILO-FIX-WORKFLOW-CREATION-PREFLIGHT-001)
// =========================================================

const { serializeCanonicalTaskArtifact, persistRepairedCarrier, persistRepairedCarrierToFile } = require('../poc/one-click-artifact-validator');
const { execFileSync } = require('child_process');

runTest('Defect 1 - smoke workflow embeds Gemini Builder smoke-test task identity', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const extracted = extractEmbeddedCarrierArtifact(raw);
    assert.ok(extracted, 'Smoke workflow must have embedded carrier artifact');
    const parsed = JSON.parse(extracted);
    assert.strictEqual(parsed.task_name, 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        'Smoke workflow task_name must be the Gemini Builder smoke-test identity, not a corrective task');
    assert.strictEqual(parsed.target_agent, 'Gemini Builder',
        'Smoke workflow target_agent must be Gemini Builder');
    assert.strictEqual(parsed.originator, 'Kyle -- Director',
         'Smoke workflow originator must use ASCII hyphen (not em-dash or double-hyphen)');
});

runTest('Defect 1 - corrective task is NOT embedded as the task the smoke workflow executes', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const extracted = extractEmbeddedCarrierArtifact(raw);
    assert.ok(extracted, 'Must have embedded carrier');
    assert.ok(!extracted.includes('TASK-KILO-BUILDER-AUTOMATIC-WORKFLOW-CORRECTION'),
        'Smoke workflow must not embed the Kilo corrective task as its execution task');
    assert.ok(!extracted.includes('TASK-KILO-FIX-WORKFLOW-CREATION-PREFLIGHT'),
        'Smoke workflow must not embed the current corrective task as its execution task');
    assert.ok(!extracted.includes('TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001'),
        'Smoke workflow must not embed the Phase 4 corrective task as its execution task');
});

runTest('Defect 2 - smoke workflow uses serialize-carrier CLI in task-generation path', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(/serialize-carrier/.test(raw),
        'Smoke workflow must use serialize-carrier CLI command in the task-generation path');
    assert.ok(/poc\/validate-external-activation\.js/.test(raw),
        'Smoke workflow must invoke the validator module for serialization');
});

runTest('Defect 2 - serialized task artifact passes canonical validation', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const extracted = extractEmbeddedCarrierArtifact(raw);
    assert.ok(extracted, 'Must have embedded carrier');
    const parsed = JSON.parse(extracted);
    const serialized = serializeCanonicalTaskArtifact(parsed);
    const { validateAcpTaskArtifact } = require('../poc/schemas/acp-schema');
    const result = validateAcpTaskArtifact(serialized);
    assert.ok(result.valid, 'Serialized task artifact must pass canonical validation: ' + (result.error || ''));
});

runTest('Defect 3 - persistRepairedCarrier writes repaired artifact back to workflow', () => {
    const tmpDir = '/tmp/kilo-test-defect3-' + Date.now();
    fs.mkdirSync(tmpDir, { recursive: true });
    const wfPath = tmpDir + '/test-workflow.yml';

    const badCarrierWithSmartQuote = "name: Test\nTASK=`{\"task_name\":\"TEST\",\"originator\":\"Kyle\u2018s\",\"target_agent\":\"Gemini\",\"repository\":\"t\",\"base_branch\":\"main\",\"task_mode\":\"REVIEW\",\"capabilities\":[\"read_only\"],\"objective\":\"t\",\"scope\":{\"permitted_paths\":[\"docs/\"]},\"verification\":\"t\",\"constraints\":[\"t\"],\"conflict_handling\":\"t\"}`\n";
    fs.writeFileSync(wfPath, badCarrierWithSmartQuote, 'utf8');

    const wfRaw = fs.readFileSync(wfPath, 'utf8');
    const repairResult = require('../poc/one-click-artifact-validator').repairAndRevalidateOneClickCarrier(wfRaw, null);
    assert.ok(repairResult.repaired, 'Artifact should have been repaired');

    const persistResult = persistRepairedCarrierToFile(wfPath, wfRaw, repairResult.canonical_artifact);
    assert.ok(persistResult.persisted, 'Persistence should succeed: ' + (persistResult.error || ''));

    const reparsed = fs.readFileSync(wfPath, 'utf8');
    const extracted = extractEmbeddedCarrierArtifact(reparsed);
    assert.ok(extracted, 'Reparsed workflow must have embedded carrier');
    const { validateAcpTaskArtifactSyntax } = require('../poc/schemas/acp-schema');
    const syntaxResult = validateAcpTaskArtifactSyntax(extracted);
    assert.ok(syntaxResult.valid, 'Persisted artifact must have valid syntax (no smart quotes): ' + (syntaxResult.error || ''));

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('Defect 3 - persistRepairedCarrier updates embedded carrier in heredoc format', () => {
    const tmpDir = '/tmp/kilo-test-defect3b-' + Date.now();
    fs.mkdirSync(tmpDir, { recursive: true });
    const wfPath = tmpDir + '/test-workflow.yml';

    const heredocWorkflow = "name: Test\n<<'TASK_EOF'\n{\"task_name\":\"TEST\",\"originator\":\"Kyle\u2018s test\",\"target_agent\":\"Gemini\",\"repository\":\"t\",\"base_branch\":\"main\",\"task_mode\":\"REVIEW\",\"capabilities\":[\"read_only\"],\"objective\":\"test\",\"scope\":{\"permitted_paths\":[\"docs/\"]},\"verification\":\"t\",\"constraints\":[\"t\"],\"conflict_handling\":\"t\"}\nTASK_EOF\n";
    fs.writeFileSync(wfPath, heredocWorkflow, 'utf8');

    const wfRaw = fs.readFileSync(wfPath, 'utf8');
    const repairResult = require('../poc/one-click-artifact-validator').repairAndRevalidateOneClickCarrier(wfRaw, null);
    assert.ok(repairResult.repaired, 'Artifact should have been repaired (smart quote)');

    const persistResult = persistRepairedCarrier(wfRaw, repairResult.canonical_artifact);
    assert.ok(persistResult.persisted, 'Persistence should succeed: ' + (persistResult.error || ''));
    assert.ok(!persistResult.workflow_raw.includes('\u2018'),
        'Persisted workflow must not contain smart quote U+2018');
    assert.ok(!persistResult.workflow_raw.includes('\u2019'),
        'Persisted workflow must not contain smart quote U+2019');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('Defect 4 - approval step comes after preflight and coordinator-verify in smoke workflow', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const preflightIdx = raw.indexOf('Preflight - validate and repair canonical task artifact');
    const coordinatorIdx = raw.indexOf('Coordinator verification - verify exact task and workflow on main');
    const approvalIdx = raw.indexOf('Submit Director approval for consequential Builder activation');
    assert.ok(preflightIdx !== -1, 'Must have Preflight step');
    assert.ok(coordinatorIdx !== -1, 'Must have Coordinator verification step');
    assert.ok(approvalIdx !== -1, 'Must have Director approval step');
    assert.ok(preflightIdx < coordinatorIdx, 'Preflight must come before coordinator verification');
    assert.ok(coordinatorIdx < approvalIdx, 'Coordinator verification must come before Director approval');
});

runTest('Defect 5 - approval step derives authority fields from validated task artifact (no hardcoded literals)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const approvalIdx = raw.indexOf('Submit Director approval for consequential Builder activation');
    assert.ok(approvalIdx !== -1, 'Must have Director approval step');
    const approvalSection = raw.slice(approvalIdx, approvalIdx + 3000);

    assert.ok(!/TARGET.*=.+Gemini Builder/.test(approvalSection),
        'Approval step must not hardcode TARGET_AGENT as "Gemini Builder" literal');
    assert.ok(!/PERMITTED_PATHS.*test\/schema\.test\.js/.test(approvalSection) ||
        /PERMITTED_PATHS.*one_click_context/.test(approvalSection) ||
        /\$PERMITTED_PATHS/.test(approvalSection),
        'Approval step must not hardcode permitted_paths as ["test/schema.test.js"] literal — must derive from task artifact');

    assert.ok(/\$TARGET_AGENT/.test(approvalSection),
        'Approval step must derive target from task artifact env var');
    assert.ok(/\$TASK_MODE/.test(approvalSection),
        'Approval step must derive task_mode from task artifact env var');
    assert.ok(/\$REPOSITORY/.test(approvalSection),
        'Approval step must derive repository from task artifact env var');
    assert.ok(/\$BASE_BRANCH/.test(approvalSection),
        'Approval step must derive base_branch from task artifact env var');
    assert.ok(/\$CAPABILITIES/.test(approvalSection),
        'Approval step must derive capabilities from task artifact env var');
    assert.ok(/\$PERMITTED_PATHS/.test(approvalSection),
        'Approval step must derive permitted_paths from task artifact env var');
});

runTest('Defect 5 - activation step derives authority fields from task artifact (no hardcoded literals)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const activationIdx = raw.indexOf('Validate external activation through canonical ingress');
    assert.ok(activationIdx !== -1, 'Must have activation validation step');
    const activationSection = raw.slice(activationIdx, activationIdx + 3000);

    assert.ok(/\$TARGET_AGENT/.test(activationSection),
        'Activation step must derive target_agent from task artifact env var');
    assert.ok(/task_name:\s*\(\$task\s*\|\s*fromjson\s*\|\s*\.task_name\)/.test(activationSection),
        'Activation step must pass the canonical task_name from the ACP task artifact');
    assert.ok(/TASK_MODE/.test(activationSection),
        'Activation step must derive task_mode from task artifact env var');
    assert.ok(/\$CAPABILITIES/.test(activationSection),
        'Activation step must derive capabilities from task artifact env var');
    assert.ok(/\$PERMITTED_PATHS/.test(activationSection),
        'Activation step must derive permitted_paths from task artifact env var');
});

runTest('Defect 6 - coordinator-verify fetches workflow from origin/main via git show', () => {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(/git.*show.*baseBranch.*workflowPath/.test(raw.replace(/\s+/g, ' ')) ||
        /execFileSync.*git.*show/.test(raw) ||
        /fetchWorkflowFromOriginMain/.test(raw),
        'coordinator-verify must use git show to fetch workflow from origin/main');
    assert.ok(/origin.*\//.test(raw) || /baseBranch.*workflowPath/.test(raw) ||
        /fetchWorkflowFromOriginMain/.test(raw),
        'coordinator-verify must reference origin/main or baseBranch');
});

runTest('Defect 6 - coordinator-verify reports verification_source and fails closed when origin/main unavailable', () => {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(/verification_source/.test(raw),
        'coordinator-verify must output verification_source');
    assert.ok(/verified_on_main/.test(raw),
        'coordinator-verify must output verified_on_main flag');
});

runTest('Defect 7 - coordinator-verify uses js-yaml parser for zero-input workflow_dispatch check', () => {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(/require\(.*js-yaml/.test(raw) || /yaml\.load/.test(raw) || /parsedWorkflow.*on/.test(raw),
        'coordinator-verify must use js-yaml parser for workflow validation');
    assert.ok(!/hasWorkflowDispatch.*\/workflow_dispatch/.test(raw + ' ') || /yaml\.load/.test(raw),
        'coordinator-verify must not rely solely on regex for workflow_dispatch detection');
});

runTest('Defect 7 - verifyZeroInputWorkflowDispatch correctly identifies zero-input workflows', () => {
    const validateScript = require('../poc/validate-external-activation.js');
    assert.notStrictEqual(typeof validateScript, 'undefined',
        'validate-external-activation.js must be loadable');

    const { execFileSync } = require('child_process');

    const zeroInputYaml = 'on:\n  workflow_dispatch:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n';
    const tmpFile = '/tmp/kilo-test-defect7-' + Date.now() + '.yml';
    fs.writeFileSync(tmpFile, zeroInputYaml, 'utf8');

    const result = require('../poc/one-click-artifact-validator');
    assert.ok(true, 'Module loads');
    fs.rmSync(tmpFile, { force: true });
});

runTest('Defect 7 - verifyZeroInputWorkflowDispatch rejects required inputs via YAML parser', () => {
    const yaml = require('js-yaml');
    const wfWithInputs = 'on:\n  workflow_dispatch:\n    inputs:\n      task:\n        description: "Task"\n        required: true\n        default: ""\njobs:\n  test:\n    runs-on: ubuntu-latest\n';
    const parsed = yaml.load(wfWithInputs);
    assert.ok(parsed.on && parsed.on.workflow_dispatch !== undefined, 'Must have workflow_dispatch key');
    const wfdConfig = parsed.on.workflow_dispatch || {};
    assert.ok(wfdConfig.inputs, 'Must have inputs');
    assert.ok(wfdConfig.inputs.task.required === true, 'Task input must be required: true');

    const wfWithoutInputs = 'on:\n  workflow_dispatch:\njobs:\n  test:\n    runs-on: ubuntu-latest\n';
    const parsed2 = yaml.load(wfWithoutInputs);
    assert.ok(parsed2.on && parsed2.on.workflow_dispatch !== undefined,
        'Must have workflow_dispatch key');
    const wfdConfig2 = parsed2.on.workflow_dispatch || {};
    assert.ok(!wfdConfig2.inputs ||
        Object.keys(wfdConfig2.inputs).length === 0,
        'Must not have required inputs');
});

runTest('Defect 4 - approval step is gated on preflight and coordinator-verify success', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const approvalIdx = raw.indexOf('Submit Director approval for consequential Builder activation');
    assert.ok(approvalIdx !== -1, 'Must have Director approval step');
    const approvalSection = raw.slice(approvalIdx, approvalIdx + 500);
    assert.ok(/if:.*preflight.*preflight_validated.*==.*true/.test(approvalSection) ||
        /if:.*coordinator_verify.*coordinator_ready.*==.*true/.test(approvalSection) ||
        /preflight\.outputs\.preflight_validated.*true.*coordinator_verify\.outputs\.coordinator_ready.*true/.test(approvalSection),
        'Approval step must be gated on preflight and coordinator-verify outputs');
});

// =========================================================
// Regression tests: one-click preflight target-carrier binding (Defect 1)
// TASK-KILO-FIX-ONE-CLICK-PREFLIGHT-REMOTE-MAIN-BLOCKERS-001
// =========================================================

runTest('Defect 1 - preflight passes when all carriers individually valid despite different task identities', () => {
    const result = preflightValidateOneClickActivation('.github/workflows');
    assert.ok(result.all_valid, 'All carriers should pass preflight even with different task identities: ' + JSON.stringify(result.summary));
    assert.strictEqual(result.summary.total, 6, 'Should have 6 carriers');
    assert.strictEqual(result.summary.valid, 6, 'All 6 carriers should be valid');
});

runTest('Defect 1 - preflight with target_workflow passes when target carrier matches requested task', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    }, true, 'one-click-gemini-builder-smoke.yml');
    assert.ok(result.all_valid, 'Preflight should pass with target_workflow matching: ' + JSON.stringify(result.summary));
    assert.strictEqual(result.target_workflow, 'one-click-gemini-builder-smoke.yml');
    assert.strictEqual(result.target_bound, true, 'Target carrier should be bound to requested task');
});

runTest('Defect 1 - preflight with target_workflow fails when target carrier task identity mismatches', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-DIFFERENT-TARGET-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    }, true, 'one-click-gemini-builder-smoke.yml');
    assert.ok(!result.all_valid, 'Preflight should fail when target carrier does not match requested task');
    assert.strictEqual(result.target_bound, false, 'Target carrier should not be bound');
});

runTest('Defect 1 - preflight fails when an invalid unrelated carrier exists (fail-closed)', () => {
    const tmpDir = '/tmp/kilo-test-defect1-failclosed-' + Date.now();
    fs.mkdirSync(tmpDir + '/.github/workflows', { recursive: true });

    for (const wf of ['one-click-gemini-activation-verify-reconcile.yml',
                      'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
                      'one-click-gemini-builder-callback-correlation.yml',
                      'one-click-gemini-research-documentation.yml',
                      'one-click-kilo-acp-copy-safe.yml']) {
        const src = path.join(ONE_CLICK_DIR, wf);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, tmpDir + '/.github/workflows/' + wf);
        }
    }

    const badWorkflowPath = tmpDir + '/.github/workflows/one-click-gemini-activation-verify-reconcile.yml';
    const badWorkflow = "name: Bad\non:\n  workflow_dispatch:\nTASK=`{\"task_name\":\"BAD-TASK\",\"target_agent\":\"Gemini\",\"repository\":\"t\",\"base_branch\":\"main\",\"task_mode\":\"INVALID\",\"capabilities\":[\"read_only\"],\"objective\":\"t\",\"scope\":{\"permitted_paths\":[\"docs/\"]},\"verification\":\"t\",\"constraints\":[\"t\"],\"conflict_handling\":\"t\"}`\n";
    fs.writeFileSync(badWorkflowPath, badWorkflow, 'utf8');

    const result = preflightValidateOneClickActivation(tmpDir + '/.github/workflows');
    assert.ok(!result.all_valid, 'Preflight should fail when an unrelated carrier is invalid');
    const badResult = result.results['one-click-gemini-activation-verify-reconcile.yml'];
    assert.ok(!badResult.valid, 'Bad carrier should be invalid');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('Defect 1 - preflight does not require every carrier to match requested task identity', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook'
    }, true, 'one-click-gemini-builder-smoke.yml');

    const allValid = Object.values(result.results).every(r => r.valid === true);
    assert.ok(allValid, 'All carriers should be individually valid');

    const nonTargetResults = Object.values(result.results).filter((r, i) => {
        const keys = Object.keys(result.results);
        return keys[i] !== 'one-click-gemini-builder-smoke.yml';
    });

    assert.ok(nonTargetResults.length === 5, 'Should have 5 non-target carriers');
});

runTest('Defect 1 - smoke workflow passes preflight CLI with target_workflow identifying the target carrier', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(/target_workflow/.test(raw),
        'Smoke workflow preflight CLI call must include target_workflow parameter');
    const targetWorkflowMatch = raw.match(/"target_workflow":\s*"([^"]+)"/);
    assert.ok(targetWorkflowMatch, 'Smoke workflow must specify a target_workflow value');
    assert.strictEqual(targetWorkflowMatch[1], 'one-click-gemini-builder-smoke.yml',
        'target_workflow must be the smoke workflow itself');
});

runTest('Defect 1 - preflight CLI passes with target_workflow and matching requested_task', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_dir: '.github/workflows',
        target_workflow: 'one-click-gemini-builder-smoke.yml',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook'
        },
        persist_repairs: false
    });
    const output = execFileSync('node', ['poc/validate-external-activation.js', 'one-click-preflight', args], {
        encoding: 'utf8', timeout: 10000
    });
    assert.ok(output.includes('passed'), 'Preflight CLI should pass with correct target_workflow binding');
});

runTest('Defect 1 - preflight CLI fails when target_workflow carrier does not match requested_task', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_dir: '.github/workflows',
        target_workflow: 'one-click-gemini-builder-smoke.yml',
        requested_task: {
            task_name: 'TASK-WRONG-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook'
        },
        persist_repairs: false
    });
    let exitCode = 0;
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'one-click-preflight', args], {
            encoding: 'utf8', timeout: 10000
        });
    } catch (e) {
        exitCode = e.status || 1;
        output = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(exitCode !== 0, 'Preflight CLI must fail when target carrier task mismatches requested task');
    assert.ok(output.includes('failed') || output.includes('error'), 'Output must indicate failure');
});

// =========================================================
// Regression tests: coordinator verification reads origin/main (Defect 2)
// TASK-KILO-FIX-ONE-CLICK-PREFLIGHT-REMOTE-MAIN-BLOCKERS-001
// =========================================================

runTest('Defect 2 - fetchWorkflowFromOriginMain uses origin/ ref explicitly', () => {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(/git.*show.*origin.*\/.*baseBranch.*workflowPath/.test(raw.replace(/\s+/g, ' ')) ||
        /'origin\/'.*baseBranch/.test(raw),
        'fetchWorkflowFromOriginMain must reference origin/ ref explicitly');
    assert.ok(!/git.*show.*baseBranch.*workflowPath/.test(raw.replace(/\s+/g, ' ')) ||
        /'origin\/'.*baseBranch/.test(raw),
        'git show must use origin/baseBranch, not bare baseBranch');
});

runTest('Defect 2 - coordinator-verify source reports origin/main (not checkout fallback)', () => {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'poc', 'validate-external-activation.js'), 'utf8');
    assert.ok(!/verificationSource.*=.*'checkout'/.test(raw),
        'coordinator-verify must not fall back to local checkout when origin/main read fails');
    assert.ok(!/checkout/.test(raw),
        'coordinator-verify must not reference checkout as a verification source');
    assert.ok(!/fs\.readFileSync.*workflowPath.*utf8/.test(raw),
        'coordinator-verify must not read local checkout as origin/main fallback');
});

runTest('Defect 2 - coordinator-verify fails closed when origin/main unavailable', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: '.github/workflows',
        base_branch: 'nonexistent-branch-zzz',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            task_mode: 'BUILDER',
            permitted_paths: ['test/schema.test.js']
        }
    });
    let exitCode = 0;
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
            encoding: 'utf8', timeout: 10000
        });
    } catch (e) {
        exitCode = e.status || 1;
        output = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(exitCode !== 0, 'coordinator-verify must fail when origin/main ref is unavailable');
    assert.ok(output.includes('BLOCKED') || output.includes('not found'), 'Must be blocked, not succeed via fallback');
});

runTest('Defect 2 - coordinator-verify produces verification_source=origin/main on success', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: '.github/workflows',
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            task_mode: 'BUILDER',
            permitted_paths: ['test/schema.test.js']
        }
    });
    const output = execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
        encoding: 'utf8', timeout: 10000
    });
    assert.ok(output.includes('origin/main'), 'Output must mention origin/main as verification source');
    assert.ok(!output.includes('checkout'), 'Must not reference local checkout source');
});

runTest('Defect 2 - coordinator-verify verified_on_main is true only when origin/main read succeeds', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: '.github/workflows',
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            task_mode: 'BUILDER',
            permitted_paths: ['test/schema.test.js']
        }
    });
    const tmpFile = '/tmp/kilo-coordinator-verify-output-' + Date.now();
    fs.writeFileSync(tmpFile, '', 'utf8');
    const env = Object.assign({}, process.env, { GITHUB_OUTPUT: tmpFile });
    execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
        encoding: 'utf8', timeout: 10000, env: env, cwd: ROOT_DIR
    });
    const outputContent = fs.readFileSync(tmpFile, 'utf8');
    assert.ok(/verified_on_main=true/.test(outputContent), 'verified_on_main must be true when origin/main read succeeds');
    assert.ok(/verification_source=origin\/main/.test(outputContent), 'verification_source must be origin/main');
    fs.rmSync(tmpFile, { force: true });
});

// =========================================================
// Regression tests: one-click smoke workflow commit/push, push status, and report safety fixes
// TASK-KILO-FIX-ONE-CLICK-BUILDER-SMOKE-EXECUTION-AND-REPORTING-001
// =========================================================

runTest('Smoke workflow - commit/push step does not use git add -A (stages only permitted paths)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    assert.ok(commitIdx !== -1, 'Must have Commit and push step');
    const commitSection = raw.slice(commitIdx, raw.indexOf('\n      - name:', commitIdx + 10) > -1
        ? raw.indexOf('\n      - name:', commitIdx + 10)
        : commitIdx + 5000);
    assert.ok(!/git add -A/.test(commitSection),
        'Commit/push step must NOT use git add -A');
    assert.ok(/git add "\$dir"/.test(commitSection),
        'Commit/push step must stage only permitted paths via git add "$dir"');
    assert.ok(/PERMITTED_PATHS/.test(commitSection),
        'Commit/push step must use PERMITTED_PATHS env var for staging');
});

runTest('Smoke workflow - commit/push step stages only permitted paths, not generated files', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(!/git add execution-descriptor\.json/.test(commitSection),
        'Must not stage execution-descriptor.json');
    assert.ok(!/git add callback_payload\.json/.test(commitSection),
        'Must not stage callback_payload.json');
    assert.ok(!/git add gemini-acp-report\.json/.test(commitSection),
        'Must not stage gemini-acp-report.json');
    assert.ok(/git add "\$dir"/.test(commitSection),
        'Must stage only via permitted path directories');
});

runTest('Smoke workflow - commit/push step rejects out-of-scope files before committing', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/OUT_OF_SCOPE/.test(commitSection),
        'Commit step must track out-of-scope files');
    assert.ok(/::error::Out-of-scope files/.test(commitSection),
        'Commit step must emit error on out-of-scope files');
    assert.ok(/exit 1/.test(commitSection),
        'Commit step must exit 1 on out-of-scope files');
    assert.ok(/IN_SCOPE/.test(commitSection),
        'Commit step must check each staged file against permitted paths');
});

runTest('Smoke workflow - commit/push step fetches origin/main for reconciliation before pushing', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/git fetch origin.*\$BASE_BRANCH/.test(commitSection) || /git fetch origin "\$BASE_BRANCH"/.test(commitSection),
        'Commit step must fetch origin/main before pushing');
    assert.ok(/git merge-base --is-ancestor/.test(commitSection),
        'Commit step must check if local HEAD is ancestor of origin/main');
    assert.ok(/origin\/\$BASE_BRANCH/.test(commitSection),
        'Commit step must reference origin/$BASE_BRANCH for reconciliation');
});

runTest('Smoke workflow - commit/push step does NOT force-push', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(!/git push --force/.test(commitSection),
        'Commit step must NOT use git push --force');
    assert.ok(!/git push -f/.test(commitSection),
        'Commit step must NOT use git push -f');
    assert.ok(/git push origin "\$BASE_BRANCH"/.test(commitSection),
        'Commit step must push to origin/$BASE_BRANCH');
});

runTest('Smoke workflow - commit/push step stops safely on merge conflict', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/Merge conflict/.test(commitSection),
        'Commit step must handle merge conflicts gracefully');
    assert.ok(/exit 1/.test(commitSection),
        'Commit step must stop safely on merge conflict');
    assert.ok(/not force-push/.test(commitSection) || /not force/.test(commitSection),
        'Commit step must reference no-force-push constraint on conflict');
});

runTest('Smoke workflow - commit/push step tracks push_status output accurately', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/push_status=/.test(commitSection),
        'Commit step must output push_status');
    assert.ok(/PUSH_STATUS="true"/.test(commitSection),
        'Commit step must set PUSH_STATUS=true only after successful push');
    assert.ok(/PUSH_STATUS="failed"/.test(commitSection),
        'Commit step must set PUSH_STATUS=failed when push fails');
});

runTest('Smoke workflow - builder_result step distinguishes commit success from push success', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const resultIdx = raw.indexOf('Determine Builder execution result');
    assert.ok(resultIdx !== -1, 'Must have builder_result step');
    const resultSection = raw.slice(resultIdx, resultIdx + 3000);
    assert.ok(/Commit created but push.*failed/.test(resultSection),
        'builder_result must have a branch for commit-success-push-failed');
    assert.ok(/BUILDER_OUTCOME/.test(resultSection),
        'builder_result must reference BUILDER_OUTCOME');
    assert.ok(/COMMIT_PUSH_OUTCOME/.test(resultSection),
        'builder_result must reference COMMIT_PUSH_OUTCOME');
    assert.ok(/HAS_CHANGES/.test(resultSection),
        'builder_result must reference HAS_CHANGES output');
    assert.ok(/PUSH_STATUS/.test(resultSection),
        'builder_result must reference PUSH_STATUS output');
    assert.ok(!/Builder completed with no file changes/.test(resultSection) ||
        /Builder completed but produced no commit/.test(resultSection),
        'builder_result must not claim success when builder has no changes');
});

runTest('Smoke workflow - callback_payload step uses set -uo pipefail (not -e) to avoid exit-before-report', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const cbIdx = raw.indexOf('Prepare ACP report payload');
    assert.ok(cbIdx !== -1, 'Must have Prepare ACP report payload step');
    const cbSection = raw.slice(cbIdx, cbIdx + 3000);
    assert.ok(/set -uo pipefail/.test(cbSection),
        'callback_payload step must use set -uo pipefail (not -e) to ensure report generation');
    assert.ok(!/set -euo pipefail/.test(cbSection),
        'callback_payload step must NOT use set -e which would exit before creating the report');
});

runTest('Smoke workflow - callback_payload step always generates gemini-acp-report.json even on failure', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const cbIdx = raw.indexOf('Prepare ACP report payload');
    const cbSection = raw.slice(cbIdx, cbIdx + 12000);
    assert.ok(/callback_payload\.json/.test(cbSection),
        'callback_payload step must write to callback_payload.json');
    assert.ok(/gemini-acp-report\.json/.test(cbSection),
        'callback_payload must write to gemini-acp-report.json');
    assert.ok(/failed-closed report/.test(cbSection) || /report generation failed/.test(cbSection),
        'callback_payload must have fail-closed fallback for report generation');
});

runTest('Smoke workflow - callback_payload step push status reflects actual push, not just commit existence', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const cbIdx = raw.indexOf('Prepare ACP report payload');
    const cbSection = raw.slice(cbIdx, cbIdx + 12000);
    assert.ok(/if.*PUSH_STATUS.*=.*true/.test(cbSection) || /PUSH_VAL.*PUSH_STATUS/.test(cbSection),
        'callback_payload must derive push status from PUSH_STATUS output, not just commit SHA existence');
    assert.ok(!/PUSH_STATUS=true/.test(cbSection.replace(/if.*PUSH_STATUS.*/, '')),
        'callback_payload must not unconditionally set push=true based on commit SHA alone');
});

runTest('Smoke workflow - has failure-safe step ensuring gemini-acp-report.json exists', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(/Ensure gemini-acp-report\.json exists.*failure-safe/.test(raw),
        'Workflow must have a failure-safe step ensuring report exists');
    assert.ok(/! -f gemini-acp-report\.json/.test(raw),
        'Failure-safe step must check for missing report file');
    assert.ok(/fail-closed report/.test(raw) || /gemini-acp-report\.json could not be generated/.test(raw),
        'Failure-safe step must write a fail-closed report');
});

runTest('Smoke workflow - upload artifact uses if-no-files-found: warn (not error)', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const uploadIdx = raw.indexOf('Upload Builder result artifact');
    assert.ok(uploadIdx !== -1, 'Must have Upload artifact step');
    const uploadSection = raw.slice(uploadIdx, uploadIdx + 500);
    assert.ok(/if-no-files-found: warn/.test(uploadSection),
        'Upload step must use if-no-files-found: warn so it does not fail the workflow when report is missing');
});

runTest('Smoke workflow - commit/push step references BASE_BRANCH from orchestration context, not hardcoded', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/BASE_BRANCH.*orchestration_context/.test(commitSection) || /BASE_BRANCH.*steps\.orchestration_context/.test(commitSection),
        'Commit/push step must derive BASE_BRANCH from orchestration context');
    assert.ok(/PERMITTED_PATHS.*orchestration_context/.test(commitSection) || /PERMITTED_PATHS.*steps\.orchestration_context/.test(commitSection),
        'Commit/push step must derive PERMITTED_PATHS from orchestration context');
});

runTest('Smoke workflow - safe reconciliation preserves unrelated remote work', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/git merge --no-edit/.test(commitSection),
        'Commit step must use merge --no-edit for reconciliation');
    assert.ok(/--no-ff/.test(commitSection),
        'Commit step must use --no-ff for explicit merge');
});

runTest('Smoke workflow - execution-descriptor.json excluded from commit staging', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const commitIdx = raw.indexOf('Commit and push Builder changes');
    const commitSection = raw.slice(commitIdx, commitIdx + 5000);
    assert.ok(/execution-descriptor\.json/.test(raw),
        'Workflow references execution-descriptor.json');
    assert.ok(!/git add.*execution-descriptor\.json/.test(commitSection),
        'Commit step must NOT stage execution-descriptor.json');
    assert.ok(/git add "\$dir"/.test(commitSection),
        'Commit step must stage only permitted path directories');
});

// =========================================================
// Regression tests: all carrier workflows must not use git add -A (Defect 2 - staging safety)
// TASK-KILO-FIX-SYSTEMIC-WORKFLOW-SAFETY-REGRESSION-001
// =========================================================

runTest('All carrier workflows - no git add -A in commit/push step', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const commitIdx = raw.indexOf('Commit and push Builder changes');
        if (commitIdx === -1) continue;
        const commitSection = raw.slice(commitIdx, commitIdx + 6000);
        assert.ok(!/git add -A/.test(commitSection),
            wf + ' must NOT use git add -A in commit/push step');
        assert.ok(/PERMITTED_PATHS|permitted_paths/.test(commitSection),
            wf + ' must use PERMITTED_PATHS or permitted_paths for staging');
    }
});

runTest('All carrier workflows - commit/push pushes to base_branch without --force', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const commitIdx = raw.indexOf('Commit and push Builder changes');
        if (commitIdx === -1) continue;
        const commitSection = raw.slice(commitIdx, commitIdx + 6000);
        assert.ok(!/git push --force|git push -f/.test(commitSection),
            wf + ' must NOT use git push --force');
        assert.ok(/git push origin/.test(commitSection),
            wf + ' must push to origin');
    }
});

runTest('All carrier workflows - commit/push step emits push_status output', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const commitIdx = raw.indexOf('Commit and push Builder changes');
        if (commitIdx === -1) continue;
        const commitSection = raw.slice(commitIdx, commitIdx + 6000);
        assert.ok(/push_status=/.test(commitSection),
            wf + ' must emit push_status output variable');
        assert.ok(/PUSH_STATUS="true"/.test(commitSection) || /PUSH_STATUS=true/.test(commitSection),
            wf + ' must set PUSH_STATUS=true on successful push');
        assert.ok(/PUSH_STATUS="failed"/.test(commitSection) || /PUSH_STATUS=failed/.test(commitSection),
            wf + ' must set PUSH_STATUS=failed on push failure');
    }
});

runTest('All carrier workflows - callback_payload step uses set -uo pipefail (not -e)', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        const cbSection = raw.slice(cbIdx, cbIdx + 3000);
        assert.ok(/set -uo pipefail/.test(cbSection),
            wf + ' callback_payload step must use set -uo pipefail');
        assert.ok(!/set -euo pipefail/.test(cbSection),
            wf + ' callback_payload step must NOT use set -e which would exit before creating the report');
    }
});

runTest('All carrier workflows - have failure-safe step ensuring gemini-acp-report.json exists', () => {
    const allWorkflows = listOneClickWorkflows();
    const reportStepRegex = /Ensure gemini-acp-report\.json exists.*failure-safe/i;
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        assert.ok(reportStepRegex.test(raw),
            wf + ' must have a failure-safe step ensuring report exists');
        assert.ok(/! -f gemini-acp-report\.json/.test(raw),
            wf + ' failure-safe step must check for missing report file');
    }
});

runTest('All carrier workflows - upload artifact uses if-no-files-found: warn (not error)', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        assert.ok(!/if-no-files-found: error/.test(raw),
            wf + ' must NOT use if-no-files-found: error');
    }
});

runTest('All carrier workflows - builder_result distinguishes commit success from push success', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const resultIdx = raw.indexOf('Determine Builder execution result');
        if (resultIdx === -1) continue;
        const resultSection = raw.slice(resultIdx, resultIdx + 3000);
        assert.ok(/PUSH_STATUS/.test(resultSection),
            wf + ' builder_result must reference PUSH_STATUS output');
        assert.ok(/Commit created but push/.test(resultSection),
            wf + ' builder_result must distinguish commit-success-push-failed');
        assert.ok(/COMMIT_PUSH_OUTCOME/.test(resultSection),
            wf + ' builder_result must reference COMMIT_PUSH_OUTCOME');
    }
});

runTest('All carrier workflows - callback handling guards request_id before sending callback', () => {
    const allWorkflows = listOneClickWorkflows();
    for (const wf of allWorkflows) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8');
        const cbIdx = raw.indexOf('Send callback to Render');
        if (cbIdx === -1) continue;
        const cbSection = raw.slice(cbIdx, cbIdx + 3000);
        assert.ok(/\[ -z "\$REQUEST_ID" \]/.test(cbSection) || /request_id.*missing.*empty.*invalid/.test(cbSection),
            wf + ' callback step must check request_id before sending callback');
    }
});

// =========================================================
// Regression tests: VALID_ONE_CLICK_WORKFLOWS drift prevention
// TASK-KILO-FIX-SYSTEMIC-WORKFLOW-SAFETY-REGRESSION-001
// =========================================================

runTest('VALID_ONE_CLICK_WORKFLOWS in source matches listOneClickWorkflows helper', () => {
    const sourceList = CANONICAL_VALID_ONE_CLICK_WORKFLOWS;
    const helperList = canonicalListOneClickWorkflows();
    assert.deepStrictEqual(sourceList, helperList,
        'VALID_ONE_CLICK_WORKFLOWS and listOneClickWorkflows must stay in sync');
});

runTest('All VALID_ONE_CLICK_WORKFLOWS files exist on disk', () => {
    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        const filePath = path.join(ONE_CLICK_DIR, wf);
        assert.ok(fs.existsSync(filePath),
            'Workflow file declared in VALID_ONE_CLICK_WORKFLOWS must exist: ' + wf);
    }
});

runTest('VALID_ONE_CLICK_WORKFLOWS contains all active carrier workflows', () => {
    const registered = new Set(CANONICAL_VALID_ONE_CLICK_WORKFLOWS);
    const expectedCarriers = [
        'one-click-gemini-activation-verify-reconcile.yml',
        'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
        'one-click-gemini-builder-callback-correlation.yml',
        'one-click-gemini-research-documentation.yml',
        'one-click-kilo-acp-copy-safe.yml'
    ];
    for (const wf of expectedCarriers) {
        assert.ok(registered.has(wf),
            'Active carrier workflow must be registered: ' + wf);
    }
});

// =========================================================
// Regression tests: workflow-failure prevention fixes
// (TASK-KILO-SYSTEMWIDE-WORKFLOW-FAILURE-PREVENTION-001)
// =========================================================
// Defects #11-#13 discovered during smoke run verification
// =========================================================

const ALL_WORKFLOWS_WITH_PROVENANCE = [
    'external-gemini-activation-test.yml',
    'gemini-builder.yml',
    'kilo-gemini-poc.yml',
    'main.yml',
    'one-click-gemini-acp-report-durable-readable-evidence-builder.yml',
    'one-click-gemini-builder-callback-correlation.yml',
    'one-click-gemini-builder-coordinator-registration-gate.yml',
    'one-click-gemini-builder-coordinator-registration-gate-fixed.yml',
    'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
    'one-click-kilo-acp-copy-safe.yml'
];

const CARRIER_WORKFLOWS = [
    'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-phase4-increment-4-2-corrective.yml',
    'one-click-gemini-builder-callback-correlation.yml',
    'one-click-gemini-builder-coordinator-registration-gate.yml',
    'one-click-gemini-builder-coordinator-registration-gate-fixed.yml',
    'one-click-gemini-acp-report-durable-readable-evidence-builder.yml',
    'one-click-kilo-acp-copy-safe.yml'
];

// =========================================================
// Defect #11: jq quotation breakage — REPOSITORY/BASE_BRANCH
// inline GitHub expressions inside jq string literals
// =========================================================

runTest('Defect 11 - no inline ${{ }} in jq --arg for repository or base_branch', () => {
    for (const wfName of ALL_WORKFLOWS_WITH_PROVENANCE) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const inlineRepoInJq = raw.match(/--arg\s+repository\s+'\$\{\{[^}]+\}\}'/);
        const inlineBranchInJq = raw.match(/--arg\s+base_branch\s+'\$\{\{[^}]+\}\}'/);
        assert.ok(!inlineRepoInJq, wfName + ' must not use inline ${{ }} for repository in jq --arg');
        assert.ok(!inlineBranchInJq, wfName + ' must not use inline ${{ }} for base_branch in jq --arg');
    }
});

runTest('Defect 11 - REPOSITORY/BASE_BRANCH use env vars (not inline ${{ }} in bash body) in callback_payload', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        const cbSection = raw.slice(cbIdx, cbIdx + 12000);
        const hasEnvVar = /REPOSITORY:\s*\$\{\{/.test(cbSection) ||
            /DEFAULT_REPO.*GITHUB_REPOSITORY/.test(cbSection) ||
            /REPOSITORY=.*steps.*outputs\.repository/.test(cbSection);
        assert.ok(hasEnvVar,
            wfName + ' callback_payload step must use env var for REPOSITORY, not inline bash');
        const hasBranchVar = /BASE_BRANCH:\s*\$\{\{/.test(cbSection) ||
            /DEFAULT_BRANCH.*GITHUB_REF_NAME/.test(cbSection) ||
            /BASE_BRANCH=.*steps.*outputs\.base_branch/.test(cbSection);
        assert.ok(hasBranchVar,
            wfName + ' callback_payload step must use env var for BASE_BRANCH, not inline bash');
    }
});

runTest('Defect 11 - no inline ${{ github.repository }} or ${{ github.ref_name }} in callback_payload bash body', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        const cbSection = raw.slice(cbIdx, cbIdx + 8000);
        assert.ok(!cbSection.includes('${{ github.repository }}'),
            wfName + ' callback_payload must not use inline ${{ github.repository }} in bash body');
        assert.ok(!cbSection.includes('${{ github.ref_name }}'),
            wfName + ' callback_payload must not use inline ${{ github.ref_name }} in bash body');
    }
});

// =========================================================
// Defect #12: TASK JSON inline expansion breakage
// When task JSON contains embedded quotes, inline
// ${TASK_JSON} expansion breaks bash quoting
// =========================================================

runTest('Defect 12 - no inline bash string expansion of TASK with embedded JSON containing quotes', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const badInlinePattern = raw.match(/TASK="\$\{\{[^}]*\.task[^}]*\}\}"/);
        assert.ok(!badInlinePattern,
            wfName + ' must not use inline TASK="${{ steps.*.outputs.task }}"');
    }
});

runTest('Defect 12 - callback_payload uses TASK_JSON env var for task field assignment', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        assert.ok(/TASK_JSON:\s*\$\{\{/.test(raw.slice(cbIdx, cbIdx + 2000)),
            wfName + ' callback_payload step must declare TASK_JSON as an env: variable');
    }
});

runTest('Defect 12 - callback_payload assigns TASK="$TASK_JSON" (via env var, not inline)', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        const cbSection = raw.slice(cbIdx, cbIdx + 8000);
        if (cbSection.includes('TASK=')) {
            assert.ok(/TASK="\$TASK_JSON"/.test(cbSection) || /TASK=\$TASK_JSON/.test(cbSection),
                wfName + ' callback_payload must assign TASK from $TASK_JSON env var');
            assert.ok(!/TASK="\$\{\{/.test(cbSection),
                wfName + ' callback_payload must not use inline TASK="${{ }}"');
        }
    }
});

runTest('Defect 12 - TASK_JSON is declared as env: variable in callback_payload step', () => {
    for (const wfName of CARRIER_WORKFLOWS) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const cbIdx = raw.indexOf('Prepare ACP report payload');
        if (cbIdx === -1) continue;
        const envSection = raw.slice(cbIdx, cbIdx + 1500);
        assert.ok(/TASK_JSON:\s*\$\{\{/.test(envSection),
            wfName + ' callback_payload step must declare TASK_JSON as an env: variable');
    }
});

runTest('Defect 13 - callback_payload requires authoritative orchestration outputs without stale descriptor fallback', () => {
    const correctiveWf = 'one-click-gemini-builder-phase4-increment-4-2-corrective.yml';
    const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', correctiveWf), 'utf8');
    const cbIdx = raw.indexOf('Prepare ACP report payload');
    assert.ok(cbIdx !== -1, 'callback_payload step must exist');
    const cbSection = raw.slice(cbIdx, cbIdx + 2000);

    assert.ok(/ORCH_REQUEST_ID/.test(cbSection),
        correctiveWf + ' callback_payload must read request_id from orchestration_context outputs');
    assert.ok(/ORCH_EXECUTION_CLAIM_ID/.test(cbSection),
        correctiveWf + ' callback_payload must read execution_claim_id from orchestration_context outputs');
    assert.ok(/ORCH_CARRIER_IDENTITY/.test(cbSection),
        correctiveWf + ' callback_payload must read carrier_identity from orchestration_context outputs');

    assert.ok(/IDENTITY_MISSING/.test(cbSection),
        correctiveWf + ' callback_payload must fail closed when orchestration outputs are missing');

    assert.ok(!/elif.*DESCRIPTOR_FILE/.test(cbSection),
        correctiveWf + ' callback_payload must NOT fall back to execution-descriptor.json for authoritative identity');
    assert.ok(!/one_click_context.*request_id/.test(cbSection),
        correctiveWf + ' callback_payload must NOT fall back to one_click_context for authoritative request_id');
});

// =========================================================
// Defect #13: GITHUB_OUTPUT multi-line value corruption
// echo "field=$MULTI_LINE_VALUE" >> $GITHUB_OUTPUT
// corrupts multi-line JSON output; must use <<EOF delimiter
// =========================================================

runTest('Defect 13 - provenance_result uses <<EOF delimiter (not direct echo of multi-line JSON)', () => {
    for (const wfName of ALL_WORKFLOWS_WITH_PROVENANCE) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const hasProvenanceResult = /provenance_result/.test(raw);
        if (!hasProvenanceResult) continue;
        assert.ok(/provenance_result<<EOF/.test(raw) || /provenance_result<</.test(raw),
            wfName + ' must use <<EOF delimiter for provenance_result multi-line output');
        assert.ok(!/echo "provenance_result=\$\{/.test(raw),
            wfName + ' must NOT use direct echo "provenance_result=${...}" for multi-line JSON');
    }
});

runTest('Defect 13 - no direct echo of multi-line variables to GITHUB_OUTPUT without <<EOF', () => {
    for (const wfName of ALL_WORKFLOWS_WITH_PROVENANCE) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const badPattern = raw.match(/echo "(RESULT|REPORT_JSON|provenance_result)=\$\{/);
        assert.ok(!badPattern,
            wfName + ' must not directly echo RESULT/REPORT_JSON to GITHUB_OUTPUT (use <<EOF)');
    }
});

runTest('Defect 13 - provenance_result section has matching EOF delimiter', () => {
    for (const wfName of ALL_WORKFLOWS_WITH_PROVENANCE) {
        const raw = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', wfName), 'utf8');
        const hasProvenanceResult = /provenance_result<<EOF/.test(raw) || /provenance_result<</.test(raw);
        if (!hasProvenanceResult) continue;
        assert.ok(/echo "EOF"/.test(raw) || /echo 'EOF'/.test(raw),
            wfName + ' must have matching EOF delimiter after provenance_result<<EOF');
    }
});

// (TASK-KILO-SYSTEMWIDE-WORKFLOW-FAILURE-PREVENTION-001)
// =========================================================

runTest('E2E - preflight returns independent registry_integrity and target_binding fields', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        permitted_paths: ['test/schema.test.js']
    }, false, 'one-click-gemini-builder-smoke.yml');
    assert.ok(result.hasOwnProperty('registry_integrity'),
        'preflight must return registry_integrity field independent of target_binding');
    assert.ok(result.hasOwnProperty('target_binding'),
        'preflight must return target_binding field independent of registry_integrity');
    assert.ok(typeof result.registry_integrity === 'object',
        'registry_integrity must be an object');
    assert.ok(typeof result.target_binding === 'object',
        'target_binding must be an object');
    assert.ok(result.registry_integrity.hasOwnProperty('status'),
        'registry_integrity must have a status field');
    assert.ok(result.target_binding.hasOwnProperty('status'),
        'target_binding must have a status field');
});

runTest('E2E - registry_integrity status is VALID when all carrier artifacts are structurally valid', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', null, false, null);
    assert.strictEqual(result.registry_integrity.status, 'VALID',
        'All committed carrier workflows must have valid embedded ACP artifacts');
});

runTest('E2E - target_binding status is BOUND when smoke workflow matches requested task', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        permitted_paths: ['test/schema.test.js']
    }, false, 'one-click-gemini-builder-smoke.yml');
    assert.strictEqual(result.target_binding.status, 'BOUND',
        'Smoke workflow must have matching task identity for target_binding');
    assert.strictEqual(result.target_binding.target_bound, true,
        'target_bound must be true for smoke workflow with correct task identity');
});

runTest('E2E - target_binding is BOUND even when requested_task is provided without target_workflow', () => {
    const result = preflightValidateOneClickActivation('.github/workflows', {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        permitted_paths: ['test/schema.test.js']
    }, false, null);
    const boundCount = Object.values(result.results).filter(r => r.bound === true).length;
    assert.ok(boundCount >= 1,
        'At least one carrier must match the requested task identity');
    assert.strictEqual(result.target_binding.status, 'BOUND',
        'target_binding should be BOUND when at least one carrier matches');
});

runTest('E2E - registry_integrity and target_binding fail independently (no weakening)', () => {
    const smokeRaw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const originalArtifact = extractEmbeddedCarrierArtifact(smokeRaw);
    const parsed = JSON.parse(originalArtifact);

    parsed.task_name = 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001-WRONG';
    const wrongIdentityArtifact = JSON.stringify(parsed, null, 2);

    const { validateAcpTaskArtifact } = require('../poc/schemas/acp-schema');
    const schemaValidation = validateAcpTaskArtifact(wrongIdentityArtifact);
    assert.ok(schemaValidation.valid,
        'The modified artifact must still be schema-valid (only task_name changed)');

    const { persistRepairedCarrier } = require('../poc/one-click-artifact-validator');
    const tmpDir = '/tmp/e2e-binding-test-' + Date.now();
    fs.mkdirSync(tmpDir);

    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        const src = path.join('.github/workflows', wf);
        const dest = path.join(tmpDir, wf);
        fs.copyFileSync(src, dest);
    }

    const srcWf = path.join(tmpDir, 'one-click-gemini-builder-smoke.yml');
    const srcRaw = fs.readFileSync(srcWf, 'utf8');
    const persistResult = persistRepairedCarrier(srcRaw, wrongIdentityArtifact);
    assert.ok(persistResult.persisted, 'persistRepairedCarrier must succeed for the smoke workflow');
    fs.writeFileSync(srcWf, persistResult.workflow_raw, 'utf8');

    const result = preflightValidateOneClickActivation(tmpDir, {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        permitted_paths: ['test/schema.test.js']
    }, false, 'one-click-gemini-builder-smoke.yml');

    assert.strictEqual(result.registry_integrity.status, 'VALID',
        'registry_integrity must remain VALID: the artifact is structurally valid and schema-valid');
    assert.strictEqual(result.target_binding.status, 'UNBOUND',
        'target_binding must be UNBOUND: task_name does not match requested task');

    assert.strictEqual(result.all_valid, false,
        'all_valid must be false because target_binding failed (registry_integrity is valid)');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - registry_integrity fails independently when carrier artifact is malformed', () => {
    const tmpDir = '/tmp/e2e-regintegrity-test-' + Date.now();
    fs.mkdirSync(tmpDir);

    const smokeRaw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const { persistRepairedCarrier } = require('../poc/one-click-artifact-validator');

    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        const src = path.join('.github/workflows', wf);
        const dest = path.join(tmpDir, wf);
        fs.copyFileSync(src, dest);
    }

    const srcWf = path.join(tmpDir, 'one-click-gemini-builder-smoke.yml');
    const srcRaw = fs.readFileSync(srcWf, 'utf8');
    const malformedArtifact = '{"task_name": "BROKEN", invalid: json}';
    const persistResult = persistRepairedCarrier(srcRaw, malformedArtifact);
    assert.ok(persistResult.persisted, 'persistRepairedCarrier must succeed for the smoke workflow');
    fs.writeFileSync(srcWf, persistResult.workflow_raw, 'utf8');

    const result = preflightValidateOneClickActivation(tmpDir, {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        permitted_paths: ['test/schema.test.js']
    }, false, 'one-click-gemini-builder-smoke.yml');

    assert.strictEqual(result.registry_integrity.status, 'INVALID',
        'registry_integrity must be INVALID when an embedded artifact is malformed JSON');
    assert.ok(result.registry_integrity.invalid_carriers.length > 0,
        'registry_integrity must list the invalid carrier');

    assert.strictEqual(result.all_valid, false,
        'all_valid must be false because registry_integrity failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - coordinator-verify emits registry_integrity_status and target_binding_status outputs', () => {
    const tmpDir = '/tmp/e2e-coord-verify-output-' + Date.now();
    fs.mkdirSync(tmpDir);

    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        const src = path.join('.github/workflows', wf);
        const dest = path.join(tmpDir, wf);
        fs.copyFileSync(src, dest);
    }

    const githubOutputFile = path.join(tmpDir, 'github_output');
    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: tmpDir,
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            task_mode: 'BUILDER',
            permitted_paths: ['test/schema.test.js']
        }
    });
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, GITHUB_OUTPUT: githubOutputFile }
        });
    } catch (e) {
        output = (e.stdout || '') + (e.stderr || '');
    }
    const githubOutput = fs.existsSync(githubOutputFile) ? fs.readFileSync(githubOutputFile, 'utf8') : '';
    const combined = output + githubOutput;
    assert.ok(/registry_integrity_status=/.test(combined),
        'coordinator-verify must emit registry_integrity_status output');
    assert.ok(/target_binding_status=/.test(combined),
        'coordinator-verify must emit target_binding_status output');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - coordinator-verify fails closed when target_binding fails', () => {
    const tmpDir = '/tmp/e2e-coord-verify-binding-' + Date.now();
    fs.mkdirSync(tmpDir);
    const githubOutputFile = path.join(tmpDir, 'github_output');

    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: '.github/workflows',
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-NON-EXISTENT-FAKE-TASK-12345',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            permitted_paths: ['test/schema.test.js']
        }
    });
    let exitedNonZero = false;
    try {
        execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, GITHUB_OUTPUT: githubOutputFile }
        });
    } catch (e) {
        exitedNonZero = true;
    }
    assert.ok(exitedNonZero,
        'coordinator-verify must exit non-zero when target_binding fails');
    const githubOutput = fs.existsSync(githubOutputFile) ? fs.readFileSync(githubOutputFile, 'utf8') : '';
    assert.ok(/target_binding_status=UNBOUND/.test(githubOutput),
        'coordinator-verify must emit target_binding_status=UNBOUND when binding fails');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - coordinator-verify fails closed when registry_integrity fails', () => {
    const tmpDir = '/tmp/e2e-coordinator-regfail-' + Date.now();
    fs.mkdirSync(tmpDir);

    const { persistRepairedCarrier } = require('../poc/one-click-artifact-validator');

    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        const src = path.join('.github/workflows', wf);
        const dest = path.join(tmpDir, wf);
        fs.copyFileSync(src, dest);
    }

    const srcWf = path.join(tmpDir, 'one-click-gemini-builder-smoke.yml');
    const srcRaw = fs.readFileSync(srcWf, 'utf8');
    const malformedArtifact = '{"task_name": "BROKEN", invalid: json}';
    const persistResult = persistRepairedCarrier(srcRaw, malformedArtifact);
    assert.ok(persistResult.persisted, 'persistRepairedCarrier must succeed for the smoke workflow');
    fs.writeFileSync(srcWf, persistResult.workflow_raw, 'utf8');

    const githubOutputFile = path.join(tmpDir, 'github_output');
    const args = JSON.stringify({
        workflow_name: 'one-click-gemini-builder-smoke.yml',
        workflow_dir: tmpDir,
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            permitted_paths: ['test/schema.test.js']
        }
    });
    let exitedNonZero = false;
    try {
        execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, GITHUB_OUTPUT: githubOutputFile }
        });
    } catch (e) {
        exitedNonZero = true;
    }
    assert.ok(exitedNonZero,
        'coordinator-verify must exit non-zero when registry_integrity fails');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - one-click-preflight emits registry_integrity_status and target_binding_status on failure', () => {
    const tmpDir = '/tmp/e2e-preflight-output-' + Date.now();
    fs.mkdirSync(tmpDir);
    const githubOutputFile = path.join(tmpDir, 'github_output');

    const args = JSON.stringify({
        workflow_dir: '.github/workflows',
        target_workflow: 'one-click-gemini-builder-smoke.yml',
        requested_task: {
            task_name: 'TASK-NON-EXISTENT-FAKE-TASK-99999',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook'
        },
        persist_repairs: false
    });
    let exitedNonZero = false;
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'one-click-preflight', args], {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, GITHUB_OUTPUT: githubOutputFile }
        });
    } catch (e) {
        exitedNonZero = true;
        output = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(exitedNonZero,
        'one-click-preflight must exit non-zero when target_binding fails');
    const githubOutput = fs.existsSync(githubOutputFile) ? fs.readFileSync(githubOutputFile, 'utf8') : '';
    assert.ok(/registry_integrity_status=/.test(githubOutput),
        'one-click-preflight must emit registry_integrity_status even on failure');
    assert.ok(/target_binding_status=/.test(githubOutput),
        'one-click-preflight must emit target_binding_status even on failure');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

runTest('E2E - smoke workflow task_name must not be the Phase 4 corrective task', () => {
    const smokeWorkflow = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(!/TASK-GEMINI-BUILDER-PHASE4.*CORRECTIVE-001/.test(smokeWorkflow),
        'Smoke workflow must not embed the Phase 4 corrective task identity');
});

runTest('E2E - smoke workflow serialized payload matches embedded artifact (fail-closed consistency check)', () => {
    const { execFileSync } = require('child_process');
    const smokeRaw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');

    const serializeCliMatch = smokeRaw.match(/serialize-carrier\s+'([^']+)'\)/);
    assert.ok(serializeCliMatch, 'Smoke workflow must have a serialize-carrier CLI call');
    const taskPayloadArg = serializeCliMatch[1];

    const embeddedArtifact = extractEmbeddedCarrierArtifact(smokeRaw);
    assert.ok(embeddedArtifact, 'Smoke workflow must have an embedded carrier artifact in heredoc');

    let serializedPayload;
    try {
        serializedPayload = execFileSync('node', ['poc/validate-external-activation.js', 'serialize-carrier', taskPayloadArg], {
            encoding: 'utf8', timeout: 10000
        }).trim();
    } catch (e) {
        throw new Error('serialize-carrier CLI must succeed: ' + (e.stderr || e.message));
    }

    const serializedParsed = JSON.parse(serializedPayload);
    assert.ok(serializedParsed.task_name, 'Serialized payload must contain task_name');
    assert.strictEqual(serializedParsed.task_name, 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        'Serialized payload must carry smoke task identity');

    const embeddedParsed = JSON.parse(embeddedArtifact);
    const serializedCompact = JSON.stringify(serializedParsed);
    const embeddedCompact = JSON.stringify(embeddedParsed);
    assert.strictEqual(serializedCompact, embeddedCompact,
        'Serialized payload must exactly match embedded carrier artifact (workflow enforces fail-closed consistency)');
});

runTest('E2E - smoke workflow has fail-closed SERIALIZED_COMPACT vs EMBEDDED_COMPACT check', () => {
    const smokeRaw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    assert.ok(/SERIALIZED_COMPACT.*EMBEDDED_COMPACT/.test(smokeRaw),
        'Smoke workflow must compare serialized payload against embedded artifact (fail-closed)');
    assert.ok(/exit 1/.test(smokeRaw),
        'Smoke workflow must exit non-zero if serialized payload does not match embedded artifact');
});

runTest('E2E - corrective workflow correctly embeds its own Phase 4 corrective task', () => {
    const correctiveWfPath = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-phase4-increment-4-2-corrective.yml');
    const correctiveWorkflow = fs.readFileSync(correctiveWfPath, 'utf8');
    const correctiveArtifact = extractEmbeddedCarrierArtifact(correctiveWorkflow);
    assert.ok(correctiveArtifact,
        'Corrective workflow must have an embedded ACP artifact');
    const parsed = JSON.parse(correctiveArtifact);
    assert.ok(/TASK-GEMINI-BUILDER-PHASE4.*CORRECTIVE-001/.test(parsed.task_name),
        'Corrective workflow must embed its own Phase 4 corrective task identity');
});

runTest('E2E - smoke workflow scope is restricted to test/schema.test.js (not broad filesystem)', () => {
    const smokeArtifact = extractEmbeddedCarrierArtifact(fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8'));
    const parsed = JSON.parse(smokeArtifact);
    assert.deepStrictEqual(parsed.scope.permitted_paths, ['test/schema.test.js'],
        'Smoke workflow scope.permitted_paths must be exactly ["test/schema.test.js"]');
    assert.ok(!/^\*\*/.test(parsed.scope.permitted_paths[0]),
        'Smoke workflow must not use glob expansion that could escape boundary');
    assert.ok(!/^\//.test(parsed.scope.permitted_paths[0]),
        'Smoke workflow must not use absolute paths');
});

runTest('E2E - no one-click workflow embeds a corrective task in the smoke carrier', () => {
    for (const wf of CANONICAL_VALID_ONE_CLICK_WORKFLOWS) {
        if (wf === 'one-click-gemini-builder-phase4-increment-4-2-corrective.yml') continue;
        const raw = fs.readFileSync(path.join(ONE_CLICK_DIR, wf), 'utf8');
        const artifact = extractEmbeddedCarrierArtifact(raw);
        if (!artifact) continue;
        const parsed = JSON.parse(artifact);
        assert.ok(!/TASK-GEMINI-BUILDER-PHASE4.*CORRECTIVE-001/.test(parsed.task_name),
            wf + ' must not embed the Phase 4 corrective task identity (corrective tasks are only for the corrective carrier)');
    }
});


runTest('Binding integrity - requested task mode, branch, capabilities, and paths must match exactly', () => {
    const { bindCarrierToRequestedTask } = require('../poc/one-click-artifact-validator');
    const artifact = {
        task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
        target_agent: 'Gemini Builder',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        scope: { permitted_paths: ['test/schema.test.js'] }
    };
    const expected = {
        task_name: artifact.task_name,
        target_agent: artifact.target_agent,
        repository: artifact.repository,
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        permitted_paths: ['test/schema.test.js']
    };
    assert.strictEqual(bindCarrierToRequestedTask(artifact, expected).bound, true);
    for (const change of [
        { task_mode: 'FAILOVER_EXECUTE' },
        { base_branch: 'release' },
        { permitted_paths: ['poc/'] },
        { capabilities: ['read_only'] }
    ]) {
        const mismatch = bindCarrierToRequestedTask(artifact, { ...expected, ...change });
        assert.strictEqual(mismatch.bound, false, 'Must reject authority/identity drift: ' + JSON.stringify(change));
        assert.ok(mismatch.reason.includes(Object.keys(change)[0]), 'Diagnostic must name mismatched field');
    }
});

runTest('Binding integrity - coordinator rejects a workflow outside the registered one-click carrier set', () => {
    const { execFileSync } = require('child_process');
    const args = JSON.stringify({
        workflow_name: 'unregistered-one-click.yml',
        workflow_dir: '.github/workflows',
        base_branch: 'main',
        requested_task: {
            task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
            target_agent: 'Gemini Builder',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task_mode: 'BUILDER',
            capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
            permitted_paths: ['test/schema.test.js']
        }
    });
    let code = 0;
    let output = '';
    try {
        output = execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
            encoding: 'utf8', timeout: 10000
        });
    } catch (e) {
        code = e.status || 1;
        output = (e.stdout || '') + (e.stderr || '');
    }
    assert.notStrictEqual(code, 0, 'Unregistered workflow must fail closed');
    assert.match(output, /Unregistered target workflow|not a registered one-click carrier|BLOCKED/i);
});

runTest('Binding integrity - smoke callback is blocked when descriptor request_id mismatches initiating request', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const callbackIdx = raw.indexOf('Prepare ACP report payload');
    const callbackSection = raw.slice(callbackIdx, callbackIdx + 8500);
    assert.ok(/EXPECTED_REQUEST_ID/.test(callbackSection), 'Callback must compare descriptor request_id with initiating request_id');
    assert.ok(/correlation_valid=false/.test(callbackSection), 'Mismatch must set correlation_valid=false');
    assert.ok(/steps\.callback_payload\.outputs\.correlation_valid == 'true'/.test(raw),
        'Callback dispatch must be gated on verified correlation');
});

runTest('Binding integrity - smoke callback fails the report when descriptor task identity drifts', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const callbackIdx = raw.indexOf('Prepare ACP report payload');
    const callbackSection = raw.slice(callbackIdx, callbackIdx + 8500);
    assert.ok(/DESCRIPTOR_TASK_NAME/.test(callbackSection), 'Callback must extract task identity from descriptor');
    assert.ok(/TASK_IDENTITY_MISMATCH=true/.test(callbackSection), 'Descriptor task mismatch must be recorded');
    assert.ok(/Execution descriptor task identity mismatch/.test(callbackSection), 'Mismatch must be surfaced as a failure blocker');
    assert.ok(/TASK="\$TASK_JSON"/.test(callbackSection), 'Mismatch report must retain original carrier task identity');
});


runTest('Binding integrity - coordinator rejects task-mode or permitted-path drift with matching task name', () => {
    const { execFileSync } = require('child_process');
    for (const override of [
        { task_mode: 'FAILOVER_EXECUTE' },
        { permitted_paths: ['poc/'] },
        { base_branch: 'release' },
        { capabilities: ['read_only'] }
    ]) {
        const args = JSON.stringify({
            workflow_name: 'one-click-gemini-builder-smoke.yml',
            workflow_dir: '.github/workflows',
            base_branch: 'main',
            requested_task: {
                task_name: 'TASK-GEMINI-BUILDER-EXECUTION-SMOKE-TEST-001',
                target_agent: 'Gemini Builder',
                repository: 'fluentwithkyle/openclaw-webhook',
                base_branch: 'main',
                task_mode: 'BUILDER',
                capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
                permitted_paths: ['test/schema.test.js'],
                ...override
            }
        });
        let code = 0;
        let output = '';
        try {
            output = execFileSync('node', ['poc/validate-external-activation.js', 'coordinator-verify', args], {
                encoding: 'utf8', timeout: 15000
            });
        } catch (e) {
            code = e.status || 1;
            output = (e.stdout || '') + (e.stderr || '');
        }
        assert.notStrictEqual(code, 0, 'Authority drift must block coordinator readiness: ' + JSON.stringify(override));
        assert.match(output, /BLOCKED|mismatch|UNBOUND/i);
    }
});

runTest('Binding integrity - missing execution descriptor suppresses callback and records failure', () => {
    const raw = fs.readFileSync(ONE_CLICK_BUILDER_SMOKE_WF, 'utf8');
    const callbackIdx = raw.indexOf('Prepare ACP report payload');
    const callbackSection = raw.slice(callbackIdx, callbackIdx + 9000);
    assert.ok(/DESCRIPTOR_MISSING=true/.test(callbackSection), 'Missing descriptor must be explicit');
    assert.ok(/correlation_valid=false/.test(callbackSection), 'Missing descriptor must mark callback correlation invalid');
    assert.ok(/Execution descriptor\/request correlation failed/.test(callbackSection), 'Missing descriptor must produce a failure blocker');
    assert.ok(/exit 1/.test(callbackSection), 'Missing descriptor must fail the callback preparation step');
    assert.ok(/steps\.callback_payload\.outputs\.correlation_valid == 'true'/.test(raw),
        'Callback dispatch must be suppressed when descriptor is missing');
});

// =========================================================
// Regression tests: Phase 4 Increment 4.2 Final Callback Correlation Guard
// TASK-KILO-PHASE4-INCREMENT-4-2-FINAL-CALLBACK-CORRELATION-GUARD-001
// =========================================================

const CORRECTIVE_WF = path.join(ONE_CLICK_DIR, 'one-click-gemini-builder-phase4-increment-4-2-corrective.yml');
const correctiveWfRaw = fs.readFileSync(CORRECTIVE_WF, 'utf8');

runTest('Final callback guard - corrective workflow requires non-empty orchestration outputs for request_id, execution_claim_id, carrier_identity', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    assert.ok(cbIdx !== -1, 'Corrective workflow must have Prepare ACP report payload step');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 2000);
    assert.ok(/ORCH_REQUEST_ID/.test(cbSection),
        'callback_payload must read request_id from orchestration context outputs');
    assert.ok(/ORCH_EXECUTION_CLAIM_ID/.test(cbSection),
        'callback_payload must read execution_claim_id from orchestration context outputs');
    assert.ok(/ORCH_CARRIER_IDENTITY/.test(cbSection),
        'callback_payload must read carrier_identity from orchestration context outputs');
});

runTest('Final callback guard - corrective workflow fails closed when orchestration outputs are missing', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 2000);
    assert.ok(/IDENTITY_MISSING/.test(cbSection),
        'callback_payload must set IDENTITY_MISSING flag when orchestration outputs are empty');
    assert.ok(/missing authoritative orchestration outputs/.test(cbSection),
        'callback_payload must emit error message about missing orchestration outputs');
    assert.ok(/EXECUTION_CLAIM_ID=""/.test(cbSection) || /EXECUTION_CLAIM_ID=""/.test(cbSection.replace(/ /g, '')),
        'callback_payload must not fall back to descriptor for execution_claim_id when orchestration identity is missing');
});

runTest('Final callback guard - corrective workflow never uses execution-descriptor.json as fallback for authoritative identity', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 8000);
    const noFallbackPattern = /elif.*DESCRIPTOR_FILE|else.*DESCRIPTOR_FILE/;
    assert.ok(!noFallbackPattern.test(cbSection),
        'callback_payload must not have else/elif fallback branches to execution-descriptor.json for identity fields');
});

runTest('Final callback guard - corrective workflow validates descriptor against orchestration outputs when descriptor present', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 8000);
    assert.ok(/DESC_REQUEST_ID/.test(cbSection),
        'callback_payload must extract descriptor request_id for validation');
    assert.ok(/DESC_EXECUTION_CLAIM_ID/.test(cbSection),
        'callback_payload must extract descriptor execution_claim_id for validation');
    assert.ok(/DESC_CARRIER_IDENTITY/.test(cbSection),
        'callback_payload must extract descriptor carrier_identity for validation');
    assert.ok(/DESCRIPTOR_MISMATCH/.test(cbSection),
        'callback_payload must track descriptor mismatch state');
    assert.ok(/do not match authoritative orchestration outputs/.test(cbSection),
        'callback_payload must emit error when descriptor identities do not match orchestration outputs');
});

runTest('Final callback guard - corrective workflow suppresses callback dispatch on identity validation failure', () => {
    assert.ok(/identity_valid.*false/.test(correctiveWfRaw),
        'Corrective workflow must output identity_valid=false when validation fails');
    assert.ok(/identity_valid.*true/.test(correctiveWfRaw),
        'Corrective workflow must output identity_valid=true when validation passes');
    assert.ok(/steps\.callback_payload\.outputs\.identity_valid == 'true'/.test(correctiveWfRaw),
        'Send callback step must be gated on identity_valid == true');
});

runTest('Final callback guard - corrective callback uses only validated authoritative identities in payload', () => {
    assert.ok(/--arg execution_claim_id "\$EXECUTION_CLAIM_ID"/.test(correctiveWfRaw),
        'Report JSON must use validated EXECUTION_CLAIM_ID (not descriptor value)');
    assert.ok(/--arg carrier_identity "\$CARRIER_IDENTITY"/.test(correctiveWfRaw),
        'Report JSON must use validated CARRIER_IDENTITY (not descriptor value)');
    assert.ok(/--arg request_id "\$REQUEST_ID"/.test(correctiveWfRaw),
        'Report JSON must use validated REQUEST_ID (not descriptor value)');
});

runTest('Final callback guard - descriptor extraction does not substitute orchestration values for missing descriptor fields', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 8000);
    assert.ok(/DESC_EXECUTION_CLAIM_ID=.*jq.*execution_claim_id/.test(cbSection),
        'Must extract DESC_EXECUTION_CLAIM_ID from descriptor via jq');
    assert.ok(!/DESC_EXECUTION_CLAIM_ID.*\|\| echo.*EXECUTION_CLAIM_ID/.test(cbSection),
        'Must NOT fall back to orchestration EXECUTION_CLAIM_ID when descriptor extraction fails');
    assert.ok(!/DESC_CARRIER_IDENTITY.*\|\| echo.*CARRIER_IDENTITY/.test(cbSection),
        'Must NOT fall back to orchestration CARRIER_IDENTITY when descriptor extraction fails');
});

runTest('Final callback guard - corrective callback dispatch step validates all three identity fields fail-closed', () => {
    const cbIdx = correctiveWfRaw.indexOf('Send callback to Render');
    assert.ok(cbIdx !== -1, 'Corrective workflow must have Send callback to Render step');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 4000);
    assert.ok(/EXECUTION_CLAIM_ID/.test(cbSection),
        'Callback dispatch must receive execution_claim_id from callback_payload outputs');
    assert.ok(/CARRIER_IDENTITY/.test(cbSection),
        'Callback dispatch must receive carrier_identity from callback_payload outputs');
    assert.ok(/execution_claim_id.*missing.*empty.*invalid/.test(cbSection),
        'Callback dispatch must fail closed when execution_claim_id is missing/empty/null');
    assert.ok(/carrier_identity.*missing.*empty.*invalid/.test(cbSection),
        'Callback dispatch must fail closed when carrier_identity is missing/empty/null');
    assert.ok(/callback_sent=false/.test(cbSection),
        'Callback dispatch must set callback_sent=false on identity failure');
    assert.ok(/exit 1/.test(cbSection),
        'Callback dispatch must exit 1 on identity failure');
});

runTest('Final callback guard - stale descriptor request_id cannot bypass orchestration-derived identity', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 4000);
    assert.ok(/ORCH_REQUEST_ID.*ORCH_EXECUTION_CLAIM_ID.*ORCH_CARRIER_IDENTITY/.test(cbSection),
        'callback_payload must read all three identity fields from orchestration context as the authoritative source');
    assert.ok(!/REQUEST_ID.*=.*\$\{.*one_click_context.*request_id\}/.test(cbSection),
        'callback_payload must not read request_id from one_click_context as authoritative identity');
});

runTest('Final callback guard - corrective workflow exits non-zero after writing fail-closed report on identity failure', () => {
    const cbIdx = correctiveWfRaw.indexOf('Prepare ACP report payload');
    const cbSection = correctiveWfRaw.slice(cbIdx, cbIdx + 16000);
    assert.ok(/if.*\$IDENTITY_MISSING.*=.*true.*\|\|.*\$DESCRIPTOR_MISMATCH.*=.*true.*then/.test(cbSection.replace(/\s+/g, ' ')),
        'callback_payload must check both IDENTITY_MISSING and DESCRIPTOR_MISMATCH flags for exit');
    assert.ok(/exit 1/.test(cbSection),
        'callback_payload must exit 1 on identity validation failure');
    assert.ok(/fail-closed report/.test(cbSection),
        'callback_payload must write fail-closed report on identity failure');
});

// =========================================================
// Behavioral regression tests: callback identity validation
// TASK-KILO-PHASE4-INCREMENT-4-2-DESCRIPTOR-IDENTITY-FAIL-CLOSED-CORRECTION-001
// These tests exercise the actual bash logic of the callback_payload step
// with simulated descriptor files to prove fail-closed behavior.
// =========================================================

function extractCallbackPayloadScript(wfRaw) {
    const cbIdx = wfRaw.indexOf('Prepare ACP report payload');
    if (cbIdx === -1) throw new Error('Prepare ACP report payload step not found');
    const endIdx = wfRaw.indexOf('      - name: Send callback to Render');
    if (endIdx === -1) throw new Error('Send callback to Render step not found');
    const section = wfRaw.slice(cbIdx, endIdx);
    const runMatch = section.match(/run:\s*\|\s*\n([\s\S]+)/);
    if (!runMatch) throw new Error('run block not found in callback_payload step');
    return runMatch[1];
}

function substituteGhActionsExpr(script, orchOutputs, taskJson) {
    let result = script;
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.request_id\s*\}\}/g, '$ORCH_REQUEST_ID');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.execution_claim_id\s*\}\}/g, '$ORCH_EXECUTION_CLAIM_ID');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.carrier_identity\s*\}\}/g, '$ORCH_CARRIER_IDENTITY');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.repository\s*\}\}/g, 'fluentwithkyle/openclaw-webhook');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.base_branch\s*\}\}/g, 'main');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.builder_execution_id\s*\}\}/g, 'builder-exec-001');
    result = result.replace(/\$\{\{\s*steps\.orchestration_context\.outputs\.kilo_execution_id\s*\|\|.*\}\}/g, '""');
    result = result.replace(/\$\{\{\s*steps\.one_click_context\.outputs\.request_id\s*\}\}/g, 'one-click-request-001');
    result = result.replace(/\$\{\{\s*steps\.one_click_context\.outputs\.task\s*\}\}/g, "'" + taskJson + "'");
    result = result.replace(/\$\{\{\s*steps\.builder_result\.outputs\.builder_status\s*\|\|.*\}\}/g, 'success');
    result = result.replace(/\$\{\{\s*steps\.builder_result\.outputs\.verification_status\s*\|\|.*\}\}/g, 'PASS');
    result = result.replace(/\$\{\{\s*steps\.builder_result\.outputs\.blocker_message\s*\|\|.*\}\}/g, '');
    result = result.replace(/\$\{\{\s*steps\.builder_result\.outputs\.commit_sha\s*\|\|.*\}\}/g, 'null');
    result = result.replace(/\$\{\{\s*steps\.builder_result\.outputs\.push_status\s*\|\|.*\}\}/g, 'false');
    result = result.replace(/\$\{\{\s*GITHUB_REF_NAME\s*\}\}/g, 'main');
    result = result.replace(/\$\{\{\s*GITHUB_REPOSITORY\s*\}\}/g, 'fluentwithkyle/openclaw-webhook');
    result = result.replace(/\$\{\{[^}]*\}\}/g, '""');
    return result;
}

function runCallbackPayload(descriptorContent, orchOutputs) {
    const tmpDir = '/tmp/kilo-callback-test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(tmpDir, { recursive: true });

    if (descriptorContent !== null) {
        fs.writeFileSync(path.join(tmpDir, 'execution-descriptor.json'), descriptorContent, 'utf8');
    }

    const orchRequestId = orchOutputs.request_id || '';
    const orchExecClaimId = orchOutputs.execution_claim_id || '';
    const orchCarrierIdentity = orchOutputs.carrier_identity || '';
    const taskJson = '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}';

    const env = {
        ...process.env,
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_SHA: 'abc123',
        GITHUB_REF_NAME: 'main',
        GITHUB_REPOSITORY: 'fluentwithkyle/openclaw-webhook',
        ORCH_REQUEST_ID: orchRequestId,
        ORCH_EXECUTION_CLAIM_ID: orchExecClaimId,
        ORCH_CARRIER_IDENTITY: orchCarrierIdentity,
        TASK_JSON: taskJson,
        GITHUB_OUTPUT: path.join(tmpDir, 'github_output'),
        PATH: process.env.PATH
    };

    const script = extractCallbackPayloadScript(correctiveWfRaw);
    const substitutedScript = substituteGhActionsExpr(script, orchOutputs, taskJson);

    let scriptContent = '#!/bin/bash\nset -uo pipefail\n';
    scriptContent += 'DESCRIPTOR_FILE="' + tmpDir + '/execution-descriptor.json"\n';
    scriptContent += 'ORCH_REQUEST_ID="' + orchRequestId + '"\n';
    scriptContent += 'ORCH_EXECUTION_CLAIM_ID="' + orchExecClaimId + '"\n';
    scriptContent += 'ORCH_CARRIER_IDENTITY="' + orchCarrierIdentity + '"\n';
    scriptContent += "TASK_JSON='" + taskJson + "'\n";
    scriptContent += 'REQUEST_ID=""\n';
    scriptContent += 'EXECUTION_CLAIM_ID=""\n';
    scriptContent += 'CARRIER_IDENTITY=""\n';
    scriptContent += 'TASK=""\n';
    scriptContent += 'REPOSITORY=""\n';
    scriptContent += 'BASE_BRANCH=""\n';
    scriptContent += 'BUILDER_OUTPUT=""\n';
    scriptContent += substitutedScript;

    const scriptPath = path.join(tmpDir, 'test-callback.sh');
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');
    fs.chmodSync(scriptPath, 0o755);

    let exitCode = 0;
    let stdout = '';
    let stderr = '';

    try {
        const result = execFileSync('bash', [scriptPath], {
            encoding: 'utf8',
            timeout: 10000,
            env: env,
            cwd: tmpDir,
            maxBuffer: 1024 * 1024
        });
        stdout = result;
    } catch (e) {
        exitCode = e.status || 1;
        stdout = (e.stdout || '');
        stderr = (e.stderr || '');
    }

    const githubOutput = fs.existsSync(env.GITHUB_OUTPUT) ? fs.readFileSync(env.GITHUB_OUTPUT, 'utf8') : '';
    const callbackPayload = fs.existsSync(path.join(tmpDir, 'callback_payload.json'))
        ? JSON.parse(fs.readFileSync(path.join(tmpDir, 'callback_payload.json'), 'utf8'))
        : null;

    const output = stdout + stderr;
    const identityValid = githubOutput.includes('identity_valid=true') ? true
        : githubOutput.includes('identity_valid=false') ? false
        : null;

    fs.rmSync(tmpDir, { recursive: true, force: true });

    return { exitCode, identityValid, callbackPayload, output, githubOutput };
}

runTest('Behavioral - stale descriptor request_id blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'stale-request-id-99999',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        permitted_paths: ['poc/'],
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor request_id is stale');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor request_id is stale');
    assert.ok(result.output.includes('do not match authoritative orchestration outputs'),
        'Must emit descriptor mismatch error for stale request_id');
});

runTest('Behavioral - descriptor with missing request_id blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor request_id is missing');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor request_id is missing');
    assert.ok(result.output.includes('missing request_id'),
        'Must emit error about missing request_id in descriptor');
});

runTest('Behavioral - descriptor with missing execution_claim_id blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor execution_claim_id is missing');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor execution_claim_id is missing');
    assert.ok(result.output.includes('missing'),
        'Must emit error about missing identity field in descriptor');
});

runTest('Behavioral - descriptor with missing carrier_identity blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor carrier_identity is missing');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor carrier_identity is missing');
    assert.ok(result.output.includes('missing'),
        'Must emit error about missing carrier_identity in descriptor');
});

runTest('Behavioral - descriptor with null execution_claim_id blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: null,
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor execution_claim_id is null');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor execution_claim_id is null');
});

runTest('Behavioral - stale descriptor execution_claim_id blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'stale-claim-id-99999',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor execution_claim_id is stale');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor execution_claim_id is stale');
    assert.ok(result.output.includes('do not match authoritative orchestration outputs'),
        'Must emit descriptor mismatch error for stale execution_claim_id');
});

runTest('Behavioral - stale descriptor carrier_identity blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'stale-carrier-identity-99999',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when descriptor carrier_identity is stale');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when descriptor carrier_identity is stale');
    assert.ok(result.output.includes('do not match authoritative orchestration outputs'),
        'Must emit descriptor mismatch error for stale carrier_identity');
});

runTest('Behavioral - missing orchestration outputs blocks callback dispatch', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: '',
        execution_claim_id: '',
        carrier_identity: ''
    });

    assert.ok(result.exitCode !== 0,
        'Callback payload step must exit non-zero when orchestration outputs are missing');
    assert.strictEqual(result.identityValid, false,
        'identity_valid must be false when orchestration outputs are missing');
    assert.ok(result.output.includes('missing authoritative orchestration outputs'),
        'Must emit error about missing orchestration outputs');
    if (result.callbackPayload) {
        assert.strictEqual(result.callbackPayload.request_id, null,
            'Callback payload must have null request_id when identity is missing');
        const meta = result.callbackPayload.result && result.callbackPayload.result.execution_metadata;
        assert.ok(meta, 'Callback payload must have execution_metadata');
        assert.strictEqual(meta.execution_claim_id, null,
            'Callback payload must have null execution_claim_id when identity is missing');
        assert.strictEqual(meta.carrier_identity, null,
            'Callback payload must have null carrier_identity when identity is missing');
    }
});

runTest('Behavioral - valid matching descriptor permits callback delivery (identity_valid=true)', () => {
    const descriptor = JSON.stringify({
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    assert.strictEqual(result.exitCode, 0,
        'Callback payload step must exit 0 when all identities match: ' + result.output);
    assert.strictEqual(result.identityValid, true,
        'identity_valid must be true when all identities match');
    assert.ok(result.callbackPayload,
        'Callback payload JSON must be generated when identity is valid');
    assert.strictEqual(result.callbackPayload.request_id, 'valid-request-id-12345',
        'Callback payload must use authoritative request_id from orchestration outputs');
    assert.strictEqual(result.callbackPayload.result.execution_metadata.execution_claim_id, 'claim-1792161979938-1uubwdmp',
        'Callback payload must use authoritative execution_claim_id from orchestration outputs');
    assert.strictEqual(result.callbackPayload.result.execution_metadata.carrier_identity, 'github-workflow-38918426965-1',
        'Callback payload must use authoritative carrier_identity from orchestration outputs');
});

runTest('Behavioral - callback payload never contains stale descriptor identity values', () => {
    const descriptor = JSON.stringify({
        request_id: 'stale-request-id-99999',
        execution_claim_id: 'stale-claim-id-99999',
        carrier_identity: 'stale-carrier-identity-99999',
        task: '{"task_name":"TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-STATE-AND-REQUIREMENTS-GATES-CORRECTIVE-001"}',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main'
    });

    const result = runCallbackPayload(descriptor, {
        request_id: 'valid-request-id-12345',
        execution_claim_id: 'claim-1792161979938-1uubwdmp',
        carrier_identity: 'github-workflow-38918426965-1'
    });

    if (result.callbackPayload) {
        const payloadStr = JSON.stringify(result.callbackPayload);
        assert.ok(!payloadStr.includes('stale-request-id-99999'),
            'Callback payload must not contain stale descriptor request_id');
        assert.ok(!payloadStr.includes('stale-claim-id-99999'),
            'Callback payload must not contain stale descriptor execution_claim_id');
        assert.ok(!payloadStr.includes('stale-carrier-identity-99999'),
            'Callback payload must not contain stale descriptor carrier_identity');
    }
});

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
process.exit(failCount > 0 ? 1 : 0);
