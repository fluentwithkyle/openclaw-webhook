const fs = require('fs');
const {
    validateAcpTaskArtifact,
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
    'one-click-gemini-research-documentation.yml'
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
        let depth = 0;
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

function extractField(lines, fieldName) {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === fieldName + ':' || trimmed.startsWith(fieldName + ': ')) {
            const rest = trimmed.substring(fieldName.length + 1).trim();
            if (rest !== '') {
                return { value: rest, lineIndex: i };
            }
            return { value: '', lineIndex: i, isBlock: true };
        }
    }
    return null;
}

function extractScalarField(lines, fieldName) {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === fieldName + ':' || trimmed.startsWith(fieldName + ': ')) {
            const rest = trimmed.substring(fieldName.length + 2).trim();
            if (rest !== '') {
                return rest.replace(/^[']+|^["]+/, '').replace(/[']+$|^["]+$/, '');
            }
            const nextLine = lines[i + 1];
            if (nextLine) {
                const nextTrimmed = nextLine.trim();
                if (nextTrimmed && !nextTrimmed.match(/^[\w_]+:\s/) && !nextTrimmed.startsWith('- ')) {
                    return nextTrimmed.replace(/^[']+|^["]+/, '').replace(/[']+$|^["]+$/, '');
                }
            }
            return '';
        }
    }
    return undefined;
}

function extractListField(lines, fieldName) {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === fieldName + ':' || trimmed.startsWith(fieldName + ': ')) {
            const rest = trimmed.substring(fieldName.length + 2).trim();
            if (rest !== '') {
                const parts = rest.split(',').map(p => p.trim()).filter(p => p.length > 0);
                if (parts.length > 0) return parts;
            }
            const items = [];
            for (let j = i + 1; j < lines.length; j++) {
                const nextTrimmed = lines[j].trim();
                if (nextTrimmed.startsWith('- ')) {
                    items.push(nextTrimmed.substring(2).trim());
                } else if (nextTrimmed === '') {
                    continue;
                } else {
                    break;
                }
            }
            return items.length > 0 ? items : undefined;
        }
    }
    return undefined;
}

function extractBlockText(lines, fieldName) {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === fieldName + ':' || trimmed.startsWith(fieldName + ': ')) {
            const rest = trimmed.substring(fieldName.length + 2).trim();
            if (rest !== '') {
                return rest.replace(/^[']+|^["]+/, '').replace(/[']+$|^["]+$/, '');
            }
            const textLines = [];
            for (let j = i + 1; j < lines.length; j++) {
                const nextTrimmed = lines[j].trim();
                if (nextTrimmed === '') continue;
                if (nextTrimmed.match(/^[\w_]+:\s/)) break;
                if (nextTrimmed.startsWith('- ')) break;
                textLines.push(nextTrimmed);
            }
            return textLines.join(' ').trim();
        }
    }
    return undefined;
}

function extractPathsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const pathRegex = /([a-zA-Z][\w-]*\/(?:[\w.-]+\/)*[\w.-]+\.md|[a-zA-Z][\w-]*\/(?:[\w.-]+\/)*)/g;
    const paths = [];
    const seen = new Set();
    let match;
    while ((match = pathRegex.exec(text)) !== null) {
        const p = match[1];
        if (!seen.has(p)) {
            seen.add(p);
            paths.push(p);
        }
    }
    return paths;
}

