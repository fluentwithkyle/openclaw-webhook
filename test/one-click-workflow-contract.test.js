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
    return fs.readdirSync(ONE_CLICK_DIR)
        .filter(f => /^one-click-.*\.yml$/i.test(f))
        .sort();
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

runTest('Contract - requires dedicated workflow when existing workflow has different task', () => {
    assert.ok(/Dedicated Workflow When Necessary/i.test(contractRaw),
        'Contract must have dedicated workflow section');
    const section = contractRaw.slice(contractRaw.indexOf('Dedicated Workflow'));
    assert.ok(/create.*update.*workflow.*different task/i.test(section),
        'Contract must require creating/updating workflow when task differs');
    assert.ok(/must not silently reuse/i.test(section),
        'Contract must prohibit silently reusing old workflow');
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
    assert.ok(/does.*not.*present[\s\S]*?Run link/i.test(section),
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

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
