const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const MAIN_WF_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'main.yml');
const README_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'README.md');
const PROTOCOL_PATH = path.join(ROOT_DIR, 'docs', 'ai', 'CHATGPT_PROJECT_OPERATING_PROTOCOL.md');

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

const mainWfRaw = fs.readFileSync(MAIN_WF_PATH, 'utf8');
const readmeRaw = fs.readFileSync(README_PATH, 'utf8');
const protocolRaw = fs.readFileSync(PROTOCOL_PATH, 'utf8');

// =========================================================
// Helper: locate the "Report artifact filing status" step
// =========================================================
function extractFilingStatusStep(raw) {
    const marker = 'Report artifact filing status';
    const idx = raw.indexOf(marker);
    if (idx === -1) return null;
    const before = raw.slice(0, idx).lastIndexOf('- name:');
    if (before === -1) return null;
    const stepSection = raw.slice(before);
    const nextStep = stepSection.indexOf('\n      - name:', 30);
    if (nextStep === -1) return stepSection;
    return stepSection.slice(0, nextStep);
}

const filingStep = extractFilingStatusStep(mainWfRaw);

// =========================================================
// 1. Required filing fields present in the workflow
// =========================================================

runTest('Workflow - Report artifact filing status step exists', () => {
    assert.ok(mainWfRaw.includes('Report artifact filing status'),
        'main.yml must contain a "Report artifact filing status" step');
});

runTest('Workflow - filing step is gated with if: always()', () => {
    assert.ok(filingStep, 'filing step section could not be extracted');
    assert.ok(/if:\s*always\(\)/.test(filingStep),
        'filing step must use if: always()');
});

runTest('Workflow - filing step exposes filing_status output', () => {
    assert.ok(mainWfRaw.includes('filing_status='),
        'workflow must expose filing_status as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes artifact_name output', () => {
    assert.ok(mainWfRaw.includes('artifact_name='),
        'workflow must expose artifact_name as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes artifact_file output', () => {
    assert.ok(mainWfRaw.includes('artifact_file='),
        'workflow must expose artifact_file as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes workflow_run_id output', () => {
    assert.ok(mainWfRaw.includes('workflow_run_id='),
        'workflow must expose workflow_run_id as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes workflow_run_url output', () => {
    assert.ok(mainWfRaw.includes('workflow_run_url='),
        'workflow must expose workflow_run_url as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes artifact_download_url output', () => {
    assert.ok(mainWfRaw.includes('artifact_download_url='),
        'workflow must expose artifact_download_url as a GITHUB_OUTPUT');
});

// =========================================================
// 2. Canonical artifact name and payload
// =========================================================

runTest('Workflow - canonical artifact name is gemini-acp-report', () => {
    assert.ok(mainWfRaw.includes('name: gemini-acp-report'),
        'artifact upload step must use name: gemini-acp-report');
});

runTest('Workflow - canonical payload file is gemini-acp-report.json', () => {
    assert.ok(mainWfRaw.includes('gemini-acp-report.json'),
        'workflow must reference gemini-acp-report.json as the payload file');
});

runTest('Workflow - artifact upload uses actions/upload-artifact@v4', () => {
    assert.ok(/uses:\s*actions\/upload-artifact@v4/.test(mainWfRaw),
        'artifact upload must use actions/upload-artifact@v4');
});

runTest('Workflow - upload step has if: always()', () => {
    assert.ok(/name:\s*Upload Gemini result artifact[\s\S]*?if:\s*always\(\)/.test(mainWfRaw),
        'Upload step must use if: always()');
});

// =========================================================
// 3. Successful / failed / indeterminate filing semantics
// =========================================================

runTest('Workflow - filing step maps success outcome to SUCCESS', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/success\)\s*\n\s*STATUS="SUCCESS"/i.test(filingStep),
        'upload success outcome must map to filing_status=SUCCESS');
});

runTest('Workflow - filing step maps failure outcome to FAILED', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/failure\)\s*\n\s*STATUS="FAILED"/i.test(filingStep),
        'upload failure outcome must map to filing_status=FAILED');
});

runTest('Workflow - filing step maps indeterminate outcome to UNKNOWN', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/\*\)\s*\n\s*STATUS="UNKNOWN"/i.test(filingStep),
        'indeterminate upload outcome must map to filing_status=UNKNOWN');
});

runTest('Workflow - filing step does not hardcode STATUS=success unconditionally', () => {
    assert.ok(filingStep, 'filing step not found');
    const caseMatch = filingStep.match(/case\s+"\$UPLOAD_OUTCOME"/);
    assert.ok(caseMatch, 'filing step must use a case statement over UPLOAD_OUTCOME (not hardcoded success)');
});

// =========================================================
// 4. Workflow run identification fields populated from GitHub context
// =========================================================

runTest('Workflow - workflow_run_id uses GITHUB_RUN_ID', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/WORKFLOW_RUN_ID="\$\{GITHUB_RUN_ID\}"/i.test(filingStep),
        'workflow_run_id must be derived from GITHUB_RUN_ID');
});