function extractScopePermittedPaths(lines) {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === 'scope:' || trimmed.startsWith('scope: ')) {
            const rest = trimmed.substring(6).trim();
            if (rest !== '') {
                return extractPathsFromText(rest);
            }
            const paths = [];
            let foundList = false;
            for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j];
                const nextTrimmed = nextLine.trim();
                const nextIndent = nextLine.match(/^(\s*)/)[1].length;
                const scopeIndent = lines[i].match(/^(\s*)/)[1].length;

                if (nextIndent <= scopeIndent && nextTrimmed !== '') break;
                if (nextIndent > scopeIndent) {
                    if (nextTrimmed.startsWith('permitted_paths:')) {
                        const pathStr = nextTrimmed.substring('permitted_paths:'.length).trim();
                        if (pathStr) {
                            paths.push(pathStr.replace(/^['\"]|['\"]$/g, ''));
                            foundList = true;
                        } else {
                            for (let k = j + 1; k < lines.length; k++) {
                                const itemLine = lines[k];
                                const itemTrimmed = itemLine.trim();
                                const itemIndent = itemLine.match(/^(\s*)/)[1].length;
                                if (itemIndent <= nextIndent && itemTrimmed !== '') break;
                                if (itemTrimmed.startsWith('- ')) {
                                    paths.push(itemTrimmed.substring(2).trim().replace(/^['\"]|['\"]$/g, ''));
                                    foundList = true;
                                } else if (itemIndent > nextIndent && itemTrimmed.startsWith('- ')) {
                                    paths.push(itemTrimmed.substring(2).trim().replace(/^['\"]|['\"]$/g, ''));
                                    foundList = true;
                                }
                            }
                        }
                    } else if (nextTrimmed.startsWith('- ')) {
                        paths.push(nextTrimmed.substring(2).trim().replace(/^['\"]|['\"]$/g, ''));
                        foundList = true;
                    } else if (nextTrimmed.match(/^[w_]+:/) && !nextTrimmed.startsWith('permitted_paths:')) {
                        const extracted = extractPathsFromText(nextTrimmed);
                        paths.push(...extracted);
                        if (extracted.length > 0) foundList = true;
                    } else {
                        const extracted = extractPathsFromText(nextTrimmed);
                        paths.push(...extracted);
                        if (extracted.length > 0) foundList = true;
                    }
                }
            }
            return paths.length > 0 ? paths : undefined;
        }
    }
    return undefined;
}
function extractScopeFields(lines) {
    let scopePaths = extractScopePermittedPaths(lines);
    let scopeText = extractBlockText(lines, 'scope');
    if (scopeText && scopeText.match(/^[\w_]+:\s/) && scopeText.trim().startsWith('permitted_paths:')) {
        scopeText = undefined;
    }
    let paths = scopePaths || [];
    if (!paths.length && scopeText) {
        paths = extractPathsFromText(scopeText);
    }
    return { permitted_paths: paths, description: scopeText || '' };
}

function parseYamlLikeToArtifactObject(text) {
    if (!text || typeof text !== 'string') return null;

    const lines = text.split('\n');

    const result = {
        task_name: extractScalarField(lines, 'task_name'),
        originator: extractScalarField(lines, 'originator'),
        target_agent: extractScalarField(lines, 'target_agent'),
        repository: extractScalarField(lines, 'repository'),
        base_branch: extractScalarField(lines, 'base_branch'),
        task_mode: extractScalarField(lines, 'task_mode'),
        capabilities: extractListField(lines, 'capabilities'),
        objective: extractBlockText(lines, 'objective'),
        scope: extractScopeFields(lines),
        verification: extractBlockText(lines, 'verification'),
        constraints: extractListField(lines, 'constraints'),
        conflict_handling: extractScalarField(lines, 'conflict_handling')
    };

    return result;
}

function normalizeCapabilities(caps) {
    if (!caps) return [];
    if (Array.isArray(caps)) {
        return caps.filter(c => typeof c === 'string').map(c => c.trim()).filter(c => c.length > 0);
    }
    if (typeof caps === 'string') {
        return caps.split(',').map(c => c.trim()).filter(c => c.length > 0);
    }
    return [];
}

function normalizeScope(scope, taskMode) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
        return { permitted_paths: [] };
    }

    if (Array.isArray(scope.permitted_paths) && scope.permitted_paths.length > 0) {
        let paths = scope.permitted_paths;
        if (typeof paths[0] === 'string' && paths[0].includes(',')) {
            paths = paths.flatMap(p => p.split(',').map(s => s.trim()).filter(s => s.length > 0));
        }
        return { description: scope.description || '', permitted_paths: paths };
    }

    let paths = [];
    const text = scope.description || (typeof scope === 'string' ? scope : '');
    if (text) {
        paths = extractPathsFromText(text);
    }

    if (paths.length > 0) {
        return { description: text, permitted_paths: paths };
    }

    return { description: text, permitted_paths: [] };
}

function normalizeVerification(verification) {
    if (!verification) return '';
    if (typeof verification === 'string') return verification.trim();
    if (Array.isArray(verification)) return verification.join('\n');
    if (typeof verification === 'object') {
        if (verification.required && Array.isArray(verification.required)) {
            return verification.required.join('\n');
        }
        return JSON.stringify(verification);
    }
    return String(verification).trim();
}

function normalizeConstraints(constraints) {
    if (!constraints) return [];
    if (Array.isArray(constraints)) return constraints;
    if (typeof constraints === 'string') {
        return constraints.split(',').map(c => c.trim()).filter(c => c.length > 0);
    }
    return [String(constraints)];
}

function buildCanonicalArtifactString(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;

    const rawMode = parsed.task_mode;
    let taskMode = rawMode;
    if (typeof rawMode === 'string' && CONCEPTUAL_TASK_MODES.includes(rawMode)) {
        taskMode = getRuntimeTaskModeForConceptual(rawMode, 'FAILOVER_EXECUTE');
    }

    const canonical = {
        task_name: parsed.task_name || '',
        originator: parsed.originator || '',
        target_agent: parsed.target_agent || '',
        repository: parsed.repository || '',
        base_branch: parsed.base_branch || '',
        task_mode: taskMode,
        capabilities: normalizeCapabilities(parsed.capabilities),
        objective: typeof parsed.objective === 'string' ? parsed.objective.trim() : String(parsed.objective || ''),
        scope: normalizeScope(parsed.scope, taskMode),
        verification: normalizeVerification(parsed.verification),
        constraints: normalizeConstraints(parsed.constraints),
        conflict_handling: parsed.conflict_handling || ''
    };

    const ordered = {};
    for (const field of CANONICAL_TASK_ARTIFACT_FIELD_ORDER) {
        if (field in canonical) {
            ordered[field] = canonical[field];
        }
    }

    return JSON.stringify(ordered, null, 2);
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

    const parsed = parseYamlLikeToArtifactObject(embeddedText);
    if (!parsed) {
        return {
            valid: false,
            error: 'Failed to parse embedded ACP task artifact',
            error_code: 'CARRIER_PARSE_FAILED',
            carrier_state: CARRIER_STATES.CARRIER_NOT_FOUND
        };
    }

    const canonicalJson = buildCanonicalArtifactString(parsed);
    if (!canonicalJson) {
        return {
            valid: false,
            error: 'Failed to build canonical ACP artifact string',
            error_code: 'CANONICAL_BUILD_FAILED',
            carrier_state: CARRIER_STATES.CARRIER_NOT_FOUND
        };
    }

    const validation = validateAcpTaskArtifact(canonicalJson);

    const binding = bindCarrierToRequestedTask(parsed, requestedTask);

    if (!validation.valid) {
        return {
            valid: false,
            error: validation.error,
            error_code: validation.error_code,
            ...(validation.error_code === 'FIELD_ORDER_VIOLATION' ? { field_order_violation: validation.field_order_violation } : {}),
            ...(validation.missing_fields ? { missing_fields: validation.missing_fields } : {}),
            ...(validation.invalid_capability ? { invalid_capability: validation.invalid_capability } : {}),
            ...(validation.invalid_task_mode ? { invalid_task_mode: validation.invalid_task_mode } : {}),
            canonical_artifact: canonicalJson,
            parsed_artifact: parsed,
            carrier_state: CARRIER_STATES.CARRIER_ARTIFACT_INVALID,
            binding
        };
    }

    return {
        valid: true,
        task_mode: validation.task_mode,
        warnings: validation.warnings,
        canonical_artifact: canonicalJson,
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

function preflightValidateOneClickActivation(workflowDir) {
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
                error_code: 'CARRIER_NOT_FOUND'
            };
            continue;
        }

        const validation = validateOneClickCarrier(workflowRaw);
        results[wf] = {
            found: true,
            valid: validation.valid,
            error: validation.error || null,
            error_code: validation.error_code || null,
            canonical_artifact: validation.canonical_artifact || null,
            parsed: validation.parsed_artifact || null,
            carrier_state: validation.carrier_state
        };
    }

    const allValid = Object.values(results).every(r => r.valid === true);

    return {
        all_valid: allValid,
        results,
        summary: {
            total: VALID_ONE_CLICK_WORKFLOWS.length,
            valid: Object.values(results).filter(r => r.valid === true).length,
            invalid: Object.values(results).filter(r => r.valid !== true).length
        }
    };
}

module.exports = {
    CARRIER_STATES,
    VALID_ONE_CLICK_WORKFLOWS,
    extractEmbeddedCarrierArtifact,
    parseYamlLikeToArtifactObject,
    normalizeCapabilities,
    normalizeScope,
    normalizeVerification,
    normalizeConstraints,
    extractPathsFromText,
    buildCanonicalArtifactString,
    validateOneClickCarrier,
    bindCarrierToRequestedTask,
    listOneClickWorkflows,
    preflightValidateOneClickActivation
};
