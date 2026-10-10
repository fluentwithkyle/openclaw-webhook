const fs = require('fs');
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
    EXECUTION_TASK_MODES
} = require('./schemas/acp-schema');

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

function preflightValidateOneClickActivation(workflowDir, requestedTask) {
    const dir = workflowDir || '.github/workflows';
    const results = {};

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
                bound: false
            };
            continue;
        }

        const validation = validateOneClickCarrier(workflowRaw, requestedTask);
        results[wf] = {
            found: true,
            valid: validation.valid,
            error: validation.error || null,
            error_code: validation.error_code || null,
            canonical_artifact: validation.canonical_artifact || null,
            parsed: validation.parsed_artifact || null,
            carrier_state: validation.carrier_state,
            bound: validation.binding ? validation.binding.bound : false,
            binding: validation.binding || null
        };
    }

    const allValid = Object.values(results).every(r => r.valid === true && (!requestedTask || r.bound === true));

    return {
        all_valid: allValid,
        results,
        summary: {
            total: VALID_ONE_CLICK_WORKFLOWS.length,
            valid: Object.values(results).filter(r => r.valid === true).length,
            invalid: Object.values(results).filter(r => r.valid !== true).length,
            bound: requestedTask ? Object.values(results).filter(r => r.bound === true).length : null
        },
        requested_task: requestedTask || null
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
    getRuntimeTaskModeForConceptual,
    CANONICAL_TASK_ARTIFACT_FIELD_ORDER,
    CANONICAL_TASK_ARTIFACT_REQUIRED_FIELDS,
    CONCEPTUAL_TASK_MODES,
    VALID_CAPABILITIES,
    VALID_AGENTS,
    EXECUTION_TASK_MODES
};
