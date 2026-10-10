const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');
const childProcess = require('child_process');
const os = require('os');

const execSync = childProcess.execSync;

const WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'main.yml');
const raw = fs.readFileSync(WF_PATH, 'utf8');

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

function extractExpressions(text) {
  const re = /\$\{\{([\s\S]*?)\}\}/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function extractPayloadStep(text) {
  const marker = 'Prepare ACP report payload';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const before = text.slice(0, idx).lastIndexOf('- name:');
  if (before === -1) return null;
  const stepSection = text.slice(before);
  const nextStep = stepSection.indexOf('\n      - name:', 30);
  if (nextStep === -1) return stepSection;
  return stepSection.slice(0, nextStep);
}

function findModeExpression(text) {
  for (const expr of extractExpressions(text)) {
    if (expr.includes("== 'REVIEW'") && expr.includes('VERIFY_RECONCILE') && expr.includes('FAILOVER_EXECUTE')) {
      return expr;
    }
  }
  return null;
}

// Count `+` operators that appear OUTSIDE single-quoted string literals.
// GitHub Actions expressions have no `+` operator; any `+` not inside a
// string literal is a syntax error (the exact regression class being guarded).
function barePlusOperators(expr) {
  let count = 0;
  let inStr = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") {
      inStr = !inStr;
    } else if (c === '+' && !inStr) {
      count++;
    }
  }
  return count;
}

// Locate a top-level call to a named function and return its arguments list.
function extractFunctionCalls(expr, fnName) {
  const calls = [];
  const token = fnName + '(';
  let i = 0;
  while ((i = expr.indexOf(token, i)) !== -1) {
    // Ensure it's a standalone identifier (not a substring of another identifier)
    const before = expr[i - 1];
    if (before && /[A-Za-z0-9_]/.test(before)) { i += token.length; continue; }
    i += token.length;
    let depth = 1;
    let inStr = false;
    let start = i;
    while (i < expr.length && depth > 0) {
      const c = expr[i];
      if (c === "'") { inStr = !inStr; }
      else if (!inStr) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
      }
      i++;
    }
    const argsText = expr.slice(start, i - 1);
    const args = splitTopLevelArgs(argsText);
    calls.push(args);
  }
  return calls;
}

function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" ) { inStr = !inStr; cur += c; continue; }
    if (!inStr) {
      if (c === '(' ) { depth++; cur += c; continue; }
      if (c === ')') { depth--; cur += c; continue; }
      if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    }
    cur += c;
  }
  if (cur.trim().length) args.push(cur.trim());
  return args;
}

function countPlaceholders(formatStringLiteral) {
  const lit = formatStringLiteral.slice(1, -1);
  const found = new Set();
  const re = /\{(\d+)\}/g;
  let m;
  while ((m = re.exec(lit)) !== null) {
    found.add(parseInt(m[1], 10));
  }
  return found.size;
}

const modeExpr = findModeExpression(raw);

runTest('mode-aware prompt expression is present in the workflow', () => {
  assert.ok(modeExpr, 'expected the REVIEW/VERIFY_RECONCILE/FAILOVER_EXECUTE mode expression');
});

runTest('no + string-concatenation operators inside ANY GitHub Actions expression', () => {
  const exprs = extractExpressions(raw);
  assert.ok(exprs.length > 0, 'expected at least one expression');
  const offenders = [];
  for (const e of exprs) {
    const n = barePlusOperators(e);
    if (n > 0) offenders.push({ expr: e.slice(0, 80), plus: n });
  }
  assert.equal(offenders.length, 0, `found bare '+' operators: ${JSON.stringify(offenders)}`);
});

runTest('empty task_mode defaults to REVIEW before comparison', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const re = /\(steps\.orchestration_context_wfd\.outputs\.task_mode \|\| steps\.orchestration_context_ic\.outputs\.task_mode \|\| 'REVIEW'\) == 'REVIEW'/;
  assert.ok(re.test(modeExpr), "expected (task_mode || 'REVIEW') == 'REVIEW' in the mode expression");
});

runTest('VERIFY_RECONCILE comparison also defaults empty task_mode to REVIEW', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const re = /\(steps\.orchestration_context_wfd\.outputs\.task_mode \|\| steps\.orchestration_context_ic\.outputs\.task_mode \|\| 'REVIEW'\) == 'VERIFY_RECONCILE'/;
  assert.ok(re.test(modeExpr), "expected (task_mode || 'REVIEW') == 'VERIFY_RECONCILE'");
});

runTest('all three operating modes (REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE) are selectable', () => {
  assert.ok(modeExpr, 'mode expression missing');
  assert.ok(modeExpr.includes("'MODE: REVIEW (READ-ONLY ADVISORY)"), 'REVIEW branch missing');
  assert.ok(modeExpr.includes("'MODE: VERIFY_RECONCILE (BOUNDED RECONCILIATION)"), 'VERIFY_RECONCILE branch missing');
  assert.ok(modeExpr.includes("'MODE: FAILOVER_EXECUTE (FULL EXECUTION)"), 'FAILOVER_EXECUTE branch missing');
});

runTest('format() is used (no + concat) for VERIFY_RECONCILE interpolation of permitted_paths and capabilities', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const calls = extractFunctionCalls(modeExpr, 'format');
  assert.ok(calls.length >= 1, 'expected at least one format() call');
  let verifyCall = null;
  for (const args of calls) {
    const fmtStr = args[0];
    const valueArgs = args.slice(1);
    if (fmtStr.includes('VERIFY_RECONCILE') &&
        valueArgs.some(a => a.includes('outputs.permitted_paths')) &&
        valueArgs.some(a => a.includes('outputs.capabilities'))) {
      verifyCall = args;
    }
  }
  assert.ok(verifyCall, 'could not locate the VERIFY_RECONCILE format() call');
  assert.ok(verifyCall.some(a => a.includes('outputs.permitted_paths')), 'permitted_paths not interpolated via format()');
  assert.ok(verifyCall.some(a => a.includes('outputs.capabilities')), 'capabilities not interpolated via format()');
});

runTest('format() placeholder count matches argument count', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const calls = extractFunctionCalls(modeExpr, 'format');
  for (const args of calls) {
    const fmtStr = args[0];
    const placeholders = countPlaceholders(fmtStr);
    const valueArgs = args.length - 1;
    assert.equal(valueArgs, placeholders, `format() expects ${placeholders} replacement value(s) but got ${valueArgs}`);
  }
});

