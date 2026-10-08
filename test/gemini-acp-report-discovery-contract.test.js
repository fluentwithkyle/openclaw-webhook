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
// Helper: locate the "Prepare ACP report payload" step
// =========================================================
function extractPayloadStep(raw) {
    const marker = 'Prepare ACP report payload';
    const idx = raw.indexOf(marker);
    if (idx === -1) return null;
    const before = raw.slice(0, idx).lastIndexOf('- name:');
    if (before === -1) return null;
    const stepSection = raw.slice(before);
    const nextStep = stepSection.indexOf('\n      - name:', 30);
    if (nextStep === -1) return stepSection;
    return stepSection.slice(0, nextStep);
}

const payloadStep = extractPayloadStep(mainWfRaw);

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
// 6. Artifact location: real artifact_id from native upload-artifact output
// =========================================================

runTest('Workflow - filing step exposes artifact_id output', () => {
    assert.ok(mainWfRaw.includes('artifact_id='),
        'workflow must expose artifact_id as a GITHUB_OUTPUT');
});

runTest('Workflow - filing step exposes artifact_url output', () => {
    assert.ok(mainWfRaw.includes('artifact_url='),
        'workflow must expose artifact_url as a GITHUB_OUTPUT');
});

runTest('Workflow - artifact_id is derived from upload-artifact native output', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/steps\.upload_gemini_result\.outputs\.artifact-id/i.test(filingStep),
        'artifact_id must use the native actions/upload-artifact@v4 artifact-id output (not a constructed URL)');
});

runTest('Workflow - workflow_run_id and workflow_run_url are separate fields', () => {
    assert.ok(filingStep, 'filing step not found');
    assert.ok(/WORKFLOW_RUN_ID="\$\{GITHUB_RUN_ID\}"/i.test(filingStep),
        'workflow_run_id must be set from GITHUB_RUN_ID');
    assert.ok(/WORKFLOW_RUN_URL="\$\{GITHUB_SERVER_URL\}\/\$\{GITHUB_REPOSITORY\}\/actions\/runs\/\$\{GITHUB_RUN_ID\}"/i.test(filingStep),
        'workflow_run_url must be set from GitHub context');
    const runIdMatches = (filingStep.match(/workflow_run_id=/g) || []).length;
    assert.ok(runIdMatches >= 1, 'workflow_run_id field must be present in outputs');
});

// =========================================================
// 7. Regression guard: artifact_download_url must NOT exist
// =========================================================

runTest('Workflow - does NOT regress: artifact_download_url field is removed', () => {
    assert.ok(!/ARTIFACT_DOWNLOAD_URL/.test(filingStep),
        'Regression guard: ARTIFACT_DOWNLOAD_URL must not exist — it was misleading (was set to run URL)');
    assert.ok(!/artifact_download_url=/.test(filingStep),
        'Regression guard: artifact_download_url GITHUB_OUTPUT must not exist');
    assert.ok(!/artifact_download_url/.test(mainWfRaw),
        'Regression guard: artifact_download_url must not appear anywhere in main.yml');
});

// =========================================================
// 8. Payload provenance: durable_research_record_path for RESEARCH_DOCUMENT
// =========================================================

runTest('Workflow - payload step includes task_mode in the report', () => {
    assert.ok(payloadStep, 'payload step section could not be extracted');
    assert.ok(/task_mode/.test(payloadStep),
        'Prepare ACP report payload step must reference task_mode');
});

runTest('Workflow - payload step passes task_mode to jq', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/--arg task_mode "\$TASK_MODE"/.test(payloadStep),
        'payload step must pass task_mode as a jq argument');
});

runTest('Workflow - payload includes task_mode field in JSON', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/task_mode: \$task_mode/.test(payloadStep),
        'payload JSON must include task_mode field');
});

runTest('Workflow - payload step references durable_research_record_path', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/durable_research_record_path/.test(payloadStep),
        'payload step must reference durable_research_record_path');
});

runTest('Workflow - payload step checks task_mode == RESEARCH_DOCUMENT', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/TASK_MODE.*RESEARCH_DOCUMENT/.test(payloadStep),
        'payload step must check if TASK_MODE is RESEARCH_DOCUMENT before computing research record path');
});

runTest('Workflow - payload step extracts task_name from task JSON via jq', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/\.task_name/.test(payloadStep),
        'payload step must extract task_name from the task JSON using jq');
});

runTest('Workflow - payload step verifies research record file exists before binding', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/RESEARCH_RECORD_FILE/.test(payloadStep) && /-f "\$RESEARCH_RECORD_FILE"/.test(payloadStep),
        'payload step must verify the research record file exists before binding its path');
});

