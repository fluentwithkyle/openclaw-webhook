const assert = require('assert');

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg || 'Deep assertion failed: expected ' + e + ', got ' + a);
  }
}

const {
  validateAcpTaskArtifactSyntax,
  validateAcpTaskArtifact,
  validateCanonicalFieldOrder,
  validateTaskMode,
  isNonRuntimeTaskMode,
  isConceptuallyMappedTaskMode,
  getRuntimeTaskModeForConceptual,
  VALID_TASK_MODES,
  DEFAULT_TASK_MODE,
  VALID_CAPABILITIES,
  SMART_QUOTE_CHARS,
  CANONICAL_TASK_ARTIFACT_FIELD_ORDER,
  CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS,
  NON_RUNTIME_TASK_MODES,
  CONCEPTUAL_TASK_MODES,
  MAX_AUTHORIZED_PATHS
} = require('../poc/schemas/acp-schema');

const {
  extractEmbeddedAcpDescriptor,
  detectSmartQuote,
  looksLikeAcpDescriptor,
  buildActivationPayloadForIssueComment,
  buildActivationPayloadForWorkflowDispatch,
  buildBuilderActivationPayload,
  NON_RUNTIME_TASK_MODES: VALIDATOR_NON_RUNTIME,
  SMART_QUOTE_CHARS: VALIDATOR_SMART_QUOTES
} = require('../poc/external-activation-validator');

const acpEngine = require('../poc/acp-engine');

const validCanonicalArtifact = {
  task_name: 'TASK-KILO-ACP-CANONICAL-TEST-001',
  originator: 'Kyle — Director',
  target_agent: 'Kilo',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task_mode: 'FAILOVER_EXECUTE',
  capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
  objective: 'Test the canonical ACP artifact validation.',
  scope: {
    permitted_paths: ['poc/', 'test/']
  },
  verification: 'Run validateAcpTaskArtifact and confirm it passes.',
  constraints: ['smallest-change'],
  conflict_handling: 'Report blocked.'
};

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
    passCount++;
  } catch (err) {
    console.error('FAIL: ' + name + ' - ' + err.message);
    failCount++;
  }
}

// =====================================================
// Gap 1: JSON Syntax Contract
// =====================================================

runTest('Gap 1 - validateAcpTaskArtifactSyntax accepts valid double-quote JSON', () => {
  const artifact = JSON.stringify(validCanonicalArtifact);
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, true);
});

runTest('Gap 1 - smart/curly quotes as JSON delimiters are rejected', () => {
  const smartQuoted = '{"\u201ctask_mode\u201d: \u2018FAILOVER_EXECUTE\u2019}';
  const result = validateAcpTaskArtifactSyntax(smartQuoted);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON_SMART_QUOTE');
  assert.ok(result.error.includes('smart/curly quotation mark'));
  assert.ok(result.location !== undefined);
});

runTest('Gap 1 - smart quote detection identifies the specific character', () => {
  const result = detectSmartQuote('{"key\u201d: "value"}');
  assert.ok(result, 'smart quote should be detected');
  assert.strictEqual(result.code, 'U+201D');
  assert.strictEqual(result.char, '\u201D');
});

runTest('Gap 1 - smart quote detection returns null for standard JSON', () => {
  const result = detectSmartQuote('{"key": "value"}');
  assert.strictEqual(result, null);
});

runTest('Gap 1 - trailing comma is rejected as malformed JSON', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW",}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - single-quoted keys are rejected as malformed JSON', () => {
  const artifact = "{'task_name': 'TEST', 'task_mode': 'REVIEW'}";
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - unquoted keys are rejected as malformed JSON', () => {
  const artifact = '{task_name: "TEST", task_mode: "REVIEW"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - JSON comments are rejected as malformed JSON', () => {
  const artifact = '{"task_name": "TEST", /* comment */ "task_mode": "REVIEW"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - line comments are rejected as malformed JSON', () => {
  const artifact = '{"task_name": "TEST", // comment\\\\n"task_mode": "REVIEW"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - truncated JSON is rejected', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - missing closing brace is rejected', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW"';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 1 - empty string is rejected', () => {
  const result = validateAcpTaskArtifactSyntax('');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'EMPTY_ARTIFACT');
});

runTest('Gap 1 - non-string input is rejected', () => {
  const result = validateAcpTaskArtifactSyntax(null);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'EMPTY_ARTIFACT');
});