runTest('Workflow - workflow_run_url uses GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/WORKFLOW_RUN_URL="\$\{GITHUB_SERVER_URL\}\/\$\{GITHUB_REPOSITORY\}\/actions\/runs\/\$\{GITHUB_RUN_ID\}"/i.test(filingStep),
        'workflow_run_url must construct from GitHub context (no secrets)');
});

runTest('Workflow - artifact_name is set to gemini-acp-report', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/ARTIFACT_NAME="gemini-acp-report"/i.test(filingStep),
        'ARTIFACT_NAME must be gemini-acp-report');
});

runTest('Workflow - artifact_file is set to gemini-acp-report.json', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/ARTIFACT_FILE="gemini-acp-report\.json"/i.test(filingStep),
        'ARTIFACT_FILE must be gemini-acp-report.json');
});

// =========================================================
// 5. Do NOT regress: filing_status alone without retrieval fields
// =========================================================

runTest('Workflow - does NOT regress to filing_status-only (no retrieval-location fields)', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(filingStep.includes('artifact_name='),
        'Regression guard: artifact_name output must exist (not filing_status-only)');
    assert.ok(filingStep.includes('artifact_file='),
        'Regression guard: artifact_file output must exist (not filing_status-only)');
    assert.ok(filingStep.includes('workflow_run_id='),
        'Regression guard: workflow_run_id output must exist (not filing_status-only)');
    assert.ok(filingStep.includes('workflow_run_url='),
        'Regression guard: workflow_run_url output must exist (not filing_status-only)');
});

runTest('Workflow - filing step emits a structured retrieval-location table in GITHUB_STEP_SUMMARY', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/Durable Retrieval Location/i.test(filingStep),
        'filing step must include a Durable Retrieval Location section in step summary');
    assert.ok(filingStep.includes('filing_status |'),
        'filing step summary table must include filing_status column');
    assert.ok(filingStep.includes('artifact_name |'),
        'filing step summary table must include artifact_name column');
    assert.ok(filingStep.includes('artifact_file |'),
        'filing step summary table must include artifact_file column');
    assert.ok(filingStep.includes('workflow_run_id |'),
        'filing step summary table must include workflow_run_id column');
    assert.ok(filingStep.includes('workflow_run_url |'),
        'filing step summary table must include workflow_run_url column');
});

runTest('Workflow - filing step warns that filing_status SUCCESS is not a retrieval location', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/filing_status: SUCCESS.*is.*not.*a retrieval location/i.test(filingStep),
        'filing step must explicitly warn that filing_status SUCCESS alone is not a retrieval location');
    assert.ok(/On failed or indeterminate.*FAILED.*UNKNOWN|failed or indeterminate artifact filing/i.test(filingStep),
        'filing step must warn about failed or indeterminate filing (FAILED or UNKNOWN)');
});

// =========================================================
// 6. Protocol retrieval instructions (docs/ai/README.md)
// =========================================================

