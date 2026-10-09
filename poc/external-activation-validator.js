const https = require('https');
const crypto = require('crypto');
const taskRegistry = require('./task-registry');
const { validateAcpTaskArtifact, validateAcpTaskArtifactSyntax } = require('./schemas/acp-schema');

const ACTIVATION_INGRESS_PATH = '/poc/activation/ingress';

function generateDirectorOriginAssertion(requestId, executionClaimId, directorOriginSecret) {
    if (!directorOriginSecret || !requestId) return null;

    const token = crypto
        .createHmac('sha256', directorOriginSecret)
        .update(requestId + ':' + (executionClaimId || ''))
        .digest('hex');

    return Buffer.from(JSON.stringify({ request_id: requestId, execution_claim_id: executionClaimId || null, token })).toString('base64');
}

function verifyDirectorOriginAssertion(assertion, requestId, directorOriginSecret) {
    if (!assertion || typeof assertion !== 'string') return false;
    if (!directorOriginSecret) return false;
    if (!requestId) return false;

    try {
        const decoded = Buffer.from(assertion, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed.request_id !== requestId) return false;
        if (!parsed.execution_claim_id) return false;

        const expected = crypto
            .createHmac('sha256', directorOriginSecret)
            .update(requestId + ':' + parsed.execution_claim_id)
            .digest('hex');

        return crypto.timingSafeEqual(Buffer.from(parsed.token, 'hex'), Buffer.from(expected, 'hex'));
    } catch (err) {
        return false;
    }
}

function verifyDirectorOriginAssertionAgainstTaskRegistry(assertion, requestId, directorOriginSecret) {
    if (!assertion || typeof assertion !== 'string') return false;
    if (!directorOriginSecret) return false;
    if (!requestId) return false;

    try {
        const decoded = Buffer.from(assertion, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed.request_id !== requestId) return false;
        if (!parsed.execution_claim_id) return false;

        const expected = crypto
            .createHmac('sha256', directorOriginSecret)
            .update(requestId + ':' + parsed.execution_claim_id)
            .digest('hex');

        const tokenMatch = crypto.timingSafeEqual(Buffer.from(parsed.token, 'hex'), Buffer.from(expected, 'hex'));
        if (!tokenMatch) return false;

        const taskEntry = taskRegistry.getTask(requestId);
        if (!taskEntry) return false;

        const actualClaim = taskRegistry.getExecutionClaim(requestId);
        if (!actualClaim || actualClaim.execution_claim_id !== parsed.execution_claim_id) return false;

        return true;
    } catch (err) {
        return false;
    }
}

function validateExternalActivation(params, callbackUrl, callbackSecret, directorOriginSecret, directorOriginAssertion) {
    const payload = JSON.stringify(params);

    const parsedUrl = new URL(callbackUrl.replace(/\/+$/, '') + ACTIVATION_INGRESS_PATH);
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    if (callbackSecret) {
        options.headers['x-poc-trigger-secret'] = callbackSecret;
    }

    const requestId = params && params.request_id;
    const requiresAssertion = params && (params.target === 'Gemini Builder');

    var resolvedDirectorOriginAssertion = directorOriginAssertion || params && params.director_origin_assertion;
    var resolvedDirectorOriginSecret = directorOriginSecret || params && params.director_origin_secret;

    if (resolvedDirectorOriginAssertion) {
        options.headers['x-director-origin-assertion'] = resolvedDirectorOriginAssertion;
    }

    if (resolvedDirectorOriginSecret && !requiresAssertion) {
        options.headers['x-director-origin-secret'] = resolvedDirectorOriginSecret;
    }

    const carrierIdentity = process.env.GITHUB_RUN_ID
        ? 'github-workflow-' + process.env.GITHUB_RUN_ID + '-' + (process.env.GITHUB_RUN_ATTEMPT || 1)
        : null;
    if (carrierIdentity) {
        options.headers['x-carrier-identity'] = carrierIdentity;
    }

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let body;
                try {
                    body = JSON.parse(data);
                } catch (e) {
                    body = { raw: data };
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        success: true,
                        status: res.statusCode,
                        activation: body,
                        request_id: body.request_id
                    });
                } else {
                    console.error('::error::Canonical ingress response: ' + JSON.stringify(body));
                    resolve({
                        success: false,
                        status: res.statusCode,
                        activation: body,
                        error: body.error || body.message || `Ingress returned HTTP ${res.statusCode}`,
                        error_code: body.error_code || 'ACTIVATION_INGRESS_REJECTED'
                    });
                }
            });
        });

        req.on('error', (e) => {
            resolve({
                success: false,
                status: 0,
                error: `Network error calling activation ingress: ${e.message}`,
                error_code: 'NETWORK_FAILURE'
            });
        });

        req.write(payload);
        req.end();
    });
}