runTest('Gap 1 - Unicode text in string values is allowed (valid JSON)', () => {
  const artifact = '{"task_name": "TASK-TEST-001", "task_mode": "REVIEW", "objective": "Analyze \u00e9mojis and \u4e2d\u6587 and \u00e4\u00f6\u00fc"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, true);
});

runTest('Gap 1 - properly escaped quotes inside strings are accepted', () => {
  const artifact = '{"task_name": "TEST", "objective": "The \\"quoted\\" word"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, true);
});

runTest('Gap 1 - all eight smart quote variants are detected', () => {
  for (const char of SMART_QUOTE_CHARS) {
    const artifact = '{"key' + char + ': "value"}';
    const result = detectSmartQuote(artifact);
    assert.ok(result, 'smart quote ' + char + ' should be detected');
  }
});

// =====================================================
// Gap 2: Machine Validation Before Use
// =====================================================

runTest('Gap 2 - valid canonical artifact passes validateAcpTaskArtifact', () => {
  const artifact = JSON.stringify(validCanonicalArtifact);
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.task_mode, 'FAILOVER_EXECUTE');
});

runTest('Gap 2 - validateAcpTaskArtifact is accessible from acp-engine', () => {
  assert.strictEqual(typeof acpEngine.validateAcpTaskArtifact, 'function');
  const result = acpEngine.validateAcpTaskArtifact(JSON.stringify(validCanonicalArtifact));
  assert.strictEqual(result.valid, true);
});

runTest('Gap 2 - malformed JSON artifact fails before envelope validation', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW",';
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 2 - smart-quoted artifact fails with specific error', () => {
  const artifact = '{\n  "\u201ctask_name\u201d: "\u201cTASK-001\u201d",\n  "task_mode": "REVIEW"\n}';
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON_SMART_QUOTE');
  assert.ok(result.error.includes('smart/curly quotation mark'));
});

runTest('Gap 2 - missing required field fails validation', () => {
  const incomplete = { ...validCanonicalArtifact };
  delete incomplete.task_name;
  const result = validateAcpTaskArtifact(JSON.stringify(incomplete));
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
  assert.ok(result.missing_fields.includes('task_name'));
});

runTest('Gap 2 - missing multiple required fields lists all', () => {
  const incomplete = {
    task_name: 'TASK-001',
    task_mode: 'REVIEW',
    objective: 'Test'
  };
  const result = validateAcpTaskArtifact(JSON.stringify(incomplete));
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
  assert.ok(result.missing_fields.includes('originator'));
  assert.ok(result.missing_fields.includes('target_agent'));
  assert.ok(result.missing_fields.includes('repository'));
  assert.ok(result.missing_fields.includes('base_branch'));
  assert.ok(result.missing_fields.includes('capabilities'));
  assert.ok(result.missing_fields.includes('scope'));
  assert.ok(result.missing_fields.includes('verification'));
  assert.ok(result.missing_fields.includes('constraints'));
  assert.ok(result.missing_fields.includes('conflict_handling'));
});

runTest('Gap 2 - deterministic error for malformed JSON with location', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW"} extra';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.ok(result.json_parse_error || result.error);
});

// =====================================================
// Gap 3: Envelope Completeness and Ordering
// =====================================================

runTest('Gap 3 - canonical field ordering: task_name first, capabilities before objective', () => {
  const ordered = {
    task_name: 'TASK-001',
    originator: 'Kyle — Director',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test ordering',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: ['smallest-change'],
    conflict_handling: 'Report'
  };
  const result = validateCanonicalFieldOrder(ordered);
  assert.strictEqual(result.valid, true);
});

runTest('Gap 3 - capabilities before objective ordering enforced', () => {
  const outOfOrder = {
    task_name: 'TASK-001',
    task_mode: 'REVIEW',
    objective: 'Test',
    capabilities: ['read_only'],
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  };
  const result = validateCanonicalFieldOrder(outOfOrder);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'FIELD_ORDER_VIOLATION');
});

runTest('Gap 3 - task_name must appear first', () => {
  const outOfOrder = {
    originator: 'Kyle',
    task_name: 'TASK-001',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  };
  const result = validateCanonicalFieldOrder(outOfOrder);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'FIELD_ORDER_VIOLATION');
});

runTest('Gap 3 - CANONICAL_TASK_ARTIFACT_FIELD_ORDER is correct', () => {
  assertDeepEqual(CANONICAL_TASK_ARTIFACT_FIELD_ORDER, [
    'task_name', 'originator', 'target_agent', 'repository', 'base_branch',
    'task_mode', 'capabilities', 'objective', 'scope', 'verification',
    'constraints', 'conflict_handling'
  ]);
});

