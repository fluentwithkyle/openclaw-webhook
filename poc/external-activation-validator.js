const https = require('https');

const ACTIVATION_INGRESS_PATH = '/poc/activation/ingress';

function validateExternalActivation(params, callbackUrl, callbackSecret) {
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

function buildActivationPayloadForIssueComment(commentId, commentBody, repository, baseBranch) {
    const stripped = commentBody.replace('@gemini-cli', '').trim();

    let taskMode = 'REVIEW';
    let capabilities = 'read_only';
    let permittedPaths = 'poc/';
    let task = stripped;

    const failoverMatch = stripped.match(/^FAILOVER_EXECUTE\s+(.*)/s);
    if (failoverMatch) {
        taskMode = 'FAILOVER_EXECUTE';
        capabilities = 'read_only,modify_files,run_tests,commit,push';
        permittedPaths = 'poc/';
        task = failoverMatch[1].trim();
    }

    return {
        protocol_version: '0.1',
        request_id: String(commentId),
        source: 'GitHub issue_comment',
        target: 'Gemini',
        task_type: 'github_external_activation',
        repository: repository,
        base_branch: baseBranch,
        task: task,
        task_mode: taskMode,
        constraints: { permitted_paths: permittedPaths.split(',') },
        authorization: { capabilities: capabilities.split(',') },
        verification: taskMode === 'FAILOVER_EXECUTE'
            ? 'All changes must be within permitted_paths. Implement, test, commit, and push within scope.'
            : 'Review the request and provide analysis, risk assessment, and implementation plans.',
        reporting: 'json',
        originator: 'Kyle',
        activation_surface: 'github_issue_comment',
        activation_syntax: '@gemini-cli'
    };
}

function buildActivationPayloadForWorkflowDispatch(inputs) {
    const taskMode = inputs.task_mode || 'REVIEW';
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
        authorization: { capabilities: capabilities.split(',').filter(Boolean) },
        verification: inputs.verification || 'Review the request and provide analysis.',
        reporting: 'json',
        originator: 'Kyle',
        activation_surface: 'workflow_dispatch',
        ...(isExecutionMode ? { activation_syntax: '@gemini-cli' } : {})
    };
}

function buildBuilderActivationPayload(inputs) {
    const taskMode = inputs.task_mode || 'BUILDER';
    const capabilities = inputs.capabilities || 'read_only,modify_files,run_tests,commit,push';
    const permittedPaths = inputs.permitted_paths || 'poc/';

    return {
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
}

module.exports = {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload,
    ACTIVATION_INGRESS_PATH
};
