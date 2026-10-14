const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
    validateAcpTaskArtifact,
    validateAcpTaskArtifactSyntax,
    validateCanonicalFieldOrder,
    getRuntimeTaskModeForConceptual,
    CANONICAL_TASK_ARTIFACT_FIELD_ORDER,
    CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS,
    CONCEPTUAL_TASK_MODES,
    VALID_CAPABILITIES,
    VALID_AGENTS,
    EXECUTION_TASK_MODES,
    MAX_AUTHORIZED_PATHS
} = require('./schemas/acp-schema');
const { isPathWithinMaxBoundary } = require('./activation-policy');

const ROOT_DIR = path.join(__dirname, '..');

const SMART_QUOTE_REPLACEMENTS = [
    ['\u2018', "'"],
    ['\u2019', "'"],
    ['\u201A', "'"],
    ['\u201B', "'"],
    ['\u201C', '"'],
    ['\u201D', '"'],
    ['\u201E', '"'],
    ['\u201F', '"']
];

const SMART_DASH_REPLACEMENTS = [
    ['\u2013', '--'],
    ['\u2014', '--']
];

function serializeCanonicalTaskArtifact(taskObj) {
    const ordered = {};
    for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (Object.prototype.hasOwnProperty.call(taskObj, field)) {
            ordered[field] = taskObj[field];
        }
    }
    for (const [key, value] of Object.entries(taskObj)) {
        if (!CANONICAL_TASK_ARTIFACT_FIELD_ORDER.includes(key)) {
            ordered[key] = value;
        }
    }
    return JSON.stringify(ordered, null, 2);
}

const CARRIER_STATES = Object.freeze({
    CARRIER_NOT_FOUND: 'CARRIER_NOT_FOUND',
    CARRIER_FOUND: 'CARRIER_FOUND',
    CARRIER_TASK_MISMATCH: 'CARRIER_TASK_MISMATCH',
    CARRIER_READY: 'CARRIER_READY',
    EXECUTION_STARTED: 'EXECUTION_STARTED',
    EXECUTION_VERIFIED: 'EXECUTION_VERIFIED',
    CARRIER_ARTIFACT_INVALID: 'CARRIER_ARTIFACT_INVALID',
    CARRIER_ARTIFACT_VALID: 'CARRIER_ARTIFACT_VALID'
});

const VALID_ONE_CLICK_WORKFLOWS = [
    'one-click-gemini-activation-verify-reconcile.yml',
    'one-click-gemini-builder-smoke.yml',
    'one-click-gemini-builder-callback-correlation.yml',
    'one-click-gemini-research-documentation.yml',
    'one-click-kilo-acp-copy-safe.yml'
];

function extractEmbeddedCarrierArtifact(workflowRaw) {
    if (!workflowRaw || typeof workflowRaw !== 'string') return null;

    const heredocMatch = workflowRaw.match(/<<'TASK_EOF'([\s\S]*?)TASK_EOF/);
    if (heredocMatch) {
        return heredocMatch[1].trim();
    }

    const backtickMatch = workflowRaw.match(/TASK=`([\s\S]*?)`/);
    if (backtickMatch) {
        return backtickMatch[1].trim();
    }

    const idx = workflowRaw.indexOf("TASK='");
    if (idx !== -1) {
        const start = idx + 6;
        let pos = start;
        while (pos < workflowRaw.length) {
            const char = workflowRaw[pos];
            if (char === "'") {
                const rest = workflowRaw.substring(pos + 1, pos + 5);
                if (rest.match(/^\S/) || rest === '' || rest.startsWith('\n')) {
                    return workflowRaw.substring(start, pos).trim();
                }
            }
            pos++;
        }
    }

    return null;
}