runTest('FAILOVER_EXECUTE interpolates capabilities via format()', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const calls = extractFunctionCalls(modeExpr, 'format');
  let failoverCall = null;
  for (const args of calls) {
    const joined = args.join(' ');
    if (joined.includes('FAILOVER_EXECUTE')) failoverCall = args;
  }
  assert.ok(failoverCall, 'could not locate the FAILOVER_EXECUTE format() call');
  assert.ok(failoverCall.some(a => a.includes('outputs.capabilities')), 'FAILOVER_EXECUTE does not interpolate capabilities via format()');
});

runTest('issue_comment path does NOT detect FAILOVER_EXECUTE from comment prefix (canonical descriptor is authoritative)', () => {
  assert.ok(!raw.includes("grep -qiE '^FAILOVER_EXECUTE"),
    'issue_comment path must NOT parse FAILOVER_EXECUTE from comment prefix');
  assert.ok(!raw.match(/grep.*FAILOVER_EXECUTE/i),
    'issue_comment path must NOT grep for FAILOVER_EXECUTE keyword');
});

runTest('issue_comment path defaults to REVIEW/read_only for plain @gemini-cli comments (embedded descriptor extraction supported)', () => {
  assert.ok(raw.includes('CANDIDATE_TASK_MODE="REVIEW"'),
    'issue_comment request_comment step must default to REVIEW for plain @gemini-cli');
  assert.ok(raw.includes('CANDIDATE_CAPABILITIES="read_only"'),
    'issue_comment request_comment step must default to read_only for plain @gemini-cli');
  assert.ok(raw.includes('CANDIDATE_PERMITTED_PATHS="poc/"'),
    'issue_comment request_comment step must default to poc/ for plain @gemini-cli');
  assert.ok(!raw.match(/grep.*FAILOVER_EXECUTE/i),
    'issue_comment request_comment step must NOT parse FAILOVER_EXECUTE from comment prefix');
});

runTest('issue_comment orchestration context step is present', () => {
  assert.ok(raw.includes('Prepare orchestration context (issue_comment)'), 'issue_comment orchestration context step missing');
  assert.ok(raw.includes('if: github.event_name == \'issue_comment\''), 'issue_comment orchestration context condition missing');
});

runTest('issue_comment orchestration context reads task_mode from execution descriptor (not comment-prefix shell variables)', () => {
  assert.ok(raw.includes("jq -r '.task_mode' \"$DESCRIPTOR_FILE\""),
    'orchestration_context_ic must read task_mode from descriptor file');
  assert.ok(raw.includes("jq -r '.capabilities | join(\",\")' \"$DESCRIPTOR_FILE\""),
    'orchestration_context_ic must read capabilities from descriptor file');
  assert.ok(raw.includes("jq -r '.permitted_paths | join(\" \")' \"$DESCRIPTOR_FILE\""),
    'orchestration_context_ic must read permitted_paths from descriptor file (space-separated for shell iteration)');
});

runTest('issue_comment does NOT reconstruct authority from comment-prefix shell variables', () => {
  assert.ok(!raw.includes('echo "task_mode=$TASK_MODE"'),
    'issue_comment must not use $TASK_MODE shell variable (comment-prefix reconstruction)');
  assert.ok(!raw.includes('echo "capabilities=$CAPABILITIES"'),
    'issue_comment must not use $CAPABILITIES shell variable (comment-prefix reconstruction)');
  assert.ok(!raw.includes('echo "permitted_paths=$PERMITTED_PATHS"'),
    'issue_comment must not use $PERMITTED_PATHS shell variable (comment-prefix reconstruction)');
});

runTest('@gemini-cli plain issue_comment defaults to REVIEW (canonical descriptor is authoritative)', () => {
  assert.ok(raw.includes('CANDIDATE_TASK_MODE="REVIEW"'),
    'REVIEW default must be set for plain @gemini-cli comments in request_comment step');
  assert.ok(raw.includes('CANDIDATE_CAPABILITIES="read_only"'),
    'read_only default must be set for plain @gemini-cli comments in request_comment step');
  assert.ok(raw.includes('CANDIDATE_PERMITTED_PATHS="poc/"'),
    'permitted_paths default must be set for plain @gemini-cli comments in request_comment step');
});

runTest('issue_comment trigger with types: [created] is present and intact', () => {
  assert.ok(/issue_comment:\s*\n\s*types: \[created\]/.test(raw), 'issue_comment trigger missing');
});

runTest('workflow_dispatch configuration is present', () => {
  assert.ok(/workflow_dispatch:/.test(raw), 'workflow_dispatch trigger missing');
  assert.ok(/request_id:/.test(raw), 'request_id input missing');
  assert.ok(/task_mode:/.test(raw), 'task_mode input missing');
  assert.ok(/permitted_paths:/.test(raw), 'permitted_paths input missing');
});

runTest('@gemini-cli activation prefix is required', () => {
  assert.ok(raw.includes("startsWith(github.event.comment.body, '@gemini-cli')"), '@gemini-cli prefix gate missing');
});

runTest('trusted Director username authorization condition is present and intact', () => {
  assert.ok(raw.includes("github.event.comment.user.login == 'fluentwithkyle'"), 'trusted Director username authorization condition missing/changed');
});

runTest('gemini-acp-report.json artifact is published', () => {
  assert.ok(raw.includes('gemini-acp-report.json'), 'artifact file reference missing');
  assert.ok(/uses: actions\/upload-artifact@v4/.test(raw), 'artifact upload step missing');
  assert.ok(/name: gemini-acp-report/.test(raw), 'artifact name missing');
});

runTest('run-gemini-cli action invocation is preserved', () => {
  assert.ok(raw.includes('google-github-actions/run-gemini-cli@v0'), 'run-gemini-cli step missing');
});

runTest('Determine Gemini execution result step exists and reads gemini_run.outcome', () => {
  assert.ok(raw.includes('Determine Gemini execution result'), 'gemini_result step missing');
  assert.ok(raw.includes('steps.gemini_run.outcome'), 'gemini_run.outcome reference missing');
});

runTest('raw Markdown persist step is removed (no printf of gemini_run.outputs.summary to gemini-acp-report.json)', () => {
  assert.ok(!raw.includes('Persist Gemini result as artifact'), 'Persist raw Markdown step should be removed');
  assert.ok(!raw.includes("printf '%s' \"${{ steps.gemini_run.outputs.summary }}\" > gemini-acp-report.json"), 'raw summary should not be written directly to gemini-acp-report.json');
});