const VALID_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT'];
const NON_RUNTIME_TASK_MODES = ['PLAN', 'EXECUTE'];
const SMART_QUOTE_CHARS = ['\u2018', '\u2019', '\u201A', '\u201B', '\u201C', '\u201D', '\u201E', '\u201F'];

var ACP_DESCRIPTOR_FIELDS = ['task_mode', 'task', 'target', 'verification', 'capabilities', 'permitted_paths', 'task_name', 'request_id'];

function looksLikeAcpDescriptor(text) {
    if (typeof text !== 'string' || text.trim() === '') return false;
    for (var i = 0; i < ACP_DESCRIPTOR_FIELDS.length; i++) {
        if (text.indexOf(ACP_DESCRIPTOR_FIELDS[i]) !== -1) {
            return true;
        }
    }
    return false;
}

function detectSmartQuote(jsonText) {
    if (typeof jsonText !== 'string') return null;
    for (var i = 0; i < SMART_QUOTE_CHARS.length; i++) {
        var idx = jsonText.indexOf(SMART_QUOTE_CHARS[i]);
        if (idx !== -1) {
            return { char: SMART_QUOTE_CHARS[i], code: 'U+' + SMART_QUOTE_CHARS[i].codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), location: idx };
        }
    }
    return null;
}

function extractEmbeddedAcpDescriptor(commentBody) {
    if (typeof commentBody !== 'string' || commentBody.trim() === '') {
        return null;
    }

    var stripped = commentBody.replace('@gemini-cli', '').trim();

    var match = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
        var openBraceIdx = stripped.indexOf('{');
        if (openBraceIdx !== -1) {
            var afterBrace = stripped.substring(openBraceIdx + 1).trim();
            if (afterBrace.length > 0 && /["']?[\w_]+["']?\s*:/.test(afterBrace)) {
                return {
                    _malformed_json: true,
                    _json_parse_error: 'JSON descriptor is missing a closing brace ("}")',
                    _raw_match: stripped.substring(openBraceIdx)
                };
            }
        }
        return null;
    }

    var candidate;
    try {
        candidate = JSON.parse(match[0]);
    } catch (e) {
        if (!looksLikeAcpDescriptor(match[0])) {
            return null;
        }
        var smartQuoteDetection = detectSmartQuote(match[0]);
        if (smartQuoteDetection) {
            return {
                _malformed_json: true,
                _json_parse_error: 'Malformed JSON: smart/curly quotation mark (' + smartQuoteDetection.code + ') used as JSON delimiter; JSON requires standard double-quote (U+0022)',
                _malformed_json_error_code: 'MALFORMED_JSON_SMART_QUOTE',
                _smart_quote: smartQuoteDetection,
                _raw_match: match[0]
            };
        }
        return {
            _malformed_json: true,
            _json_parse_error: e.message,
            _raw_match: match[0]
        };
    }

    if (!candidate || typeof candidate !== 'object') {
        if (!looksLikeAcpDescriptor(match[0])) {
            return null;
        }
        return {
            _malformed_json: true,
            _json_parse_error: 'Parsed JSON is not an object',
            _raw_match: match[0]
        };
    }

    // The issue_comment body is NOT an authority source. This function extracts
    // only candidate fields (target, task, verification, task_mode) that may be
    // used when the comment author is Director-authorized via a valid Director
    // origin assertion/secret. task_mode is extracted here only as a candidate;
    // it is only honored when Director authorization is established at the
    // canonical activation ingress. capabilities and permitted_paths are NEVER
    // extracted from the comment — they are server-derived by the canonical
    // activation ingress from the server-side activation-policy authority.
    var hasTask = typeof candidate.task === 'string' && candidate.task.trim() !== '';
    var hasTarget = typeof candidate.target === 'string' && candidate.target.trim() !== '';
    var hasVerification = typeof candidate.verification === 'string' && candidate.verification.trim() !== '';
    var hasTaskMode = typeof candidate.task_mode === 'string' && candidate.task_mode.trim() !== '' && VALID_TASK_MODES.includes(candidate.task_mode);
    var explicitTaskMode = Object.prototype.hasOwnProperty.call(candidate, 'task_mode') && !hasTaskMode;

    if (!hasTask && !hasTarget && !hasVerification && !hasTaskMode) {
        if (explicitTaskMode) {
            var descriptor = {};
            descriptor._explicit_task_mode = true;
            descriptor._invalid_task_mode = candidate.task_mode;
            return descriptor;
        }
        return null;
    }

    var descriptor = {};
    descriptor._raw_match = match[0];
    if (hasTarget) {
        descriptor.target = candidate.target;
    }
    if (hasTask) {
        descriptor.task = candidate.task;
    }
    if (hasVerification) {
        descriptor.verification = candidate.verification;
    }
    if (hasTaskMode) {
        descriptor.task_mode = candidate.task_mode;
    }
    if (explicitTaskMode) {
        descriptor._explicit_task_mode = true;
        descriptor._invalid_task_mode = candidate.task_mode;
    }
    return descriptor;
}