function validateOneClickCarrier(workflowRaw, requestedTask) {
    const embeddedText = extractEmbeddedCarrierArtifact(workflowRaw);
    if (!embeddedText) {
        return {
            valid: false,
            error: 'No embedded ACP task artifact found in workflow',
            error_code: 'CARRIER_NO_EMBEDDED_ARTIFACT',
            carrier_state: CARRIER_STATES.CARRIER_NOT_FOUND
        };
    }

    const syntaxValidation = validateAcpTaskArtifactSyntax(embeddedText);
    if (!syntaxValidation.valid) {
        return {
            valid: false,
            error: syntaxValidation.error,
            error_code: syntaxValidation.error_code,
            ...(syntaxValidation.error_code === 'MALFORMED_JSON_SMART_QUOTE' ? { smart_quote: syntaxValidation } : {}),
            ...(syntaxValidation.error_code === 'MALFORMED_JSON' ? { json_parse_error: syntaxValidation.json_parse_error } : {}),
            canonical_artifact: embeddedText,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding: requestedTask ? bindCarrierToRequestedTask(null, requestedTask) : { bound: false, reason: 'No requested task provided' }
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(embeddedText);
    } catch (e) {
        return {
            valid: false,
            error: 'JSON parse failed: ' + e.message,
            error_code: 'JSON_PARSE_FAILED',
            canonical_artifact: embeddedText,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding: requestedTask ? bindCarrierToRequestedTask(null, requestedTask) : { bound: false, reason: 'No requested task provided' }
        };
    }

    const orderValidation = validateCanonicalFieldOrder(parsed);
    if (!orderValidation.valid) {
        return {
            valid: false,
            error: orderValidation.error,
            error_code: orderValidation.error_code,
            field_order_violation: orderValidation.field_order_violation,
            canonical_artifact: embeddedText,
            parsed_artifact: parsed,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding: requestedTask ? bindCarrierToRequestedTask(parsed, requestedTask) : { bound: false, reason: 'No requested task provided' }
        };
    }

    const validation = validateAcpTaskArtifact(embeddedText);

    const binding = requestedTask ? bindCarrierToRequestedTask(parsed, requestedTask) : { bound: false, reason: 'No requested task provided' };

    if (!validation.valid) {
        return {
            valid: false,
            error: validation.error,
            error_code: validation.error_code,
            ...(validation.error_code === 'FIELD_ORDER_VIOLATION' ? { field_order_violation: validation.field_order_violation } : {}),
            ...(validation.missing_fields ? { missing_fields: validation.missing_fields } : {}),
            ...(validation.invalid_capability ? { invalid_capability: validation.invalid_capability } : {}),
            ...(validation.invalid_task_mode ? { invalid_task_mode: validation.invalid_task_mode } : {}),
            canonical_artifact: embeddedText,
            parsed_artifact: parsed,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding
        };
    }

    return {
        valid: true,
        task_mode: validation.task_mode,
        warnings: validation.warnings,
        canonical_artifact: embeddedText,
        parsed_artifact: parsed,
        carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID,
        binding
    };
}

function bindCarrierToRequestedTask(parsed, requestedTask) {
    if (!requestedTask) {
        return { bound: false, reason: 'No requested task provided' };
    }

    if (!parsed) {
        return { bound: false, reason: 'No parsed artifact' };
    }

    const checks = [
        { field: 'task_name', match: parsed.task_name === requestedTask.task_name },
        { field: 'target_agent', match: parsed.target_agent === requestedTask.target_agent },
        { field: 'repository', match: parsed.repository === requestedTask.repository }
    ];

    const mismatches = checks.filter(c => !c.match).map(c => c.field);

    if (mismatches.length === 0) {
        return { bound: true, reason: 'Embedded carrier matches requested task' };
    }

    return {
        bound: false,
        reason: 'Carrier mismatch: ' + mismatches.join(', '),
        mismatches
    };
}

function listOneClickWorkflows() {
    return VALID_ONE_CLICK_WORKFLOWS.slice();
}

function repairEmbeddedArtifact(artifactText) {
    let repaired = artifactText;
    let repairsApplied = [];

    for (const [smartChar, replacement] of SMART_QUOTE_REPLACEMENTS) {
        const count = (repaired.match(new RegExp(smartChar, 'g')) || []).length;
        if (count > 0) {
            repaired = repaired.split(smartChar).join(replacement);
            repairsApplied.push({
                defect: 'MALFORMED_JSON_SMART_QUOTE',
                char_replaced: 'U+' + smartChar.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
                count: count
            });
        }
    }

    for (const [smartChar, replacement] of SMART_DASH_REPLACEMENTS) {
        const count = (repaired.match(new RegExp(smartChar, 'g')) || []).length;
        if (count > 0) {
            repaired = repaired.split(smartChar).join(replacement);
            repairsApplied.push({
                defect: 'NON_ASCII_PUNCTUATION',
                char_replaced: 'U+' + smartChar.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
                count: count
            });
        }
    }

    if (repairsApplied.length === 0) {
        let parsed;
        try {
            parsed = JSON.parse(repaired);
        } catch (e) {
            return { repaired: null, repairsApplied: [], error: 'Cannot parse artifact for repair: ' + e.message, error_code: 'MALFORMED_JSON' };
        }

        const orderValidation = validateCanonicalFieldOrder(parsed);
        if (!orderValidation.valid) {
            const reordered = {};
            for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
                if (Object.prototype.hasOwnProperty.call(parsed, field)) {
                    reordered[field] = parsed[field];
                }
            }
            for (const [key, value] of Object.entries(parsed)) {
                if (!CANONICAL_TASK_ARTIFACT_FIELD_ORDER.includes(key)) {
                    reordered[key] = value;
                }
            }
            repaired = JSON.stringify(reordered, null, 2);
            repairsApplied.push({
                defect: 'FIELD_ORDER_VIOLATION',
                repair: 'Reordered fields to canonical order'
            });
        }

        return {
            repaired: repaired,
            repairsApplied: repairsApplied.length > 0 ? repairsApplied : [],
            error: null
        };
    }

    return { repaired: repaired, repairsApplied: repairsApplied, error: null };
}

