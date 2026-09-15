const https = require('https');

function dispatchGeminiWorkflow(requestId, taskContext) {
    const githubToken = process.env.GITHUB_ORCHESTRATOR_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || 'fluentwithkyle/openclaw-webhook';
    const workflowFile = process.env.GEMINI_WORKFLOW_FILE || 'main.yml';

    if (!githubToken) {
        return Promise.resolve({
            request_id: requestId,
            status: 'FAILED',
            error: 'Missing GitHub orchestrator token configuration'
        });
    }

    const workflowDispatchPayload = {
        ref: taskContext.base_branch || 'main',
        inputs: {
            request_id: requestId,
            task: taskContext.task,
            repository: taskContext.repository,
            base_branch: taskContext.base_branch,
            kilo_execution_id: taskContext.kilo_execution_id || ''
        }
    };

    const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/dispatches`);

    return new Promise((resolve) => {
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${githubToken}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'OpenClaw-Orchestrator'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 204) {
                    resolve({
                        request_id: requestId,
                        status: 'SUCCESS',
                        message: 'Successfully dispatched Gemini workflow',
                        dispatch_id: null,
                        workflow_run_url: `https://github.com/${repository}/actions/workflows/${workflowFile}`
                    });
                } else {
                    resolve({
                        request_id: requestId,
                        status: 'FAILED',
                        error: `Workflow dispatch failed: ${res.statusCode} - ${data}`
                    });
                }
            });
        });

        req.on('error', (e) => {
            resolve({
                request_id: requestId,
                status: 'FAILED',
                error: `Transport error: ${e.message}`
            });
        });

        req.write(JSON.stringify(workflowDispatchPayload));
        req.end();
    });
}

module.exports = { dispatchGeminiWorkflow };