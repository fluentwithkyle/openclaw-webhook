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

const contractRaw = fs.readFileSync(CONTRACT_DOC_PATH, 'utf8');
const startHereRaw = fs.readFileSync(CHATGPT_START_HERE_PATH, 'utf8');
const protocolRaw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
const readmeRaw = fs.readFileSync(README_PATH, 'utf8');
const externalActRaw = fs.readFileSync(EXTERNAL_ACT_PROCEDURE_PATH, 'utf8');
const archDecisionsRaw = fs.readFileSync(ARCH_DECISIONS_PATH, 'utf8');
const mainWfRaw = fs.readFileSync(MAIN_WF_PATH, 'utf8');
const builderWfRaw = fs.readFileSync(BUILDER_WF_PATH, 'utf8');
const taskLogRaw = fs.readFileSync(TASK_LOG_PATH, 'utf8');

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
    const invariantsSection = contractRaw.slice(contractRaw.indexOf('## 10. Summary'));
    assert.ok(/zero/i.test(invariantsSection) && /input/i.test(invariantsSection),
        'Invariants section must include zero-input constraint');
    assert.ok(invariantsSection.includes('TaskRegistry'),
        'Invariants section must include TaskRegistry reuse');
    assert.ok(/control plane/i.test(invariantsSection),
        'Invariants section must include no-second-control-plane');
});

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
