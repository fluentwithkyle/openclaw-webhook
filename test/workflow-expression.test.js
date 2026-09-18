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

console.log(`\n=== Workflow Expression Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