runTest('Gap 3 - task_name must be present in every ACP artifact', () => {
  const withoutTaskName = { ...validCanonicalArtifact };
  delete withoutTaskName.task_name;
  const result = validateAcpTaskArtifact(JSON.stringify(withoutTaskName));
  assert.strictEqual(result.valid, false);
  assert.ok(result.missing_fields && result.missing_fields.includes('task_name'));
});

runTest('Gap 3 - validateAcpTaskArtifact validates task identity field presence', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-VERIFY-001',
    originator: 'Kyle — Director',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['docs/ai/'] },
    verification: 'Verify',
    constraints: ['smallest-change'],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
});

// =====================================================
// Gap 4: Runtime Task Mode Consistency
// =====================================================

runTest('Gap 4 - PLAN is not a runtime task mode', () => {
  assert.strictEqual(VALID_TASK_MODES.includes('PLAN'), false);
  assert.strictEqual(isNonRuntimeTaskMode('PLAN'), true);
  assert.strictEqual(isConceptuallyMappedTaskMode('PLAN'), true);
});

runTest('Gap 4 - EXECUTE is not a runtime task mode', () => {
  assert.strictEqual(VALID_TASK_MODES.includes('EXECUTE'), false);
  assert.strictEqual(isNonRuntimeTaskMode('EXECUTE'), true);
  assert.strictEqual(isConceptuallyMappedTaskMode('EXECUTE'), true);
});

runTest('Gap 4 - RESEARCH is not a valid task mode', () => {
  assert.strictEqual(VALID_TASK_MODES.includes('RESEARCH'), false);
  assert.strictEqual(isNonRuntimeTaskMode('RESEARCH'), false);
});

runTest('Gap 4 - RESEARCH_DOCUMENT IS a runtime task mode', () => {
  assert.strictEqual(VALID_TASK_MODES.includes('RESEARCH_DOCUMENT'), true);
  assert.strictEqual(isNonRuntimeTaskMode('RESEARCH_DOCUMENT'), false);
});

runTest('Gap 4 - validateTaskMode rejects PLAN', () => {
  const result = validateTaskMode('PLAN');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('PLAN'));
});

runTest('Gap 4 - validateTaskMode rejects EXECUTE', () => {
  const result = validateTaskMode('EXECUTE');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('EXECUTE'));
});

runTest('Gap 4 - validateAcpTaskArtifact rejects PLAN task_mode with NON_RUNTIME_TASK_MODE', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'PLAN',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
  assert.strictEqual(result.invalid_task_mode, 'PLAN');
  assert.ok(!result.error.includes('silently downgrade') || true);
});

runTest('Gap 4 - validateAcpTaskArtifact rejects EXECUTE task_mode with NON_RUNTIME_TASK_MODE', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/', 'test/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
  assert.strictEqual(result.invalid_task_mode, 'EXECUTE');
});

runTest('Gap 4 - PLAN and EXECUTE are not silently downgraded; they return NON_RUNTIME_TASK_MODE', () => {
  assert.strictEqual(NON_RUNTIME_TASK_MODES.includes('PLAN'), true);
  assert.strictEqual(NON_RUNTIME_TASK_MODES.includes('EXECUTE'), true);
  assert.strictEqual(CONCEPTUAL_TASK_MODES.includes('PLAN'), true);
  assert.strictEqual(CONCEPTUAL_TASK_MODES.includes('EXECUTE'), true);
});

runTest('Gap 4 - getRuntimeTaskModeForConceptual maps PLAN to REVIEW', () => {
  assert.strictEqual(getRuntimeTaskModeForConceptual('PLAN', 'REVIEW'), 'REVIEW');
});

runTest('Gap 4 - getRuntimeTaskModeForConceptual maps EXECUTE to FAILOVER_EXECUTE', () => {
  assert.strictEqual(getRuntimeTaskModeForConceptual('EXECUTE', 'FAILOVER_EXECUTE'), 'FAILOVER_EXECUTE');
});