function validateRepairedArtifact(repairedText, requestedTask) {
    const validation = validateAcpTaskArtifact(repairedText);
    const parsed = (() => {
        try { return JSON.parse(repairedText); } catch (e) { return null; }
    })();
    const binding = requestedTask ? bindCarrierToRequestedTask(parsed, requestedTask) : { bound: false, reason: 'No requested task provided' };

    if (!validation.valid) {
        return {
            valid: false,
            error: validation.error,
            error_code: validation.error_code,
            ...(validation.error_code === 'FIELD_ORDER_VIOLATION' ? { field_order_violation: validation.field_order_violation } : {}),
            ...(validation.missing_fields ? { missing_fields: validation.missing_fields } : {}),
            ...(validation.invalid_capability ? { invalid_capability: validation.invalid_capability } : {}),
            ...(validation.invalid_task_mode ? { invalid_task_mode: validation.invalid_task_mode } : {}),
            canonical_artifact: repairedText,
            parsed_artifact: parsed,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding
        };
    }

    return {
        valid: true,
        task_mode: validation.task_mode,
        warnings: validation.warnings,
        canonical_artifact: repairedText,
        parsed_artifact: parsed,
        carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID,
        binding
    };
}

function repairAndRevalidateOneClickCarrier(workflowRaw, requestedTask) {
    const extractResult = extractEmbeddedCarrierArtifact(workflowRaw);
    if (!extractResult) {
        return {
            valid: false,
            error: 'No embedded ACP task artifact found in workflow',
            error_code: 'CARRIER_NO_EMBEDDED_ARTIFACT',
            carrier_state: CARRIER_STATES.CARRIER_NOT_FOUND,
            repaired: false,
            repairsApplied: null
        };
    }

    const syntaxCheck = validateAcpTaskArtifactSyntax(extractResult);
    if (!syntaxCheck.valid) {
        const repairResult = repairEmbeddedArtifact(extractResult);
        if (repairResult.error || !repairResult.repaired) {
            return {
                valid: false,
                error: syntaxCheck.error,
                error_code: syntaxCheck.error_code,
                ...(syntaxCheck.error_code === 'MALFORMED_JSON_SMART_QUOTE' ? { smart_quote: syntaxCheck } : {}),
                carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
                repaired: false,
                repairsApplied: null,
                canonical_artifact: extractResult
            };
        }

        const repairedSyntax = validateAcpTaskArtifactSyntax(repairResult.repaired);
        if (!repairedSyntax.valid) {
            return {
                valid: false,
                error: repairedSyntax.error,
                error_code: repairedSyntax.error_code,
                carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
                repaired: false,
                repairsApplied: null,
                canonical_artifact: extractResult
            };
        }

        const revalidation = validateRepairedArtifact(repairResult.repaired, requestedTask);
        return {
            ...revalidation,
            repaired: true,
            repairsApplied: repairResult.repairsApplied,
            original_artifact: extractResult
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(extractResult);
    } catch (e) {
        const repairResult = repairEmbeddedArtifact(extractResult);
        if (repairResult.error || !repairResult.repaired) {
            return {
                valid: false,
                error: 'JSON parse failed: ' + e.message,
                error_code: 'JSON_PARSE_FAILED',
                carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
                repaired: false,
                repairsApplied: null,
                canonical_artifact: extractResult
            };
        }

        const revalidation = validateRepairedArtifact(repairResult.repaired, requestedTask);
        return {
            ...revalidation,
            repaired: true,
            repairsApplied: repairResult.repairsApplied,
            original_artifact: extractResult
        };
    }

    const orderValidation = validateCanonicalFieldOrder(parsed);
    if (!orderValidation.valid) {
        const repairResult = repairEmbeddedArtifact(extractResult);
        if (repairResult.error || !repairResult.repaired || repairResult.repairsApplied.length === 0) {
            return {
                valid: false,
                error: orderValidation.error,
                error_code: orderValidation.error_code,
                field_order_violation: orderValidation.field_order_violation,
                canonical_artifact: extractResult,
                parsed_artifact: parsed,
                carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
                repaired: false,
                repairsApplied: null
            };
        }

        const revalidation = validateRepairedArtifact(repairResult.repaired, requestedTask);
        return {
            ...revalidation,
            repaired: true,
            repairsApplied: repairResult.repairsApplied,
            original_artifact: extractResult
        };
    }

    return validateOneClickCarrier(workflowRaw, requestedTask);
}

function persistRepairedCarrier(workflowRaw, repairedArtifactText) {
    if (!workflowRaw || typeof workflowRaw !== 'string') {
        return { persisted: false, error: 'workflowRaw is required', error_code: 'CARRIER_WRITE_FAILED' };
    }
    if (!repairedArtifactText || typeof repairedArtifactText !== 'string') {
        return { persisted: false, error: 'repairedArtifactText is required', error_code: 'CARRIER_WRITE_FAILED' };
    }

    const originalExtracted = extractEmbeddedCarrierArtifact(workflowRaw);
    if (originalExtracted === null) {
        return { persisted: false, error: 'Cannot persist: no embedded carrier artifact found to replace', error_code: 'CARRIER_NO_EMBEDDED_ARTIFACT' };
    }

    const repairedTrimmed = repairedArtifactText.trim();

    const heredocPattern = /<<'TASK_EOF'([\s\S]*?)TASK_EOF/;
    if (heredocPattern.test(workflowRaw)) {
        const updated = workflowRaw.replace(
            /<<'TASK_EOF'[\s\S]*?TASK_EOF/,
            "<<'TASK_EOF'\n" + repairedTrimmed + "\n          TASK_EOF"
        );
        return { persisted: true, workflow_raw: updated, carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID };
    }

    const backtickPattern = /TASK=`([\s\S]*?)`/;
    if (backtickPattern.test(workflowRaw)) {
        const updated = workflowRaw.replace(
            /TASK=`[\s\S]*?`/,
            "TASK=`" + repairedTrimmed + "`"
        );
        return { persisted: true, workflow_raw: updated, carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID };
    }

    const singleQuotePattern = /TASK='([\s\S]*?)'/;
    if (singleQuotePattern.test(workflowRaw)) {
        const updated = workflowRaw.replace(
            /TASK='[\s\S]*?'/,
            "TASK='" + repairedTrimmed + "'"
        );
        return { persisted: true, workflow_raw: updated, carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID };
    }

    return { persisted: false, error: 'Cannot persist: unrecognized carrier embedding format', error_code: 'CARRIER_WRITE_FAILED' };
}

function persistRepairedCarrierToFile(workflowPath, workflowRaw, repairedArtifactText) {
    const persistResult = persistRepairedCarrier(workflowRaw, repairedArtifactText);
    if (!persistResult.persisted) {
        return persistResult;
    }
    try {
        fs.writeFileSync(workflowPath, persistResult.workflow_raw, 'utf8');
        return { persisted: true, workflow_path: workflowPath, carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_VALID };
    } catch (e) {
        return { persisted: false, error: 'Failed to write repaired workflow: ' + e.message, error_code: 'CARRIER_WRITE_FAILED', workflow_path: workflowPath };
    }
}

function preflightValidateOneClickActivation(workflowDir, requestedTask, persistRepairs, targetWorkflow) {
    const dir = workflowDir || '.github/workflows';
    const results = {};
    const repairLog = [];

    for (const wf of VALID_ONE_CLICK_WORKFLOWS) {
        const wfPath = dir + '/' + wf;
        let workflowRaw;
        try {
            workflowRaw = fs.readFileSync(wfPath, 'utf8');
        } catch (e) {
            results[wf] = {
                found: false,
                valid: false,
                error: 'Workflow file not found: ' + wf,
                error_code: 'CARRIER_NOT_FOUND',
                bound: false,
                repaired: false,
                repairsApplied: null
            };
            continue;
        }

        const validation = repairAndRevalidateOneClickCarrier(workflowRaw, requestedTask);
        if (!validation.valid && validation.repaired) {
            if (persistRepairs === true) {
                const persistResult = persistRepairedCarrierToFile(wfPath, workflowRaw, validation.canonical_artifact);
                if (persistResult.persisted) {
                    const reparsedArtifact = (() => {
                        try { return fs.readFileSync(wfPath, 'utf8'); } catch (e) { return null; }
                    })();
                    let reparsedValid = false;
                    let reparsedTask = null;
                    if (reparsedArtifact) {
                        const revalidation = repairAndRevalidateOneClickCarrier(reparsedArtifact, requestedTask);
                        reparsedValid = revalidation.valid;
                        if (revalidation.parsed_artifact) {
                            reparsedTask = revalidation.parsed_artifact;
                        }
                    }
                    results[wf] = {
                        found: true,
                        valid: reparsedValid,
                        error: reparsedValid ? null : validation.error,
                        error_code: reparsedValid ? null : validation.error_code,
                        canonical_artifact: validation.canonical_artifact || null,
                        repaired: true,
                        repairsApplied: validation.repairsApplied,
                        original_artifact: validation.original_artifact,
                        parsed: validation.parsed_artifact || null,
                        carrier_state: validation.carrier_state,
                        bound: validation.binding ? validation.binding.bound : false,
                        binding: validation.binding || null,
                        persisted: persistResult.persisted,
                        persisted_path: wfPath,
                        reparsed_revalid: reparsedValid,
                        reparsed_artifact: reparsedTask
                    };
                    repairLog.push({ workflow: wf, repaired: true, persisted: true, reparsed_valid: reparsedValid });
                } else {
                    results[wf] = {
                        found: true,
                        valid: validation.valid,
                        error: persistResult.error || 'Failed to persist repair: ' + (persistResult.error_code || 'unknown'),
                        error_code: persistResult.error_code || 'CARRIER_WRITE_FAILED',
                        canonical_artifact: validation.canonical_artifact || null,
                        repaired: true,
                        repairsApplied: validation.repairsApplied,
                        original_artifact: validation.original_artifact,
                        parsed: validation.parsed_artifact || null,
                        carrier_state: validation.carrier_state,
                        bound: validation.binding ? validation.binding.bound : false,
                        binding: validation.binding || null,
                        persisted: false
                    };
                    repairLog.push({ workflow: wf, repaired: true, persisted: false, error: persistResult.error_code });
                }
            } else {
                results[wf] = {
                    found: true,
                    valid: validation.valid,
                    error: validation.error || null,
                    error_code: validation.error_code || null,
                    canonical_artifact: validation.canonical_artifact || null,
                    repaired: true,
                    repairsApplied: validation.repairsApplied,
                    original_artifact: validation.original_artifact,
                    parsed: validation.parsed_artifact || null,
                    carrier_state: validation.carrier_state,
                    bound: validation.binding ? validation.binding.bound : false,
                    binding: validation.binding || null,
                    persisted: false
                };
                repairLog.push({ workflow: wf, repaired: true, persisted: false, persisted_requested: false });
            }
        } else {
            const directValidation = validateOneClickCarrier(workflowRaw, requestedTask);
            results[wf] = {
                found: true,
                valid: directValidation.valid,
                error: directValidation.error || null,
                error_code: directValidation.error_code || null,
                canonical_artifact: directValidation.canonical_artifact || null,
                repaired: false,
                repairsApplied: null,
                parsed: directValidation.parsed_artifact || null,
                carrier_state: directValidation.carrier_state,
                bound: directValidation.binding ? directValidation.binding.bound : false,
                binding: directValidation.binding || null,
                persisted: false
            };
        }
    }

    const allCarriersValid = Object.values(results).every(r => r.valid === true);

    let bindingSatisfied = true;
    let targetBound = null;
    if (requestedTask) {
        if (targetWorkflow) {
            const targetResult = results[targetWorkflow];
            targetBound = targetResult ? targetResult.bound === true : false;
            bindingSatisfied = !!(targetResult && targetResult.valid === true && targetResult.bound === true);
        } else {
            const boundCount = Object.values(results).filter(r => r.bound === true).length;
            targetBound = boundCount > 0;
            bindingSatisfied = boundCount > 0;
        }
    }

    const allValid = allCarriersValid && bindingSatisfied;

    return {
        all_valid: allValid,
        results,
        summary: {
            total: VALID_ONE_CLICK_WORKFLOWS.length,
            valid: Object.values(results).filter(r => r.valid === true).length,
            invalid: Object.values(results).filter(r => r.valid !== true).length,
            bound: requestedTask ? Object.values(results).filter(r => r.bound === true).length : null,
            repaired: Object.values(results).filter(r => r.repaired === true).length,
            persisted: Object.values(results).filter(r => r.persisted === true).length
        },
        target_workflow: targetWorkflow || null,
        target_bound: targetBound,
        repair_log: repairLog,
        requested_task: requestedTask || null
    };
}

/**
 * Validates that every workflow file in the workflows directory parses as
 * valid YAML. This is a structural gate: GitHub rejects workflows that fail
 * to parse, so any unparseable file blocks workflow registration.
 *
 * Unlike preflightValidateOneClickActivation (which iterates a manually
 * maintained VALID_ONE_CLICK_WORKFLOWS list), this function enumerates all
 * *.yml files on disk so that newly added workflows cannot bypass validation.
 */
function validateAllWorkflowYaml(workflowDir) {
    const dir = workflowDir || path.join(ROOT_DIR, '.github', 'workflows');
    const results = {};
    let allValid = true;

    let files;
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch (e) {
        return {
            all_valid: false,
            error: 'Cannot read workflow directory: ' + e.message,
            error_code: 'WORKFLOW_DIR_UNREADABLE',
            results: {},
            summary: { total: 0, valid: 0, invalid: 0 }
        };
    }

    for (const wf of files) {
        const wfPath = path.join(dir, wf);
        const wfRaw = fs.readFileSync(wfPath, 'utf8');

        if (/\t/.test(wfRaw)) {
            results[wf] = {
                valid: false,
                error: 'Contains tab characters in indentation',
                error_code: 'WORKFLOW_CONTAINS_TABS'
            };
            allValid = false;
            continue;
        }

        try {
            yaml.load(wfRaw);
            results[wf] = { valid: true };
        } catch (e) {
            results[wf] = {
                valid: false,
                error: 'YAML parse failure: ' + e.message,
                error_code: 'YAML_PARSE_FAILED',
                line: e.mark ? e.mark.line + 1 : null,
                column: e.mark ? e.mark.column + 1 : null
            };
            allValid = false;
        }
    }

    return {
        all_valid: allValid,
        results,
        summary: {
            total: files.length,
            valid: Object.values(results).filter(r => r.valid === true).length,
            invalid: Object.values(results).filter(r => r.valid !== true).length
        }
    };
}

module.exports = {
    CARRIER_STATES,
    VALID_ONE_CLICK_WORKFLOWS,
    extractEmbeddedCarrierArtifact,
    validateOneClickCarrier,
    bindCarrierToRequestedTask,
    listOneClickWorkflows,
    preflightValidateOneClickActivation,
    repairAndRevalidateOneClickCarrier,
    repairEmbeddedArtifact,
    validateRepairedArtifact,
    persistRepairedCarrier,
    persistRepairedCarrierToFile,
    serializeCanonicalTaskArtifact,
    validateAllWorkflowYaml,
    getRuntimeTaskModeForConceptual,
    CANONICAL_TASK_ARTIFACT_FIELD_ORDER,
    CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS,
    CONCEPTUAL_TASK_MODES,
    VALID_CAPABILITIES,
    VALID_AGENTS,
    EXECUTION_TASK_MODES
};