function buildActivationPayloadForIssueComment(commentId, commentBody, repository, baseBranch, approvalId, directorOriginSecret, directorOriginAssertion) {
    var stripped = commentBody.replace('@gemini-cli', '').trim();

    var embeddedDescriptor = extractEmbeddedAcpDescriptor(commentBody);

    if (embeddedDescriptor && embeddedDescriptor._malformed_json) {
        return {
            error: 'Malformed JSON descriptor in comment: ' + embeddedDescriptor._json_parse_error,
            error_code: 'MALFORMED_ACP_DESCRIPTOR'
        };
    }

     if (embeddedDescriptor && embeddedDescriptor._explicit_task_mode && embeddedDescriptor._invalid_task_mode) {
         return {
             error: 'Invalid task_mode in embedded descriptor: ' + embeddedDescriptor._invalid_task_mode + '. Must be one of: ' + VALID_TASK_MODES.join(', '),
             error_code: 'INVALID_TASK_MODE'
         };
     }

     if (embeddedDescriptor && embeddedDescriptor._raw_match) {
         var artifactValidation = validateAcpTaskArtifactSyntax(embeddedDescriptor._raw_match);
         if (!artifactValidation.valid) {
             return {
                 error: 'Embedded ACP descriptor failed artifact syntax validation: ' + artifactValidation.error,
                 error_code: 'ARTIFACT_VALIDATION_FAILED',
                 validation_error_code: artifactValidation.error_code,
                 validation_details: artifactValidation
             };
         }
     }

    var taskMode = 'REVIEW';
    var capabilities = 'read_only';
    var permittedPaths = 'poc/';
    var target = 'Gemini';
    var task = stripped;
    var verification = 'Review the request and provide analysis, risk assessment, and implementation plans.';

    var directorAuthorized = false;
    if ((directorOriginSecret && directorOriginSecret.trim() !== '') || (directorOriginAssertion && directorOriginAssertion.trim() !== '')) {
        directorAuthorized = true;
    }

    if (embeddedDescriptor) {
        if (typeof embeddedDescriptor.task === 'string' && embeddedDescriptor.task.trim() !== '') {
            task = embeddedDescriptor.task;
        }
        if (typeof embeddedDescriptor.verification === 'string' && embeddedDescriptor.verification.trim() !== '') {
            verification = embeddedDescriptor.verification;
        }
    }

    if (directorAuthorized && embeddedDescriptor && VALID_TASK_MODES.includes(embeddedDescriptor.task_mode)) {
        taskMode = embeddedDescriptor.task_mode;
    }

    return {
        protocol_version: '0.1',
        request_id: String(commentId),
        source: 'GitHub issue_comment',
        target: target,
        task_type: 'github_external_activation',
        repository: repository,
        base_branch: baseBranch,
        task: task,
        task_mode: taskMode,
        constraints: { permitted_paths: permittedPaths.split(',').filter(Boolean) },
        authorization: { capabilities: capabilities.split(',').filter(Boolean), ...(approvalId ? { approval_id: approvalId } : {}) },
        verification: verification,
        reporting: 'json',
        originator: 'Kyle',
        activation_surface: 'github_issue_comment',
        activation_syntax: '@gemini-cli',
        embedded_acp_descriptor: embeddedDescriptor || undefined,
        director_authorized: directorAuthorized
    };
}