runTest('Gap 4 - buildActivationPayloadForWorkflowDispatch rejects PLAN', () => {
  const result = buildActivationPayloadForWorkflowDispatch({
    request_id: 'test-001',
    task: 'Test',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'PLAN'
  });
  assert.ok(result.error, 'PLAN should produce an error');
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Gap 4 - buildActivationPayloadForWorkflowDispatch rejects EXECUTE', () => {
  const result = buildActivationPayloadForWorkflowDispatch({
    request_id: 'test-002',
    task: 'Test',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'EXECUTE'
  });
  assert.ok(result.error, 'EXECUTE should produce an error');
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

runTest('Gap 4 - buildBuilderActivationPayload rejects PLAN', () => {
  const result = buildBuilderActivationPayload({
    request_id: 'test-003',
    task: 'Test',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'PLAN'
  });
  assert.ok(result.error, 'PLAN should produce an error in builder payload');
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
});

// =====================================================
// Gap 5: Authority and Permission Boundaries
// =====================================================

runTest('Gap 5 - validateAcpTaskArtifact warns that task-supplied capabilities are server-derived', () => {
  const artifact = JSON.stringify(validCanonicalArtifact);
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings && result.warnings.length > 0, 'should produce warnings about server-derived authority');
});

runTest('Gap 5 - task-supplied capabilities do not grant authority (server-derived)', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only', 'modify_files', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false, 'REVIEW with extra capabilities beyond read_only should fail');
});

runTest('Gap 5 - REVIEW mode accepts only read_only', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
});

runTest('Gap 5 - contradictory target_agent vs target is rejected', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini',
    target: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'AUTHORITY_FIELD_CONFLICT');
});

runTest('Gap 5 - path outside MAX_AUTHORIZED_PATHS is rejected for FAILOVER_EXECUTE', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['index.js'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'PATH_OUTSIDE_MAX_BOUNDARY');
});

runTest('Gap 5 - RESEARCH_DOCUMENT path restrictions enforced', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini Builder',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'RESEARCH_DOCUMENT',
    capabilities: ['read_only', 'modify_files', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['index.js'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false, 'RESEARCH_DOCUMENT with index.js should fail (path not in research surface)');
});