runTest('single unified artifact upload covers both trigger paths', () => {
  const uploadCount = (raw.match(/name: Upload Gemini result artifact/g) || []).length;
  assert.equal(uploadCount, 1, `expected exactly 1 Upload step, found ${uploadCount}`);
  const uploadIdx = raw.indexOf('Upload Gemini result artifact');
  assert.ok(uploadIdx !== -1, 'Upload step missing');
  const uploadSlice = raw.slice(uploadIdx);
  assert.ok(/if:\s*always\(\)/.test(uploadSlice), 'Upload step should use if: always()');
  assert.ok(!/if:\s*always\(\).*github\.event_name/.test(uploadSlice), 'Upload step should not be gated on event_name');
});

runTest('Determine Gemini execution result step uses if: always()', () => {
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  assert.ok(resultIdx !== -1, 'gemini_result step missing');
  const resultSlice = raw.slice(resultIdx, raw.indexOf('Prepare ACP report payload'));
  assert.ok(/if:\s*always\(\)/.test(resultSlice), 'gemini_result step missing if: always()');
});

runTest('ACP report payload step runs for all trigger paths (no event_name gate)', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  assert.ok(payloadIdx !== -1, 'ACP report payload step missing');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(/if:\s*always\(\)/.test(payloadSection), 'payload step missing if: always()');
  assert.ok(!/workflow_dispatch/.test(payloadSection.split('shell:')[0]), 'payload step should not be gated on workflow_dispatch');
});

runTest('Send callback to Render remains workflow_dispatch-only', () => {
  const sendIdx = raw.indexOf('Send callback to Render');
  assert.ok(sendIdx !== -1, 'send callback step missing');
  assert.ok(/if:\s*always\(\)\s*&&\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(raw.slice(sendIdx)), 'send callback step should remain workflow_dispatch-only');
});

runTest('callback payload handles issue_comment with GITHUB_EVENT_NAME conditional', () => {
    const payloadIdx = raw.indexOf('Prepare ACP report payload');
    const sendIdx = raw.indexOf('Send callback to Render');
    const payloadSection = raw.slice(payloadIdx, sendIdx);
    assert.ok(payloadSection.includes('execution-descriptor.json'), 'payload step should reference descriptor file');
    assert.ok(payloadSection.includes('IS_REPLAY'), 'payload step should use IS_REPLAY for issue_comment/fallback handling');
});

runTest('callback payload derives STATUS from gemini_result step', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(payloadSection.includes('steps.gemini_result.outputs.gemini_status'), 'STATUS should be derived from steps.gemini_result.outputs.gemini_status');
});

runTest('STATUS is not hardcoded to success in callback payload step', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(!payloadSection.includes('STATUS="success"'), 'STATUS should not be hardcoded to success in callback payload step');
});

runTest('request_id is null when empty (issue_comment path)', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(payloadSection.includes('if $request_id == "" then null else $request_id end'), 'request_id should be null when empty');
});

runTest('callback_payload.json is copied to gemini-acp-report.json', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(payloadSection.includes('cp callback_payload.json gemini-acp-report.json'), 'callback_payload.json should be copied to gemini-acp-report.json');
});

runTest('ACP report payload contains required JSON envelope fields', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  for (const field of ['request_id', 'agent', 'status', 'task', 'repository', 'base_branch', 'current_head_sha', 'changed_files', 'verification', 'result', 'commit', 'push', 'blockers']) {
    assert.ok(payloadSection.includes(field), `ACP envelope field '${field}' missing from payload step`);
  }
});

runTest('jq is used to build the structured ACP payload', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(payloadSection.includes('jq -n'), 'jq should be used to build structured payload');
  assert.ok(payloadSection.includes('callback_payload.json'), 'payload should write to callback_payload.json');
});

runTest('gemini_output is included in ACP report payload', () => {
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const sendIdx = raw.indexOf('Send callback to Render');
  const payloadSection = raw.slice(payloadIdx, sendIdx);
  assert.ok(payloadSection.includes('--arg gemini_output'), 'gemini_output arg missing from jq');
  assert.ok(payloadSection.includes('gemini_output: $gemini_output'), 'gemini_output field missing from jq output');
});

runTest('VERIFY_RECONCILE recon_status is conditional on verification PASS', () => {
  const completedIdx = raw.indexOf('RECON_STATUS="COMPLETED"');
  assert.ok(completedIdx !== -1, 'RECON_STATUS="COMPLETED" should be present');
  const passIdx = raw.lastIndexOf('VERIFICATION_STATUS="PASS"', completedIdx);
  assert.ok(passIdx !== -1, 'RECON_STATUS="COMPLETED" must be conditional on VERIFICATION_STATUS="PASS"');
});

// --- Gemini Builder workflow tests ---

const BUILDER_WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'gemini-builder.yml');
const builderRaw = fs.readFileSync(BUILDER_WF_PATH, 'utf8');

runTest('Gemini Builder workflow file exists and has workflow_dispatch trigger', () => {
  assert.ok(builderRaw.includes('workflow_dispatch:'), 'gemini-builder.yml should have workflow_dispatch trigger');
});

runTest('Gemini Builder workflow uses GEMINI_BUILDER_API_KEY', () => {
  assert.ok(builderRaw.includes('GEMINI_BUILDER_API_KEY'), 'gemini-builder.yml should use GEMINI_BUILDER_API_KEY');
  assert.ok(!builderRaw.includes('secrets.GEMINI_API_KEY'), 'gemini-builder.yml should NOT use GEMINI_API_KEY');
});

runTest('Gemini Builder workflow does not require kilo_execution_id', () => {
  assert.ok(builderRaw.includes('kilo_execution_id'), 'kilo_execution_id input should exist (optional)');
  assert.ok(builderRaw.includes('required: false'), 'kilo_execution_id should be optional (required: false)');
});

runTest('Gemini Builder workflow has builder_execution_id input', () => {
  assert.ok(builderRaw.includes('builder_execution_id'), 'builder_execution_id input should be present');
});

runTest('Gemini Builder workflow has BUILDER mode in prompt', () => {
  assert.ok(builderRaw.includes('BUILDER'), 'gemini-builder.yml should reference BUILDER mode');
});

runTest('Gemini Builder workflow has commit and push steps', () => {
  assert.ok(builderRaw.includes('git commit'), 'gemini-builder.yml should have a git commit step');
  assert.ok(builderRaw.includes('git push'), 'gemini-builder.yml should have a git push step');
});

runTest('Gemini Builder workflow produces gemini-acp-report artifact', () => {
  assert.ok(builderRaw.includes('gemini-acp-report'), 'gemini-builder.yml should produce gemini-acp-report artifact');
  assert.ok(builderRaw.includes('gemini-acp-report.json'), 'gemini-builder.yml should produce gemini-acp-report.json');
  assert.ok(/uses: actions\/upload-artifact@v4/.test(builderRaw), 'gemini-builder.yml should have artifact upload step');
});