function buildActivationPayloadForWorkflowDispatch(inputs) {
    const rawTaskMode = inputs.task_mode || 'REVIEW';
    const taskMode = rawTaskMode;

    if (NON_RUNTIME_TASK_MODES.includes(rawTaskMode)) {
        return {
            error: 'task_mode "' + rawTaskMode + '" is a conceptual Director-facing mode, not a runtime task_mode. Runtime-accepted values are: ' + VALID_TASK_MODES.join(', ') + '. See TASK_STANDARD.md Section 9.',
            error_code: 'NON_RUNTIME_TASK_MODE',
            invalid_task_mode: rawTaskMode,
            valid_runtime_modes: VALID_TASK_MODES
        };
    }

    if (!VALID_TASK_MODES.includes(rawTaskMode)) {
        return {
            error: 'Invalid task_mode: "' + rawTaskMode + '". Must be one of: ' + VALID_TASK_MODES.join(', '),
            error_code: 'INVALID_TASK_MODE',
            invalid_task_mode: rawTaskMode,
            valid_runtime_modes: VALID_TASK_MODES
        };
    }

    const capabilities = inputs.capabilities || 'read_only';
    const permittedPaths = inputs.permitted_paths || 'poc/';

    const isExecutionMode = taskMode === 'FAILOVER_EXECUTE' || taskMode === 'BUILDER';

    return {
        protocol_version: '0.1',
        request_id: inputs.request_id,
        source: 'GitHub workflow_dispatch',
        target: 'Gemini',
        task_type: 'github_external_activation',
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        task: inputs.task,
        task_mode: taskMode,
        constraints: { permitted_paths: permittedPaths.split(',').filter(Boolean) },
        authorization: {
            capabilities: capabilities.split(',').filter(Boolean),
            ...(inputs.approval_id ? { approval_id: inputs.approval_id } : {})
        },
        verification: inputs.verification || 'Review the request and provide analysis.',
        reporting: 'json',
        originator: 'Kyle',
        activation_surface: 'workflow_dispatch',
        ...(isExecutionMode ? { activation_syntax: '@gemini-cli' } : {})
    };
}

function buildBuilderActivationPayload(inputs) {
    const rawTaskMode = inputs.task_mode || 'BUILDER';
    const taskMode = rawTaskMode;

    if (NON_RUNTIME_TASK_MODES.includes(rawTaskMode)) {
        return {
            error: 'task_mode "' + rawTaskMode + '" is a conceptual Director-facing mode, not a runtime task_mode. Runtime-accepted values are: ' + VALID_TASK_MODES.join(', ') + '. See TASK_STANDARD.md Section 9.',
            error_code: 'NON_RUNTIME_TASK_MODE',
            invalid_task_mode: rawTaskMode,
            valid_runtime_modes: VALID_TASK_MODES
        };
    }

    if (!VALID_TASK_MODES.includes(rawTaskMode)) {
        return {
            error: 'Invalid task_mode: "' + rawTaskMode + '". Must be one of: ' + VALID_TASK_MODES.join(', '),
            error_code: 'INVALID_TASK_MODE',
            invalid_task_mode: rawTaskMode,
            valid_runtime_modes: VALID_TASK_MODES
        };
    }

    const capabilities = inputs.capabilities || 'read_only,modify_files,run_tests,commit,push';
    const permittedPaths = inputs.permitted_paths || 'poc/';

    const payload = {
        protocol_version: '0.1',
        request_id: inputs.request_id,
        source: 'GitHub workflow_dispatch',
        target: 'Gemini Builder',
        task_type: 'github_external_activation',
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        task: inputs.task,
        task_mode: taskMode,
        constraints: { permitted_paths: permittedPaths.split(',').filter(Boolean) },
        authorization: { capabilities: capabilities.split(',').filter(Boolean) },
        verification: inputs.verification || 'Build and implement within permitted_paths scope.',
        reporting: 'json',
        originator: 'Kyle',
        activation_surface: 'workflow_dispatch',
        activation_syntax: '@gemini-cli'
    };

    if (inputs.approval_id) {
        payload.authorization.approval_id = inputs.approval_id;
    }

    return payload;
}

module.exports = {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload,
    generateDirectorOriginAssertion,
    verifyDirectorOriginAssertion,
    verifyDirectorOriginAssertionAgainstTaskRegistry,
    extractEmbeddedAcpDescriptor,
    detectSmartQuote,
    looksLikeAcpDescriptor,
    ACTIVATION_INGRESS_PATH,
    VALID_TASK_MODES,
    NON_RUNTIME_TASK_MODES,
    SMART_QUOTE_CHARS
};