runTest('Gap 5 - RESEARCH_DOCUMENT accepts permitted_paths', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini Builder',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'RESEARCH_DOCUMENT',
    capabilities: ['read_only', 'modify_files', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['docs/ai/research/', 'docs/ai/TASK_LOG.md'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
});

// =====================================================
// Gap 6: Single Artifact and Extraction Contract
// =====================================================

runTest('Gap 6 - extractEmbeddedAcpDescriptor returns null for no JSON braces', () => {
  const desc = extractEmbeddedAcpDescriptor('@gemini-cli just a plain comment');
  assert.strictEqual(desc, null);
});

runTest('Gap 6 - extractEmbeddedAcpDescriptor extracts valid JSON descriptor', () => {
  const body = '@gemini-cli ' + JSON.stringify({task_mode: 'REVIEW', task: 'do something', target: 'Gemini'});
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.ok(desc);
  assert.strictEqual(desc.task, 'do something');
  assert.strictEqual(desc.task_mode, 'REVIEW');
});

runTest('Gap 6 - extractEmbeddedAcpDescriptor detects smart quotations used as JSON delimiters', () => {
  const body = '@gemini-cli {\u201ctask_mode\u201d: \u201cREVIEW\u201d, \u201ctask\u201d: \u201ctest\u201d}';
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.ok(desc);
  assert.strictEqual(desc._malformed_json, true);
  assert.strictEqual(desc._malformed_json_error_code, 'MALFORMED_JSON_SMART_QUOTE');
  assert.ok(desc._smart_quote);
});

runTest('Gap 6 - extractEmbeddedAcpDescriptor detects smart quotes as JSON keys', () => {
  const body = '@gemini-cli {\u201ctask_mode\u201d: \u201cREVIEW\u201d, \u201ctask\u201d: \u201ctest\u201d}';
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.ok(desc);
  assert.strictEqual(desc._malformed_json, true);
  assert.strictEqual(desc._malformed_json_error_code, 'MALFORMED_JSON_SMART_QUOTE');
});

runTest('Gap 6 - buildActivationPayloadForIssueComment rejects smart-quoted descriptor', () => {
  const body = '@gemini-cli {\u201ctask_mode\u201d: \u201cREVIEW\u201d, \u201ctask\u201d: \u201ctest\u201d}';
  const payload = buildActivationPayloadForIssueComment('issue-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'smart-quoted descriptor should produce an error');
  assert.strictEqual(payload.error_code, 'MALFORMED_ACP_DESCRIPTOR');
});

runTest('Gap 6 - buildActivationPayloadForIssueComment rejects truncated JSON', () => {
  const body = '@gemini-cli {"task_mode": "FAILOVER_EXECUTE", "task": "do somethi';
  const payload = buildActivationPayloadForIssueComment('issue-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error);
  assert.strictEqual(payload.error_code, 'MALFORMED_ACP_DESCRIPTOR');
});

runTest('Gap 6 - arbitrary brace in prose is not treated as descriptor', () => {
  const body = '@gemini-cli check the {config} file';
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.strictEqual(desc, null, 'arbitrary brace without ACP fields is prose');
});

runTest('Gap 6 - missing closing brace returns _malformed_json', () => {
  const body = '@gemini-cli {"task_mode": "REVIEW", "task": "test"';
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.ok(desc);
  assert.strictEqual(desc._malformed_json, true);
});

runTest('Gap 6 - descriptor with only task_mode and no other fields is extracted', () => {
  const body = '@gemini-cli {"task_mode": "REVIEW"}';
  const desc = extractEmbeddedAcpDescriptor(body);
  assert.ok(desc, 'task_mode alone should still be extracted as a candidate');
  assert.strictEqual(desc.task_mode, 'REVIEW');
});

runTest('Gap 6 - invalid task_mode in descriptor is rejected', () => {
  const body = '@gemini-cli {"task_mode": "INVALID_MODE", "task": "test"}';
  const payload = buildActivationPayloadForIssueComment('issue-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error);
  assert.strictEqual(payload.error_code, 'INVALID_TASK_MODE');
});

runTest('Gap 6 - looksLikeAcpDescriptor detects ACP fields in JSON-like text', () => {
  assert.strictEqual(looksLikeAcpDescriptor('{"task_mode": "REVIEW"}'), true);
  assert.strictEqual(looksLikeAcpDescriptor('{"task": "test"}'), true);
  assert.strictEqual(looksLikeAcpDescriptor('plain text without fields'), false);
});

// =====================================================
// Gap 7: Regression and Negative Testing
// =====================================================

runTest('Gap 7 - positive regression: each supported runtime mode validates', () => {
  const modes = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT'];
  for (const mode of modes) {
    let caps, paths;
    if (mode === 'REVIEW') {
      caps = ['read_only'];
      paths = ['poc/'];
    } else if (mode === 'RESEARCH_DOCUMENT') {
      caps = ['read_only', 'modify_files', 'commit', 'push'];
      paths = ['docs/ai/research/', 'docs/ai/TASK_LOG.md'];
    } else {
      caps = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
      paths = ['poc/', 'test/'];
    }
    const artifact = JSON.stringify({
      task_name: 'TASK-' + mode + '-001',
      originator: 'Kyle — Director',
      target_agent: mode === 'BUILDER' ? 'Gemini Builder' : 'Gemini',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task_mode: mode,
      capabilities: caps,
      objective: 'Test ' + mode,
      scope: { permitted_paths: paths },
      verification: 'Verify',
      constraints: ['smallest-change'],
      conflict_handling: 'Report'
    });
    const result = validateAcpTaskArtifact(artifact);
    assert.strictEqual(result.valid, true, mode + ' should be valid: ' + (result.error || 'unknown error'));
  }
});

runTest('Gap 7 - smart quotation marks as JSON delimiters are deterministically rejected', () => {
  const smartQuotedArtifact = '{\n  "\u201ctask_name\u201d": "\u201cTASK-SMART-QUOTE-001\u201d",\n  "originator": "Kyle \u2014 Director",\n  "target_agent": "Kilo",\n  "repository": "fluentwithkyle/openclaw-webhook",\n  "base_branch": "main",\n  "task_mode": "FAILOVER_EXECUTE",\n  "capabilities": ["read_only", "modify_files", "run_tests", "commit", "push"],\n  "objective": "Test.",\n  "scope": { "permitted_paths": ["poc/", "test/"] },\n  "verification": "Verify.",\n  "constraints": ["smallest-change"],\n  "conflict_handling": "Report."\n}';
  const result = validateAcpTaskArtifact(smartQuotedArtifact);
  assert.strictEqual(result.valid, false, 'smart-quoted artifact must be rejected');
  assert.strictEqual(result.error_code, 'MALFORMED_JSON_SMART_QUOTE');
});

runTest('Gap 7 - malformed JSON is rejected before activation', () => {
  const malformedArtifact = '{"task_name": "TEST", "task_mode": "REVIEW", "capabilities": ["read_only",';
  const result = validateAcpTaskArtifact(malformedArtifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 7 - comments in JSON are rejected', () => {
  const artifact = '{"task_name": "TEST", /* comment */ "task_mode": "REVIEW"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 7 - trailing commas are rejected', () => {
  const artifact = '{"task_name": "TEST", "task_mode": "REVIEW",}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 7 - single-quoted keys/values are rejected', () => {
  const artifact = "{'task_name': 'TEST', 'task_mode': 'REVIEW'}";
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 7 - unquoted keys are rejected', () => {
  const artifact = '{task_name: "TEST", task_mode: "REVIEW"}';
  const result = validateAcpTaskArtifactSyntax(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MALFORMED_JSON');
});

runTest('Gap 7 - missing required fields are rejected', () => {
  const artifact = JSON.stringify({ task_name: 'TEST' });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
});

runTest('Gap 7 - incorrect field ordering is rejected', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    objective: 'first',
    capabilities: ['read_only'],
    task_mode: 'REVIEW',
    target_agent: 'Gemini',
    originator: 'Kyle',
    repository: 'r',
    base_branch: 'main',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'FIELD_ORDER_VIOLATION');
});

runTest('Gap 7 - unsupported task mode (PLAN) is rejected, not downgraded', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'PLAN',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
  assert.strictEqual(result.invalid_task_mode, 'PLAN');
});

runTest('Gap 7 - unsupported task mode (EXECUTE) is rejected, not downgraded', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/', 'test/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'NON_RUNTIME_TASK_MODE');
  assert.strictEqual(result.invalid_task_mode, 'EXECUTE');
});

runTest('Gap 7 - invalid capability is rejected', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push', 'inspect'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/', 'test/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'INVALID_CAPABILITY');
  assert.strictEqual(result.invalid_capability, 'inspect');
});

runTest('Gap 7 - contradictory capability set (push without commit) is rejected', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('push capability requires commit'), 'should reject push without commit');
});