runTest('Gemini Builder workflow uses contents: write permission', () => {
  assert.ok(builderRaw.includes('contents: write'), 'gemini-builder.yml should have contents: write permission');
});

runTest('Gemini Builder workflow sends callback to Render', () => {
  assert.ok(builderRaw.includes('RENDER_BUILDER_CALLBACK_URL'), 'gemini-builder.yml should reference RENDER_BUILDER_CALLBACK_URL');
  assert.ok(builderRaw.includes('BUILDER_CALLBACK_SECRET'), 'gemini-builder.yml should reference BUILDER_CALLBACK_SECRET');
  assert.ok(builderRaw.includes('x-builder-callback-secret'), 'gemini-builder.yml should use x-builder-callback-secret header');
});

runTest('Gemini Builder workflow ACP report uses agent Gemini Builder', () => {
  assert.ok(builderRaw.includes('Gemini Builder'), 'gemini-builder.yml ACP report should use agent "Gemini Builder"');
});

runTest('Gemini Builder workflow has no bare + operators in expressions', () => {
  const builderExprs = extractExpressions(builderRaw);
  const offenders = [];
  for (const e of builderExprs) {
    const n = barePlusOperators(e);
    if (n > 0) offenders.push({ expr: e.slice(0, 80), plus: n });
  }
  assert.equal(offenders.length, 0, `found bare '+' operators in builder workflow: ${JSON.stringify(offenders)}`);
});

// --- FAILOVER_EXECUTE commit/push persistence enforcement tests ---

runTest('main.yml has mode-aware commit/push step (RESEARCH_DOCUMENT, VERIFY_RECONCILE, FAILOVER_EXECUTE)', () => {
  assert.ok(raw.includes('Commit and push Gemini changes (mode-aware:'),
    'main.yml must have a mode-aware commit/push step');
  assert.ok(raw.includes('RESEARCH_DOCUMENT, VERIFY_RECONCILE, FAILOVER_EXECUTE'),
    'commit/push step must mention all three modes');
});

runTest('main.yml commit/push step is gated on RESEARCH_DOCUMENT, VERIFY_RECONCILE, or FAILOVER_EXECUTE task mode', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(/==\s*'RESEARCH_DOCUMENT'/.test(section),
    'commit/push step must be gated on RESEARCH_DOCUMENT task mode');
  assert.ok(/==\s*'VERIFY_RECONCILE'/.test(section),
    'commit/push step must be gated on VERIFY_RECONCILE task mode');
  assert.ok(/==\s*'FAILOVER_EXECUTE'/.test(section),
    'commit/push step must be gated on FAILOVER_EXECUTE task mode');
});

runTest('main.yml commit/push step runs git commit and git push for all modes', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('git commit'), 'commit/push step must run git commit');
  assert.ok(section.includes('git push'), 'commit/push step must run git push');
});

runTest('main.yml commit/push step stages only permitted_paths, not git add -A', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('git add "$dir"'),
    'commit/push step must stage individual permitted path directories');
  assert.ok(!/git add -A/.test(section),
    'commit/push step must NOT use unrestricted git add -A');
});

runTest('main.yml commit/push step verifies push on remote base branch', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('git ls-remote'),
    'commit/push step must verify commit on remote base branch with git ls-remote');
});

runTest('main.yml commit/push step outputs commit_sha, push_status, uncommitted_changes, push_verified', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('commit_sha='), 'must output commit_sha');
  assert.ok(section.includes('push_status='), 'must output push_status');
  assert.ok(section.includes('uncommitted_changes='), 'must output uncommitted_changes');
  assert.ok(section.includes('push_verified='), 'must output push_verified');
});

runTest('main.yml commit/push step fails closed on commit failure', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('exit 1'),
    'commit/push step must exit 1 on failure (fail closed)');
  assert.ok(section.includes('UNCOMMITTED_CHANGES="true"'),
    'commit/push step must set UNCOMMITTED_CHANGES=true on failure');
});

runTest('main.yml commit/push step includes mode-aware commit messages', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('RESEARCH_DOCUMENT: Persist research findings'),
    'commit/push step must include RESEARCH_DOCUMENT commit message');
  assert.ok(section.includes('VERIFY_RECONCILE: Persist verification reconciliation'),
    'commit/push step must include VERIFY_RECONCILE commit message');
  assert.ok(section.includes('FAILOVER_EXECUTE: Persist authorized implementation changes'),
    'commit/push step must include FAILOVER_EXECUTE commit message');
});

runTest('main.yml commit/push step has out-of-scope change detection (fail closed)', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('Out-of-scope changes detected'),
    'commit/push step must detect and fail on out-of-scope changes');
  assert.ok(section.includes('OUT_OF_SCOPE'),
    'commit/push step must use OUT_OF_SCOPE variable for detection');
});

runTest('main.yml commit/push step has RESEARCH_DOCUMENT fail-closed research record check', () => {
  const idx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const section = raw.slice(idx, raw.indexOf('\n      - name:', idx + 30));
  assert.ok(section.includes('RESEARCH_DOCUMENT task'),
    'commit/push step must have RESEARCH_DOCUMENT research record check');
  assert.ok(section.includes('requires durable research record'),
    'commit/push step must fail-closed when research record is missing');
});

runTest('main.yml Determine Gemini execution result enforces FAILOVER_EXECUTE persistence', () => {
  const payloadStep = extractPayloadStep(raw);
  assert.ok(payloadStep, 'payload step not found');
  assert.ok(payloadStep.includes('--argjson changed_files'),
    'jq payload must pass changed_files as --argjson');
  assert.ok(payloadStep.includes('changed_files: $changed_files'),
    'jq payload JSON must include changed_files field from variable');
});

runTest('main.yml commit/push step runs after Gemini CLI and before gemini_result', () => {
  const commitIdx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const geminiIdx = raw.indexOf('Run Gemini in advisory mode');
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  assert.ok(commitIdx !== -1 && geminiIdx !== -1 && resultIdx !== -1,
    'all steps must exist');
  assert.ok(geminiIdx < commitIdx, 'Gemini CLI run must come before commit/push step');
  assert.ok(commitIdx < resultIdx, 'commit/push step must come before gemini_result determination');
});

runTest('main.yml is valid YAML that parses without structural errors', () => {
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new Error(`main.yml failed to parse as valid YAML: ${err.message}`);
  }
  assert.ok(doc, 'main.yml parsed to null/undefined');
  assert.ok(doc.jobs, 'main.yml must have a jobs section');
  assert.ok(doc.jobs.advisory, 'main.yml must have an advisory job');
});