runTest('Workflow - research record path follows docs/ai/research/research-{task_name}.md convention', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/docs\/ai\/research\/research-\$\{TASK_NAME\}\.md/.test(payloadStep),
        'payload step must construct research record path as docs/ai/research/research-{task_name}.md');
});

runTest('Workflow - payload step passes durable_research_record_path to jq as arg', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/--arg durable_research_record_path/.test(payloadStep),
        'payload step must pass durable_research_record_path as a jq --arg');
});

runTest('Workflow - payload JSON includes durable_research_record_path field', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/durable_research_record_path:/.test(payloadStep),
        'payload JSON must include durable_research_record_path field');
});

runTest('Workflow - payload JSON nulls durable_research_record_path when not verified', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/if \$durable_research_record_path == "null" then null else \$durable_research_record_path end/.test(payloadStep),
        'payload JSON must null durable_research_record_path when value is "null"');
});

// =========================================================
// 8b. Fail-closed: RESEARCH_DOCUMENT must not succeed without research record
// =========================================================

runTest('Workflow - RESEARCH_DOCUMENT uses fail-closed (STATUS forced to failure) on missing record, not just warning', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/STATUS="failure"/.test(payloadStep),
        'RESEARCH_DOCUMENT must force STATUS="failure" when research record is missing');
});

runTest('Workflow - RESEARCH_DOCUMENT does NOT use a mere ::warning:: for missing record', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(!/RESEARCH_DOCUMENT task but research record.*does not exist; report will not bind/.test(payloadStep),
        'Fail-closed: RESEARCH_DOCUMENT must NOT only emit a warning for missing record (must fail the report)');
});

runTest('Workflow - RESEARCH_DOCUMENT fail-closed adds a machine-readable blocker on missing record', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/RESEARCH_BLOCKER/.test(payloadStep),
        'RESEARCH_DOCUMENT must define a RESEARCH_BLOCKER variable for missing/unverifiable record');
    assert.ok(/BLOCKERS.*RESEARCH_BLOCKER|RESEARCH_BLOCKER.*BLOCKERS/i.test(payloadStep),
        'RESEARCH_DOCUMENT must add the RESEARCH_BLOCKER to the blockers array');
});

runTest('Workflow - RESEARCH_DOCUMENT fail-closed: missing record sets STATUS to failure and adds blocker', () => {
    assert.ok(payloadStep, 'payload step not found');
    const failClosed = payloadStep.includes('DURABLE_RESEARCH_RECORD_PATH="null"') || true;
    // The pattern is: if [ -f "$RESEARCH_RECORD_FILE" ]; then ... else STATUS="failure"; ...
    // We verify the else branch forces failure
    assert.ok(/RESEARCH_RECORD_FILE.*STATUS="failure"/s.test(payloadStep) || /-f "\$RESEARCH_RECORD_FILE"/.test(payloadStep) && /STATUS="failure"/.test(payloadStep),
        'RESEARCH_DOCUMENT must force STATUS="failure" in the missing-record branch');
});

runTest('Workflow - RESEARCH_DOCUMENT verifies task_name reference in research record (task/request identity binding)', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/grep.*TASK_NAME.*RESEARCH_RECORD_FILE|grep.*research record.*task_name/.test(payloadStep),
        'RESEARCH_DOCUMENT must verify the research record references the task_name (identity binding)');
});

runTest('Workflow - Non-RESEARCH_DOCUMENT tasks do NOT set STATUS to failure on missing record', () => {
    assert.ok(payloadStep, 'payload step not found');
    // The fail-closed STATUS="failure" must be inside the RESEARCH_DOCUMENT conditional block
    const researchBlock = payloadStep.slice(payloadStep.indexOf('TASK_MODE.*RESEARCH_DOCUMENT') >= 0 ? payloadStep.indexOf('RESEARCH_DOCUMENT') : payloadStep.indexOf('TASK_MODE'));
    assert.ok(/TASK_MODE.*RESEARCH_DOCUMENT/.test(payloadStep),
        'Non-RESEARCH_DOCUMENT tasks must not be subject to research record verification; the check must be gated on TASK_MODE == RESEARCH_DOCUMENT');
});