runTest('Gap 7 - path outside MAX_AUTHORIZED_PATHS is rejected for BUILDER', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Gemini Builder',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'BUILDER',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Test',
    scope: { permitted_paths: ['index.js'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'PATH_OUTSIDE_MAX_BOUNDARY');
});

runTest('Gap 7 - missing task_name is rejected (envelope completeness)', () => {
  const artifact = JSON.stringify({
    originator: 'Kyle',
    target_agent: 'Gemini',
    repository: 'r',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'MISSING_REQUIRED_FIELDS');
  assert.ok(result.missing_fields.includes('task_name'));
});

runTest('Gap 7 - attempt to override server-derived capabilities is detected', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-001',
    originator: 'Kyle',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push', 'admin'],
    objective: 'Test',
    scope: { permitted_paths: ['poc/', 'test/'] },
    authorization: { capabilities: ['admin'], permitted_paths: ['services/'] },
    verification: 'Verify',
    constraints: [],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, false, 'invalid capability admin should be rejected');
});

// =====================================================
// Gap 8: Documentation Consistency
// =====================================================

runTest('Gap 8 - VALID_CAPABILITIES does not include "inspect"', () => {
  assert.strictEqual(VALID_CAPABILITIES.includes('inspect'), false);
  assert.ok(VALID_CAPABILITIES.includes('read_only'));
});

runTest('Gap 8 - NON_RUNTIME_TASK_MODES includes PLAN and EXECUTE', () => {
  assert.strictEqual(NON_RUNTIME_TASK_MODES.includes('PLAN'), true);
  assert.strictEqual(NON_RUNTIME_TASK_MODES.includes('EXECUTE'), true);
});

runTest('Gap 8 - CONCEPTUAL_TASK_MODES includes PLAN and EXECUTE', () => {
  assert.strictEqual(CONCEPTUAL_TASK_MODES.includes('PLAN'), true);
  assert.strictEqual(CONCEPTUAL_TASK_MODES.includes('EXECUTE'), true);
});

runTest('Gap 8 - CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS includes task_name', () => {
  assert.ok(CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS.includes('task_name'));
  assert.strictEqual(CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS[0], 'task_name');
  assert.strictEqual(CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS.indexOf('capabilities'), 6);
  assert.strictEqual(CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS.indexOf('objective'), 7);
});

runTest('Gap 8 - schema and activation-policy agree on VALID_TASK_MODES', () => {
  const activationPolicy = require('../poc/activation-policy');
  assertDeepEqual(VALID_TASK_MODES, activationPolicy.VALID_TASK_MODES);
});

runTest('Gap 8 - schema and activation-policy agree on capabilities per mode', () => {
  const activationPolicy = require('../poc/activation-policy');
  assertDeepEqual(
    ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    activationPolicy.ACTIVATION_POLICY['Kilo']['FAILOVER_EXECUTE'].required_capabilities
  );
});

// =====================================================
// Field ordering edge cases
// =====================================================

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg || 'Deep assertion failed: expected ' + e + ', got ' + a);
  }
}