runTest('commit_push step is a top-level step in the advisory job (not nested in with:)', () => {
  const doc = yaml.load(raw);
  const steps = doc.jobs.advisory.steps;
  const commitPushStep = steps.find(s => s.id === 'commit_push');
  assert.ok(commitPushStep, 'commit_push must be a direct step in advisory job steps');
  assert.equal(commitPushStep.name, 'Commit and push Gemini changes (mode-aware: RESEARCH_DOCUMENT, VERIFY_RECONCILE, FAILOVER_EXECUTE)',
    'commit_push step name must match');
  assert.ok(commitPushStep.if, 'commit_push step must have an if condition');
  assert.ok(commitPushStep.run, 'commit_push step must have a run script');
});

  runTest('all steps in the advisory job are top-level (6-space indentation)', () => {
  const doc = yaml.load(raw);
  const steps = doc.jobs.advisory.steps;
  assert.ok(steps.length > 10, `expected 10+ top-level steps, found ${steps.length}`);
  const hasCommitPush = steps.some(s => s.id === 'commit_push' && s.name.includes('Commit and push Gemini changes'));
  assert.ok(hasCommitPush, 'commit_push step must exist with 6-space indentation like all other steps');
});

runTest('no step is nested inside another step via misindented - name:', () => {
  const doc = yaml.load(raw);
  const steps = doc.jobs.advisory.steps;
  for (const step of steps) {
    if (step.with) {
      for (const key of Object.keys(step.with)) {
        const val = step.with[key];
        assert.ok(!Array.isArray(val),
          `step ${step.name || step.id || '?'}: with.${key} must not be a list (possible step-nesting regression)`);
      }
    }
  }
});

// --- Shallow-checkout / failed-diff JSON fallback regression tests ---

runTest('main.yml changed_files diff captures exit status explicitly', () => {
  assert.ok(raw.includes('DIFF_STATUS=0'),
    'callback payload step must initialize DIFF_STATUS=0');
  assert.ok(raw.includes('DIFF_STATUS=$?'),
    'callback payload step must capture git diff exit status');
  assert.ok(raw.includes('"$DIFF_STATUS" -ne 0'),
    'callback payload step must check DIFF_STATUS for failure handling');
});

runTest('main.yml checkout uses fetch-depth: 2 to provide HEAD~1 for diff', () => {
  assert.ok(raw.includes('fetch-depth: 2'),
    'checkout step must use fetch-depth: 2 so HEAD~1 is available for changed_files diff');
});

runTest('main.yml changed_files diff fails closed on missing HEAD~1 (no empty tree fallback)', () => {
  assert.ok(raw.includes('git rev-parse --verify HEAD~1'),
    'callback payload step must check for HEAD~1 existence');
  assert.ok(raw.includes('HEAD~1 does not exist'),
    'callback payload step must fail closed with descriptive message when HEAD~1 is missing');
  assert.ok(!raw.includes('EMPTY_TREE'),
    'callback payload step must NOT use empty tree fallback for missing HEAD~1');
});

runTest('main.yml changed_files diff fails closed on diff failure', () => {
  assert.ok(raw.includes('DIFF_BLOCKER_MSG'),
    'callback payload step must set a blocker message on diff failure');
  assert.ok(raw.includes('BLOCKERS_JSON'),
    'callback payload step must include diff failure in BLOCKERS_JSON');
  assert.ok(raw.includes('cannot produce complete changed_files list'),
    'callback payload step must fail closed with descriptive blocker on diff failure');
});

runTest('main.yml changed_files JSON validates output is an array before accepting it', () => {
  assert.ok(raw.includes("jq -r 'type'"),
    'callback payload step must validate JSON type with jq -r type before using it');
  assert.ok(raw.includes('"array"'),
    'callback payload step must check that changed_files JSON type is array');
  assert.ok(raw.includes('CHANGED_FILES_TYPE'),
    'callback payload step must capture jq type output in CHANGED_FILES_TYPE');
  assert.ok(raw.includes('RAW_CHANGED_FILES_JSON'),
    'callback payload step must capture jq output in RAW_CHANGED_FILES_JSON');
  assert.ok(raw.includes('CHANGED_FILES_JSON="$RAW_CHANGED_FILES_JSON"'),
    'script must only accept CHANGED_FILES_JSON after array-type validation passes');
});

runTest('main.yml changed_files JSON initializes to []', () => {
  assert.ok(raw.includes("CHANGED_FILES_JSON='[]'"),
    'callback payload step must initialize CHANGED_FILES_JSON to empty array []');
});

runTest('main.yml changed_files uses jq --argjson changed_files (not string interpolation)', () => {
  assert.ok(raw.includes('--argjson changed_files'),
    'callback payload step must pass changed_files as --argjson (typed JSON array)');
});

// --- Behavioral simulation tests for the 5 diff scenarios ---