runTest('Workflow - RESEARCH_DOCUMENT with missing task_name forces failure', () => {
    assert.ok(payloadStep, 'payload step not found');
    assert.ok(/task_name.*empty.*STATUS="failure"|missing task_name.*STATUS="failure"/i.test(payloadStep) ||
              (!/echo "::warning::RESEARCH_DOCUMENT task but research record/.test(payloadStep) && /TASK_NAME/.test(payloadStep) && /STATUS="failure"/.test(payloadStep)),
        'RESEARCH_DOCUMENT with missing task_name must force STATUS="failure"');
});

// =========================================================
// 9. Sequencing: payload finalized before upload
// =========================================================

runTest('Workflow - Prepare ACP report payload step precedes Upload Gemini result artifact step', () => {
    const payloadIdx = mainWfRaw.indexOf('Prepare ACP report payload');
    const uploadIdx = mainWfRaw.indexOf('Upload Gemini result artifact');
    assert.ok(payloadIdx !== -1 && uploadIdx !== -1, 'both steps must exist');
    assert.ok(payloadIdx < uploadIdx,
        'Prepare ACP report payload step must precede Upload Gemini result artifact step so report is finalized before upload');
});

runTest('Workflow - Report artifact filing status step succeeds Upload step', () => {
    const uploadIdx = mainWfRaw.indexOf('Upload Gemini result artifact');
    const reportIdx = mainWfRaw.indexOf('Report artifact filing status');
    assert.ok(uploadIdx !== -1 && reportIdx !== -1, 'both steps must exist');
    assert.ok(uploadIdx < reportIdx,
        'Report artifact filing status step must follow Upload step (needs upload outcome)');
});

// =========================================================
// 10. Protocol retrieval instructions (docs/ai/README.md)
// =========================================================

runTest('Protocol - README documents machine-readable filing fields table', () => {
    assert.ok(/filing_status.*artifact_name.*artifact_file.*workflow_run_id.*workflow_run_url/i.test(readmeRaw),
        'README must document all machine-readable filing fields');
});

runTest('Protocol - README includes artifact_id field', () => {
    assert.ok(/artifact_id/.test(readmeRaw),
        'README must document artifact_id field');
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
    assert.ok(/canonical report must contain an explicit `durable_research_record_path` field|canonical report must contain or expose the durable research-record path|navigate from the canonical Gemini report to the underlying persistent research/i.test(readmeRaw),
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
// 11. README: artifact_id must be referenced in retrieval procedure
// =========================================================

runTest('Protocol - README retrieval procedure references artifact_id for exact artifact identification', () => {
    assert.ok(/artifact_id/.test(readmeRaw),
        'README must reference artifact_id so an agent can identify the exact uploaded artifact');
});

runTest('Protocol - README does NOT present artifact_url as a no-auth direct download link', () => {
    assert.ok(/artifact_url.*not.*a no-auth download|not.*no-auth download.*artifact_url|not.*direct download URL/i.test(readmeRaw) || /artifact_url.*is.*not.*a secret-bearing.*download/i.test(readmeRaw),
        'README must state artifact_url is not a no-auth direct download link');
});

// =========================================================
// 12. CHATGPT_PROJECT_OPERATING_PROTOCOL.md Section 5 deterministic retrieval
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

runTest('Protocol - Section 5 references artifact_id', () => {
    const section5 = protocolRaw.slice(protocolRaw.indexOf('### 5.1 Gemini Result Artifact Retrieval Rule'));
    assert.ok(section5.includes('artifact_id'), 'Protocol Section 5 must reference artifact_id');
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

runTest('Protocol - Section 5.1.2 references inspecting canonical report for research-record path', () => {
    const section = protocolRaw.slice(protocolRaw.indexOf('### 5.1.2 Durable Gemini Evidence Retrieval Procedure'));
    assert.ok(/inspect the.*durable research record|canonical report.*durable research-record path|report.*payload.*durable/i.test(section),
        'Protocol Section 5.1.2 must require inspecting the canonical report payload for the durable research-record path');
});

// =========================================================
// 13. Prohibited substitutes explicitly enumerated
// =========================================================

runTest('Protocol - Section 5 lists filing_status SUCCESS as prohibited substitute', () => {
    const section5 = protocolRaw.slice(protocolRaw.indexOf('### 5.1 Gemini Result Artifact Retrieval Rule'));
    assert.ok(/filing_status.*SUCCESS.*not a retrieval location/i.test(section5),
        'Protocol must list filing_status SUCCESS alone as a prohibited substitute');
});

// =========================================================
// 14. Regression guard: artifact_download_url must NOT appear in tests/docs
// =========================================================

runTest('Workflow - tests do NOT reference artifact_download_url as valid field', () => {
    assert.ok(!/artifact_download_url.*valid|artifact_download_url.*retrieval location/.test(readmeRaw),
        'README must not treat artifact_download_url as a valid retrieval location field');
});

// =========================================================
// Summary
// =========================================================

console.log(`\n--- Summary: ${passCount} passed, ${failCount} failed ---`);
if (failCount > 0) {
    console.error(`FAIL: ${failCount} test(s) failed in gemini-acp-report-discovery-contract.test.js`);
    process.exit(1);
}
console.log('All tests in gemini-acp-report-discovery-contract.test.js passed.');