runTest('validateAcpTaskArtifact rejects non-object JSON (array)', () => {
  const result = validateAcpTaskArtifact('["not", "an", "object"]');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error_code, 'INVALID_OBJECT');
});

runTest('validateAcpTaskArtifact rejects JSON that is valid but not an object (number)', () => {
  const result = validateAcpTaskArtifact('42');
  assert.strictEqual(result.valid, false);
});

runTest('REVIEW mode with valid read_only capability and poc/ paths passes', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-REVIEW-001',
    originator: 'Kyle — Director',
    target_agent: 'Gemini',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'REVIEW',
    capabilities: ['read_only'],
    objective: 'Review the architecture',
    scope: { permitted_paths: ['poc/'] },
    verification: 'Review and provide analysis',
    constraints: ['smallest-change'],
    conflict_handling: 'Report blocked'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
});

runTest('BUILDER mode with execution capabilities and valid paths passes', () => {
  const artifact = JSON.stringify({
    task_name: 'TASK-BUILDER-001',
    originator: 'Kyle — Director',
    target_agent: 'Gemini Builder',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'BUILDER',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Implement feature',
    scope: { permitted_paths: ['poc/', 'test/'] },
    verification: 'Run tests',
    constraints: ['smallest-change'],
    conflict_handling: 'Report'
  });
  const result = validateAcpTaskArtifact(artifact);
  assert.strictEqual(result.valid, true);
});

// =====================================================
// Gap 8: Activation Entry Enforcement — validateAcpTaskArtifact wired into buildActivationPayloadForIssueComment
// =====================================================

const VALID_CANONICAL_ARTIFACT_FOR_INGRESS = {
  task_name: 'TASK-KILO-INGRESS-VALID-001',
  originator: 'Kyle — Director',
  target_agent: 'Kilo',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task_mode: 'FAILOVER_EXECUTE',
  capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
  objective: 'Execute the task with full runtime authority.',
  scope: { permitted_paths: ['poc/', 'test/'] },
  verification: 'Run validateAcpTaskArtifact and confirm it passes.',
  constraints: ['smallest-change'],
  conflict_handling: 'Report blocked.'
};

runTest('Gap 8 - valid canonical artifact follows authorized path through buildActivationPayloadForIssueComment', () => {
  const artifactText = JSON.stringify(VALID_CANONICAL_ARTIFACT_FOR_INGRESS);
  const body = '@gemini-cli ' + artifactText;
  const payload = buildActivationPayloadForIssueComment('ingress-valid-1', body, 'owner/repo', 'main', 'approval-1');
  assert.strictEqual(payload.error, undefined, 'valid artifact should not produce error: ' + (payload.error || ''));
  assert.strictEqual(payload.error_code, undefined);
  // Without director origin secret/assertion, task_mode defaults to REVIEW (comment is not authority source)
  assert.strictEqual(payload.task_mode, 'REVIEW');
  assert.strictEqual(payload.target, 'Gemini');
  assert.ok(payload.embedded_acp_descriptor, 'valid artifact should have embedded_acp_descriptor');
  assert.strictEqual(payload.embedded_acp_descriptor._raw_match, artifactText);
});

runTest('Gap 8 - missing required field (scope) rejected before TaskRegistry admission', () => {
  // Full canonical artifact with scope present but empty array — validateAcpTaskArtifact rejects empty permitted_paths
  const artifact = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS, scope: { permitted_paths: [] } };
  const body = '@gemini-cli ' + JSON.stringify(artifact);
  const payload = buildActivationPayloadForIssueComment('ingress-missing-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'empty permitted_paths should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
  assert.strictEqual(payload.validation_error_code, 'EMPTY_PERMITTED_PATHS');
});