runTest('Protocol - README documents machine-readable filing fields table', () => {
    assert.ok(/filing_status.*artifact_name.*artifact_file.*workflow_run_id.*workflow_run_url/i.test(readmeRaw),
        'README must document all machine-readable filing fields');
});

runTest('Protocol - README states filing_status SUCCESS is not a retrieval location', () => {
    assert.ok(/filing_status.*SUCCESS.*is.*not.*a retrieval location|not.*evidence.*report.*inspected/i.test(readmeRaw),
        'README must state filing_status SUCCESS alone is not a retrieval location');
});

runTest('Protocol - README explicitly states filing_status SUCCESS alone is not evidence of inspection', () => {
    assert.ok(/filing_status.*SUCCESS.*alone.*is.*not.*a retrieval location/i.test(readmeRaw),
        'README must state filing_status SUCCESS alone is not a retrieval location');
});

runTest('Protocol - README provides deterministic retrieval procedure with ordered steps', () => {
    assert.ok(/To retrieve the canonical Gemini report deterministically, an agent MUST follow this exact procedure/i.test(readmeRaw),
        'README must state the retrieval procedure as an exact procedure');
    assert.ok(/Inspect the filing status/i.test(readmeRaw),
        'README retrieval procedure must reference inspecting filing status');
    assert.ok(/Identify the workflow run|workflow_run_id|workflow_run_url/i.test(readmeRaw),
        'README retrieval procedure must reference identifying the workflow run');
    assert.ok(/Locate the artifact/i.test(readmeRaw),
        'README retrieval procedure must reference locating the artifact');
    assert.ok(/Download the artifact/i.test(readmeRaw),
        'README retrieval procedure must reference downloading the artifact');
    assert.ok(/Extract.*gemini-acp-report\.json|gemini-acp-report\.json.*artifact_file/i.test(readmeRaw),
        'README retrieval procedure must reference extracting gemini-acp-report.json');
});

runTest('Protocol - README distinguishes canonical report from durable research record', () => {
    assert.ok(/Canonical Report vs.*Durable Research Record|canonical.*report.*distinct from.*durable.*research/i.test(readmeRaw),
        'README must distinguish canonical report from durable research record');
});

runTest('Protocol - README states canonical report must reference durable research-record path', () => {
    assert.ok(/canonical report must contain or expose the durable research-record path|navigate from the canonical Gemini report to the underlying persistent research/i.test(readmeRaw),
        'README must state the canonical report must reference the durable research-record path');
});

runTest('Protocol - README defines retrieval chain with artifact_name and artifact_file fields', () => {
    assert.ok(/artifact_name.*field|artifact_file.*field/i.test(readmeRaw),
        'README must reference artifact_name and artifact_file as fields');
});

runTest('Protocol - README states filing failure (FAILED/UNKNOWN) must report NOT YET VERIFIED', () => {
    assert.ok(/filing_status.*FAILED|filing_status.*UNKNOWN|NOT YET VERIFIED/i.test(readmeRaw),
        'README must state FAILED/UNKNOWN filing status results in NOT YET VERIFIED');
});

// =========================================================
// 7. CHATGPT_PROJECT_OPERATING_PROTOCOL.md Section 5 deterministic retrieval
// =========================================================

runTest('Protocol - Section 5 references machine-readable filing fields', () => {
    assert.ok(/machine-readable filing fields/i.test(protocolRaw),
        'Protocol Section 5 must reference machine-readable filing fields');
});

runTest('Protocol - Section 5 lists filing_status, artifact_name, artifact_file, workflow_run_id, workflow_run_url', () => {
    const section5 = protocolRaw.slice(protocolRaw.indexOf('### 5.1 Gemini Result Artifact Retrieval Rule'));
    assert.ok(section5.includes('filing_status'), 'Protocol must reference filing_status');
    assert.ok(section5.includes('artifact_name'), 'Protocol must reference artifact_name');
    assert.ok(section5.includes('artifact_file'), 'Protocol must reference artifact_file');
    assert.ok(section5.includes('workflow_run_id'), 'Protocol must reference workflow_run_id');
    assert.ok(section5.includes('workflow_run_url'), 'Protocol must reference workflow_run_url');
});