runTest('Behavioral: successful empty diff produces []', () => {
  const result = execSync(`
    git init -q test-empty-$$ && cd test-empty-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&
    git commit -q --allow-empty -m initial &&
    git commit -q --allow-empty -m "second commit" &&
    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_OUTPUT=""
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      DIFF_OUTPUT=\$(git diff --name-only HEAD~1 HEAD 2>&1) || DIFF_STATUS=\$?
    else
      DIFF_STATUS=1
      DIFF_OUTPUT="fatal: HEAD~1 does not exist (initial commit or insufficient checkout depth); cannot determine changed files"
    fi
    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="failed"
    else
      RAW_CHANGED_FILES_JSON=\$(printf '%s' "\$DIFF_OUTPUT" | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null)
      CHANGED_FILES_TYPE=\$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
      if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
        CHANGED_FILES_JSON="\$RAW_CHANGED_FILES_JSON"
      fi
    fi
    echo -n "\$CHANGED_FILES_JSON" &&
    cd .. && rm -rf test-empty-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  assert.equal(result.trim(), '[]', 'empty diff must produce exactly []');
});

runTest('Behavioral: successful non-empty diff produces file list array', () => {
  const result = execSync(`
    git init -q test-nonempty-$$ && cd test-nonempty-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&
    git commit -q --allow-empty -m initial &&
    echo "modified" > README.md &&
    git add README.md && git commit -q -m modified &&
    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_OUTPUT=""
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      DIFF_OUTPUT=\$(git diff --name-only HEAD~1 HEAD 2>&1) || DIFF_STATUS=\$?
    else
      DIFF_STATUS=1
      DIFF_OUTPUT="fatal: HEAD~1 does not exist (initial commit or insufficient checkout depth); cannot determine changed files"
    fi
    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="failed"
    else
      RAW_CHANGED_FILES_JSON=\$(printf '%s' "\$DIFF_OUTPUT" | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null)
      CHANGED_FILES_TYPE=\$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
      if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
        CHANGED_FILES_JSON="\$RAW_CHANGED_FILES_JSON"
      fi
    fi
    echo -n "\$CHANGED_FILES_JSON" &&
    cd .. && rm -rf test-nonempty-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const arr = JSON.parse(result.trim());
  assert.ok(Array.isArray(arr), 'must be a JSON array');
  assert.ok(arr.includes('README.md'), 'must include modified file');
});

runTest('Behavioral: missing HEAD~1 (initial commit) fails closed without false changed-file report', () => {
  // Simulate a repo with a single commit (no parent). The workflow now
  // fail-closes instead of diffing against the empty tree, so changed_files
  // must remain [] and a blocker must be set. Critically, the changed_files
  // must NOT falsely list every tracked file as changed.
  const result = execSync(`
    git init -q test-shallow-$$ && cd test-shallow-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&
    git commit -q --allow-empty -m initial &&
    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_OUTPUT=""
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      DIFF_OUTPUT=\$(git diff --name-only HEAD~1 HEAD 2>&1) || DIFF_STATUS=\$?
    else
      DIFF_STATUS=1
      DIFF_OUTPUT="fatal: HEAD~1 does not exist (initial commit or insufficient checkout depth); cannot determine changed files"
    fi
    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="changed_files diff command failed (exit \$DIFF_STATUS); cannot produce complete changed_files list"
    else
      RAW_CHANGED_FILES_JSON=\$(printf '%s' "\$DIFF_OUTPUT" | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null)
      CHANGED_FILES_TYPE=\$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
      if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
        CHANGED_FILES_JSON="\$RAW_CHANGED_FILES_JSON"
      else
        DIFF_BLOCKER_MSG="changed_files diff produced invalid JSON; cannot report changed files"
      fi
    fi
    echo "DIFF_STATUS=\$DIFF_STATUS"
    echo "BLOCKER=\${DIFF_BLOCKER_MSG:-}"
    echo "CHANGED_FILES_JSON=\$CHANGED_FILES_JSON"
    cd .. && rm -rf test-shallow-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const lines = result.trim().split('\n');
  const statusLine = lines.find(l => l.startsWith('DIFF_STATUS='));
  const blockerLine = lines.find(l => l.startsWith('BLOCKER='));
  const jsonLine = lines.find(l => l.startsWith('CHANGED_FILES_JSON='));

  const diffStatus = statusLine ? statusLine.split('=')[1] : '';
  const blocker = blockerLine ? blockerLine.split('=')[1] : '';
  const changedFiles = jsonLine ? jsonLine.split('=')[1] : '';

  assert.notEqual(diffStatus, '0', 'missing HEAD~1 must set DIFF_STATUS to nonzero');
  assert.ok(blocker.length > 0, 'missing HEAD~1 must record a blocker');
  assert.ok(blocker.includes('changed_files diff command failed'), 'blocker must describe the failure');
  assert.equal(changedFiles, '[]', 'CHANGED_FILES_JSON must remain [] (not a false file listing) when HEAD~1 is missing');
});

runTest('Behavioral: genuinely failing diff sets DIFF_BLOCKER_MSG (fail closed)', () => {
  // Force git diff to actually fail by using a corrupted git repository.
  // This is NOT the shallow-checkout scenario (which succeeds via empty-tree fallback).
  // We simulate a real diff failure by creating a repo where HEAD is broken.
  const result = execSync(`
    git init -q test-realfail-$$ && cd test-realfail-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&
    git commit -q --allow-empty -m initial &&
    echo "content" > file.txt && git add file.txt && git commit -q -m "real commit" &&

    # Corrupt HEAD so git diff fails with a real nonzero exit status
    echo "corrupted-ref" > .git/HEAD &&

    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_BLOCKER_MSG=""
    DIFF_OUTPUT=""
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      DIFF_OUTPUT=\$(git diff --name-only HEAD~1 HEAD 2>&1) || DIFF_STATUS=\$?
    else
      DIFF_STATUS=1
      DIFF_OUTPUT="fatal: HEAD~1 does not exist (initial commit or insufficient checkout depth); cannot determine changed files"
    fi

    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="changed_files diff command failed (exit \$DIFF_STATUS); cannot produce complete changed_files list"
    fi

    # Output structured result for assertion
    echo "DIFF_STATUS=\$DIFF_STATUS"
    echo "BLOCKER=\${DIFF_BLOCKER_MSG:-}"
    echo "CHANGED_FILES_JSON=\$CHANGED_FILES_JSON"
    cd .. && rm -rf test-realfail-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const lines = result.trim().split('\n');
  const statusLine = lines.find(l => l.startsWith('DIFF_STATUS='));
  const blockerLine = lines.find(l => l.startsWith('BLOCKER='));
  const jsonLine = lines.find(l => l.startsWith('CHANGED_FILES_JSON='));

  const diffStatus = statusLine ? statusLine.split('=')[1] : '';
  const blocker = blockerLine ? blockerLine.split('=')[1] : '';
  const changedFiles = jsonLine ? jsonLine.split('=')[1] : '';

  // 1. Nonzero exit status is detected
  assert.notEqual(diffStatus, '0', 'diff must fail with nonzero exit status when HEAD is corrupted');
  // 2. A blocker is recorded
  assert.ok(blocker.length > 0, 'a blocker must be recorded when diff fails');
  assert.ok(blocker.includes('changed_files diff command failed'), 'blocker must describe the failure');
  // 3. Incomplete result is not accepted as complete
  assert.equal(changedFiles, '[]', 'CHANGED_FILES_JSON must remain default [] on failure, not partial output');
  // 4. CHANGED_FILES_JSON is exactly one valid JSON array
  const arr = JSON.parse(changedFiles);
  assert.ok(Array.isArray(arr), 'CHANGED_FILES_JSON must be a valid JSON array even on failure');
});

runTest('Behavioral: partial diff output then failure is rejected (fail closed)', () => {
  // Simulate a diff command that emits a filename, then exits nonzero.
  // The key assertion: the partial filename must NOT appear in CHANGED_FILES_JSON.
  // We achieve this by creating a script that mimics git diff emitting partial output
  // then failing.
  const result = execSync(`
    # Create a fake git diff that outputs a filename then exits 1
    mkdir -p /tmp/fake-git-$$ &&
    cat > /tmp/fake-git-$$/fake-diff.sh << 'SCRIPT'
#!/bin/bash
echo "file1.txt"
echo "file2.txt"
exit 1
SCRIPT
    chmod +x /tmp/fake-git-$$/fake-diff.sh &&

    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_BLOCKER_MSG=""
    DIFF_OUTPUT=""

    # Run the fake diff; it produces partial output then exits nonzero
    DIFF_OUTPUT=$(/tmp/fake-git-$$/fake-diff.sh 2>&1) || DIFF_STATUS=\$?

    # Apply the SAME array-type validation the workflow uses
    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="changed_files diff command failed (exit \$DIFF_STATUS); cannot produce complete changed_files list"
    else
      RAW_CHANGED_FILES_JSON=\$(printf '%s' "\$DIFF_OUTPUT" | jq -R -s -c 'split("\\n") | map(select(length > 0))' 2>/dev/null)
      CHANGED_FILES_TYPE=\$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
      if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
        CHANGED_FILES_JSON="\$RAW_CHANGED_FILES_JSON"
      else
        DIFF_BLOCKER_MSG="changed_files diff produced invalid JSON; cannot report changed files"
      fi
    fi

    echo "DIFF_STATUS=\$DIFF_STATUS"
    echo "BLOCKER=\${DIFF_BLOCKER_MSG:-}"
    echo "CHANGED_FILES_JSON=\$CHANGED_FILES_JSON"

    rm -rf /tmp/fake-git-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const lines = result.trim().split('\n');
  const statusLine = lines.find(l => l.startsWith('DIFF_STATUS='));
  const blockerLine = lines.find(l => l.startsWith('BLOCKER='));
  const jsonLine = lines.find(l => l.startsWith('CHANGED_FILES_JSON='));

  const diffStatus = statusLine ? statusLine.split('=')[1] : '';
  const blocker = blockerLine ? blockerLine.split('=')[1] : '';
  const changedFiles = jsonLine ? jsonLine.split('=')[1] : '';

  // The diff exited nonzero
  assert.notEqual(diffStatus, '0', 'fake diff must exit nonzero');
  // A blocker is recorded
  assert.ok(blocker.length > 0, 'partial output then failure must record a blocker');
  assert.ok(blocker.includes('changed_files diff command failed'), 'blocker must describe the diff failure');
  // The partial filenames must NOT be in CHANGED_FILES_JSON
  assert.equal(changedFiles, '[]', 'partial output must not be accepted as changed_files; CHANGED_FILES_JSON must remain []');
  // CHANGED_FILES_JSON is still exactly one valid JSON array
  const arr = JSON.parse(changedFiles);
  assert.ok(Array.isArray(arr), 'CHANGED_FILES_JSON must be a valid JSON array even on partial failure');
});

runTest('Behavioral: partial/invalid jq output is rejected and does not reach changed_files', () => {
  // Simulate: git diff succeeds but produces partial/garbage output that
  // jq turns into invalid data. The type validation must reject it.
  const result = execSync(`
    git init -q test-invalid-$$ && cd test-invalid-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&
    git commit -q --allow-empty -m initial &&
    echo "file1" > f1.txt && git add f1.txt && git commit -q -m "add f1" &&
    CHANGED_FILES_JSON='[]'
    DIFF_STATUS=0
    DIFF_OUTPUT=""
    # Normal diff succeeds
    DIFF_OUTPUT=\$(git diff --name-only HEAD~1 HEAD 2>&1) || DIFF_STATUS=\$?
    if [ "\$DIFF_STATUS" -ne 0 ]; then
      DIFF_BLOCKER_MSG="diff failed"
    else
      RAW_CHANGED_FILES_JSON=\$(printf '%s' "\$DIFF_OUTPUT" | jq -R -s -c 'split("\\n") | map(select(length > 0))' 2>/dev/null)
      CHANGED_FILES_TYPE=\$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
      if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
        CHANGED_FILES_JSON="\$RAW_CHANGED_FILES_JSON"
      else
        DIFF_BLOCKER_MSG="changed_files diff produced invalid JSON; cannot report changed files"
      fi
    fi
    # Output: CHANGED_FILES_JSON and whether blocker was set
    echo "CHANGED_FILES_JSON=\$CHANGED_FILES_JSON"
    echo "BLOCKER=\${DIFF_BLOCKER_MSG:-}"
    cd .. && rm -rf test-invalid-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const lines = result.trim().split('\n');
  const changedLine = lines.find(l => l.startsWith('CHANGED_FILES_JSON='));
  const blockerLine = lines.find(l => l.startsWith('BLOCKER='));
  const changedFiles = changedLine ? changedLine.split('=')[1] : '';
  const blocker = blockerLine ? blockerLine.split('=')[1] : '';

  assert.equal(blocker, '', 'valid diff must not set blocker');
  const arr = JSON.parse(changedFiles);
  assert.ok(Array.isArray(arr), 'changed_files must be a valid JSON array');
  assert.ok(arr.includes('f1.txt'), 'must include the modified file');
});

runTest('Behavioral: invalid JSON from jq is rejected by array-type validation', () => {
  // Directly test the validation gate: feed invalid JSON to the same
  // type-check the workflow uses, confirm it is rejected
  const result = execSync(`
    RAW_CHANGED_FILES_JSON='not valid json at all'
    CHANGED_FILES_TYPE=$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
    if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
      echo -n "ACCEPTED"
    else
      echo -n "REJECTED"
    fi
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 5000 });

  assert.equal(result.trim(), 'REJECTED', 'array-type validation must reject invalid JSON');
});

runTest('Behavioral: valid JSON array passes array-type validation', () => {
  // Confirm that a properly formed array passes the type-check gate
  const result = execSync(`
    RAW_CHANGED_FILES_JSON='["file1.txt","file2.js"]'
    CHANGED_FILES_TYPE=$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
    if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
      echo -n "ACCEPTED"
    else
      echo -n "REJECTED"
    fi
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 5000 });

  assert.equal(result.trim(), 'ACCEPTED', 'array-type validation must accept a valid JSON array');
});

runTest('Behavioral: non-array valid JSON (e.g. null, object) is rejected by array-type validation', () => {
  // Confirm that valid JSON that is NOT an array is rejected,
  // which is exactly the gap that jq empty (without array-type check) would miss
  const result = execSync(`
    RAW_CHANGED_FILES_JSON='{"not":"an array"}'
    CHANGED_FILES_TYPE=$(printf '%s' "\$RAW_CHANGED_FILES_JSON" | jq -r 'type' 2>/dev/null || echo 'null')
    if [ "\$CHANGED_FILES_TYPE" = "array" ]; then
      echo -n "ACCEPTED"
    else
      echo -n "REJECTED"
    fi
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 5000 });

  assert.equal(result.trim(), 'REJECTED', 'array-type validation must reject valid non-array JSON');
});

// --- PERMITTED_PATHS format mismatch regression tests ---

runTest('main.yml orchestration context outputs permitted_paths as space-separated (not comma)', () => {
  const wfdIdx = raw.indexOf('Prepare orchestration context (workflow_dispatch)');
  const icIdx = raw.indexOf('Prepare orchestration context (issue_comment)');
  const wfdSection = raw.slice(wfdIdx, icIdx);
  const icSection = raw.slice(icIdx);
  const nextStep = icSection.indexOf('\n      - name:', 30);
  const icEnd = nextStep === -1 ? icSection.length : nextStep;

  assert.ok(wfdSection.includes("jq -r '.permitted_paths | join(\" \")'"),
    'workflow_dispatch orchestration context must use join(\" \") for permitted_paths (space-separated)');
  assert.ok(icSection.slice(0, icEnd).includes("jq -r '.permitted_paths | join(\" \")'"),
    'issue_comment orchestration context must use join(\" \") for permitted_paths (space-separated)');
});

runTest('main.yml orchestration context still uses comma-separated for capabilities (display-only)', () => {
  assert.ok(raw.includes("jq -r '.capabilities | join(\",\")'"),
    'capabilities output should remain comma-separated (used for display in prompt, not shell iteration)');
});

runTest('main.yml commit/push step does NOT use git add with 2>/dev/null || true (silent suppression)', () => {
  const commitIdx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  const section = raw.slice(commitIdx, resultIdx);

  assert.ok(!/git add.*2>\/dev\/null.*\|\| true/.test(section),
    'commit/push step must NOT silently suppress git add errors with 2>/dev/null || true');
});

runTest('main.yml commit/push step stages permitted_paths with fail-closed error detection', () => {
  const commitIdx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  const section = raw.slice(commitIdx, resultIdx);

  assert.ok(section.includes('STAGING_ERRORS'),
    'commit/push step must track staging errors');
  assert.ok(section.includes('Staging failed for one or more permitted_paths'),
    'commit/push step must fail-closed on staging failure');
});

runTest('main.yml commit/push step fails closed on empty staged set (no silent empty commit)', () => {
  const commitIdx = raw.indexOf('Commit and push Gemini changes (mode-aware:');
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  const section = raw.slice(commitIdx, resultIdx);

  assert.ok(!section.includes('::warning::No changes to commit'),
    'commit/push step must NOT use a warning-only path for empty staged set');
  assert.ok(section.includes('staged no changes within permitted_paths'),
    'commit/push step must fail-closed when no changes are staged within permitted_paths');
});

runTest('main.yml gemini_result step fails closed when no commit SHA produced in persistence mode', () => {
  const resultIdx = raw.indexOf('Determine Gemini execution result');
  const payloadIdx = raw.indexOf('Prepare ACP report payload');
  const section = raw.slice(resultIdx, payloadIdx);

  assert.ok(section.includes('no commit SHA was produced'),
    'gemini_result step must detect and fail when no commit SHA is produced in persistence mode');
});

runTest('Behavioral: space-separated permitted_paths iterates correctly over multiple paths', () => {
  const result = execSync(`
    git init -q test-paths-$$ && cd test-paths-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&

    PERMITTED_PATHS="docs/ai/research/ docs/ai/TASK_LOG.md"

    mkdir -p docs/ai/research
    echo "# Research" > docs/ai/research/test.md
    echo "log entry" > docs/ai/TASK_LOG.md

    STAGING_ERRORS=""
    for dir in $PERMITTED_PATHS; do
      if ! git add "$dir" 2>/dev/null; then
        STAGING_ERRORS="$STAGING_ERRORS $dir"
      fi
    done

    if [ -n "$STAGING_ERRORS" ]; then
      echo "STAGING_FAILED=1"
      echo "ERRORS=$STAGING_ERRORS"
    else
      echo "STAGING_FAILED=0"
    fi

    STAGED=$(git diff --cached --name-only)
    echo "STAGED_COUNT=$(echo "$STAGED" | grep -c .)"
    echo "$STAGED"

    cd .. && rm -rf test-paths-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  assert.ok(!result.includes('STAGING_FAILED=1'),
    'space-separated permitted_paths must stage successfully without staging errors');
  const stagedMatch = result.match(/STAGED_COUNT=(\d+)/);
  assert.ok(stagedMatch, 'must have staged count');
  assert.equal(parseInt(stagedMatch[1]), 2, 'must stage exactly 2 paths from space-separated list');
});

runTest('Behavioral: comma-separated permitted_paths causes silent failure (the original bug)', () => {
  const result = execSync(`
    git init -q test-comma-$$ && cd test-comma-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&

    # Simulate the OLD format: comma-separated (the bug)
    PERMITTED_PATHS="docs/ai/research/,docs/ai/TASK_LOG.md"

    mkdir -p docs/ai/research
    echo "# Research" > docs/ai/research/test.md
    echo "log entry" > docs/ai/TASK_LOG.md

    # OLD pattern with 2>/dev/null || true (silent suppression)
    for dir in $PERMITTED_PATHS; do
      git add "$dir" 2>/dev/null || true
    done

    STAGED=$(git diff --cached --name-only)
    echo "STAGED_COUNT=$(echo "$STAGED" | grep -c . 2>/dev/null || echo 0)"
    echo "STAGED=$STAGED"

    cd .. && rm -rf test-comma-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  const stagedMatch = result.match(/STAGED_COUNT=(\d+)/);
  assert.ok(stagedMatch, 'must have staged count');
  assert.equal(parseInt(stagedMatch[1]), 0,
    'comma-separated permitted_paths must stage ZERO files (reproduces the original bug)');
});

runTest('Behavioral: fail-closed staging detects git add errors (new behavior)', () => {
  const result = execSync(`
    git init -q test-failclosed-$$ && cd test-failclosed-$$ &&
    git config user.email t@t.com && git config user.name t &&
    git config --global --add safe.directory '*' &&

    PERMITTED_PATHS="nonexistent/path/file.md"

    STAGING_ERRORS=""
    for dir in $PERMITTED_PATHS; do
      if ! git add "$dir" 2>/dev/null; then
        STAGING_ERRORS="$STAGING_ERRORS $dir"
      fi
    done

    if [ -n "$STAGING_ERRORS" ]; then
      echo "STAGING_FAILED=1"
    else
      echo "STAGING_FAILED=0"
    fi

    cd .. && rm -rf test-failclosed-$$
  `, { encoding: 'utf8', cwd: os.tmpdir(), shell: 'bash', timeout: 15000 });

  assert.ok(result.includes('STAGING_FAILED=1'),
    'fail-closed staging must detect and report staging errors for nonexistent paths');
});
