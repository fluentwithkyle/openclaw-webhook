const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
  const re = /\(steps\.orchestration_context\.outputs\.task_mode \|\| 'REVIEW'\) == 'REVIEW'/;
  assert.ok(re.test(modeExpr), "expected (task_mode || 'REVIEW') == 'REVIEW' in the mode expression");
});

runTest('VERIFY_RECONCILE comparison also defaults empty task_mode to REVIEW', () => {
  assert.ok(modeExpr, 'mode expression missing');
  const re = /\(steps\.orchestration_context\.outputs\.task_mode \|\| 'REVIEW'\) == 'VERIFY_RECONCILE'/;
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

runTest('OWNER/MEMBER/COLLABORATOR authorization condition is present and intact', () => {
  assert.ok(raw.includes("contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]'), github.event.comment.author_association)"), 'authorization condition missing/changed');
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
  assert.ok(payloadSection.includes('"$GITHUB_EVENT_NAME" = "issue_comment"'), 'payload step should check GITHUB_EVENT_NAME for issue_comment');
  assert.ok(payloadSection.includes('steps.request_comment.outputs.request'), 'payload step should use request_comment output for issue_comment task');
  assert.ok(payloadSection.includes('github.repository'), 'payload step should use github.repository for issue_comment repository');
  assert.ok(payloadSection.includes('github.ref_name'), 'payload step should use github.ref_name for issue_comment base_branch');
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