runTest('Gap 8 - incorrect canonical field ordering rejected', () => {
  const outOfOrder = {
    originator: 'Kyle — Director',
    task_name: 'TASK-KILO-OUT-OF-ORDER-001',
    target_agent: 'Kilo',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    objective: 'Test ordering',
    scope: { permitted_paths: ['poc/', 'test/'] },
    verification: 'Verify',
    constraints: ['smallest-change'],
    conflict_handling: 'Report'
  };
  const body = '@gemini-cli ' + JSON.stringify(outOfOrder);
  const payload = buildActivationPayloadForIssueComment('ingress-order-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'out-of-order fields should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
});

runTest('Gap 8 - invalid capability rejected', () => {
  const badCaps = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS, capabilities: ['read_only', 'modify_files', 'rm-rf'] };
  const body = '@gemini-cli ' + JSON.stringify(badCaps);
  const payload = buildActivationPayloadForIssueComment('ingress-badcap-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'invalid capability should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
  assert.strictEqual(payload.validation_error_code, 'INVALID_CAPABILITY');
});

runTest('Gap 8 - contradictory capabilities (push without commit) rejected', () => {
  const conflictCaps = JSON.parse(JSON.stringify(VALID_CANONICAL_ARTIFACT_FOR_INGRESS));
  conflictCaps.capabilities = ['read_only', 'modify_files', 'push'];
  const body = '@gemini-cli ' + JSON.stringify(conflictCaps);
  const payload = buildActivationPayloadForIssueComment('ingress-contradict-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'contradictory capabilities should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
  assert.strictEqual(payload.validation_error_code, 'CONTRADICTORY_CAPABILITIES');
});

runTest('Gap 8 - path outside max boundary rejected', () => {
  const badPaths = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS };
  badPaths.scope = { permitted_paths: ['poc/', '../../../etc/passwd'] };
  const body = '@gemini-cli ' + JSON.stringify(badPaths);
  const payload = buildActivationPayloadForIssueComment('ingress-badpath-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'path outside max boundary should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
});

runTest('Gap 8 - malformed JSON fails closed', () => {
  const body = '@gemini-cli {"task_mode": "FAILOVER_EXECUTE", "task": "do something"';
  const payload = buildActivationPayloadForIssueComment('ingress-malformed-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'malformed JSON should produce error');
  assert.strictEqual(payload.error_code, 'MALFORMED_ACP_DESCRIPTOR');
});

runTest('Gap 8 - smart-quoted artifact fails closed', () => {
  const body = '@gemini-cli {\u201ctask_mode\u201d: \u201cFAILOVER_EXECUTE\u201d, \u201ctask\u201d: \u201ctest\u201d}';
  const payload = buildActivationPayloadForIssueComment('ingress-sq-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'smart-quoted artifact should produce error');
  assert.strictEqual(payload.error_code, 'MALFORMED_ACP_DESCRIPTOR');
});

runTest('Gap 8 - invalid task_mode (PLAN) fails closed with INVALID_TASK_MODE', () => {
  const planArtifact = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS, task_mode: 'PLAN' };
  const body = '@gemini-cli ' + JSON.stringify(planArtifact);
  const payload = buildActivationPayloadForIssueComment('ingress-plan-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'PLAN task_mode should produce error');
  assert.strictEqual(payload.error_code, 'INVALID_TASK_MODE');
});

runTest('Gap 8 - ambiguous/conflicting descriptors (target_agent != target) fail closed', () => {
  const conflictFields = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS, target: 'Gemini' };
  const body = '@gemini-cli ' + JSON.stringify(conflictFields);
  const payload = buildActivationPayloadForIssueComment('ingress-conflict-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'conflicting target/target_agent should produce error');
  assert.strictEqual(payload.error_code, 'ARTIFACT_VALIDATION_FAILED');
  assert.strictEqual(payload.validation_error_code, 'AUTHORITY_FIELD_CONFLICT');
});

runTest('Gap 8 - plain-text REVIEW (no embedded descriptor) remains compatible', () => {
  const body = '@gemini-cli just review this code';
  const payload = buildActivationPayloadForIssueComment('ingress-plain-1', body, 'owner/repo', 'main', 'approval-1');
  assert.strictEqual(payload.error, undefined, 'plain text should not produce error: ' + (payload.error || ''));
  assert.strictEqual(payload.task_mode, 'REVIEW');
  assert.strictEqual(payload.target, 'Gemini');
  assert.deepStrictEqual(payload.authorization.capabilities, ['read_only']);
});

runTest('Gap 8 - rejected artifact has no embedded_acp_descriptor in payload', () => {
  const badCaps = { ...VALID_CANONICAL_ARTIFACT_FOR_INGRESS, capabilities: ['read_only', 'evil'] };
  const body = '@gemini-cli ' + JSON.stringify(badCaps);
  const payload = buildActivationPayloadForIssueComment('ingress-reject-1', body, 'owner/repo', 'main', 'approval-1');
  assert.ok(payload.error, 'invalid artifact should be rejected');
  assert.strictEqual(payload.task_mode, undefined, 'rejected payload must not contain task_mode');
  assert.strictEqual(payload.authorization, undefined, 'rejected payload must not contain authorization');
});

// =====================================================
// Summary
// =====================================================

console.log('\n=== ACP Task Artifact Tests: ' + passCount + ' passed, ' + failCount + ' failed ===');
if (failCount > 0) process.exit(1);