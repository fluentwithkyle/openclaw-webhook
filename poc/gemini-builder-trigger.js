const https = require('https');

const GITHUB_API_BASE = 'https://api.github.com';
const WORKFLOW_FILE = 'gemini-builder.yml';
const REPOSITORY = 'fluentwithkyle/openclaw-webhook';

function classifyGitHubDispatchFailure(statusCode) {
  if (statusCode === 401) return { stage: 'authentication', category: 'github_authentication_failed' };
  if (statusCode === 403) return { stage: 'authorization', category: 'github_authorization_failed' };
  if (statusCode === 404) return { stage: 'workflow', category: 'workflow_not_found' };
  if (statusCode === 422) return { stage: 'input', category: 'workflow_input_rejected' };
  if (statusCode >= 500) return { stage: 'github', category: 'github_service_failure' };
  return { stage: 'github', category: 'github_dispatch_failed' };
}

function triggerGeminiBuilderWorkflow(inputs, githubToken, request = https.request) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      ref: inputs.base_branch || 'main',
      inputs: {
        request_id: inputs.request_id,
        task: inputs.task,
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        builder_execution_id: inputs.builder_execution_id,
        verification: inputs.verification || '',
        task_mode: inputs.task_mode || 'BUILDER',
        capabilities: Array.isArray(inputs.capabilities) ? inputs.capabilities.join(',') : (inputs.capabilities || 'read_only,modify_files,run_tests,commit,push'),
        permitted_paths: Array.isArray(inputs.permitted_paths) ? inputs.permitted_paths.join(',') : ''
      }
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'openclaw-webhook-gemini-builder-trigger'
      }
    };

    const req = request(options, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 204) {
          resolve({
            success: true,
            message: 'Builder workflow dispatch accepted',
            status_code: res.statusCode,
            stage: 'dispatch',
            category: 'accepted'
          });
        } else {
          const diagnostic = classifyGitHubDispatchFailure(res.statusCode);
          resolve({
            success: false,
            error: `GitHub workflow dispatch failed (${diagnostic.category})`,
            status_code: res.statusCode,
            stage: diagnostic.stage,
            category: diagnostic.category,
            workflow: WORKFLOW_FILE,
            repository: REPOSITORY
          });
        }
      });
    });

    req.on('error', reject);

    req.write(postData);
    req.end();
  });
}

async function dispatchGeminiBuilder(requestId, task, repository, baseBranch, githubToken, verification, taskMode, capabilities, permittedPaths, builderApiKey, request) {
  if (!githubToken) {
    return {
      success: false,
      error: 'Missing GitHub token for builder workflow dispatch',
      stage: 'authentication',
      category: 'missing_github_token',
      workflow: WORKFLOW_FILE,
      repository: REPOSITORY
    };
  }

  const inputs = {
    request_id: requestId,
    task: task,
    repository: repository,
    base_branch: baseBranch,
    builder_execution_id: `builder-${requestId}-${Date.now()}`,
    verification: verification,
    task_mode: taskMode || 'BUILDER',
    capabilities: capabilities || ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    permitted_paths: permittedPaths || []
  };

  try {
    const result = await triggerGeminiBuilderWorkflow(inputs, githubToken, request);
    return result;
  } catch (err) {
    return {
      success: false,
      error: 'GitHub workflow dispatch network failure',
      stage: 'network',
      category: 'network_failure',
      workflow: WORKFLOW_FILE,
      repository: REPOSITORY
    };
  }
}

function validateDispatchInputs(inputs) {
  const required = ['request_id', 'task', 'repository', 'base_branch'];
  for (const field of required) {
    if (!inputs[field]) {
      return { valid: false, error: `Missing required input: ${field}` };
    }
  }
  return { valid: true };
}

module.exports = {
  dispatchGeminiBuilder,
  validateDispatchInputs,
  triggerGeminiBuilderWorkflow,
  classifyGitHubDispatchFailure,
  WORKFLOW_FILE
};