runTest('Protocol - Section 5 explicitly states filing_status SUCCESS alone is not a retrieval location', () => {
    const section5 = protocolRaw.slice(protocolRaw.indexOf('### 5.1 Gemini Result Artifact Retrieval Rule'));
    assert.ok(/filing_status.*SUCCESS.*is.*not.*a retrieval location|not.*evidence.*report.*inspected/i.test(section5),
        'Protocol Section 5 must state filing_status SUCCESS alone is not a retrieval location');
});

runTest('Protocol - Section 5.1.1 includes deterministic retrieval procedure with ordered steps', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 5.1.1 Gemini Report Discovery Procedure'));
    assert.ok(/procedure MUST be performed in this sequence/i.test(section) ||
              /MUST be performed in this sequence/i.test(section),
        'Protocol Section 5.1.1 must state the retrieval procedure must be performed in sequence');
    assert.ok(/Inspect the filing status/i.test(section),
        'Protocol Section 5.1.1 must include inspecting filing status as step 1');
    assert.ok(/Identify the exact/i.test(section),
        'Protocol Section 5.1.1 must include identifying the workflow run');
    assert.ok(/Locate the artifact/i.test(section),
        'Protocol Section 5.1.1 must include locating the artifact');
    assert.ok(/Download the artifact/i.test(section),
        'Protocol Section 5.1.1 must include downloading the artifact');
    assert.ok(/Extract.*gemini-acp-report\.json|gemini-acp-report\.json.*artifact_file/i.test(section),
        'Protocol Section 5.1.1 must include extracting gemini-acp-report.json');
});

runTest('Protocol - Section 5.1.1 prohibits asking Kyle to provide result before retrieval attempted', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 5.1.1 Gemini Report Discovery Procedure'));
    assert.ok(/MUST NOT ask Kyle where Gemini stored the result|MUST NOT ask Kyle to copy\/paste/i.test(section),
        'Protocol Section 5.1.1 must prohibit asking Kyle before exhausting retrieval');
});

runTest('Protocol - Section 5.1.1 distinguishes canonical report from durable research record', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 5.1.1 Gemini Report Discovery Procedure'));
    assert.ok(/Navigate to the durable research record|durable research record.*RESEARCH_DOCUMENT/i.test(section),
        'Protocol Section 5.1.1 must reference navigating to the durable research record');
});

runTest('Protocol - Section 5.1.1 lists filing_status as first inspection step', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 5.1.1 Gemini Report Discovery Procedure'));
    const inspectFilingIdx = section.indexOf('Inspect the filing status');
    const identifyIdx = section.indexOf('Identify the exact');
    assert.ok(inspectFilingIdx !== -1 && identifyIdx !== -1 && inspectFilingIdx < identifyIdx,
        'Protocol Section 5.1.1 must inspect filing status before identifying the workflow run');
});

// =========================================================
// 8. Prohibited substitutes explicitly enumerated
// =========================================================

runTest('Protocol - Section 5 lists filing_status SUCCESS as prohibited substitute', () => {
    const section5 = protocolRaw.slice(protocolRaw.indexOf('### 5.1 Gemini Result Artifact Retrieval Rule'));
    assert.ok(/filing_status.*SUCCESS.*not a retrieval location/i.test(section5),
        'Protocol must list filing_status SUCCESS alone as a prohibited substitute');
});

// =========================================================
// 9. Summary
// =========================================================

console.log(`\n--- Summary: ${passCount} passed, ${failCount} failed ---`);
if (failCount > 0) {
    console.error(`FAIL: ${failCount} test(s) failed in gemini-acp-report-discovery-contract.test.js`);
    process.exit(1);
}
console.log('All tests in gemini-acp-report-discovery-contract.test.js passed.');
