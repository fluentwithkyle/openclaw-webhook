const https = require('https');

const GITHUB_API_BASE = 'https://api.github.com';
const WORKFLOW_FILE = 'main.yml';
const REPOSITORY = 'fluentwithkyle/openclaw-webhook';

function triggerGeminiWorkflow(inputs, githubToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      ref: inputs.base_branch || 'main',
      inputs: {
        request_id: inputs.request_id,
        task: inputs.task,
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        kilo_execution_id: inputs.kilo_execution_id
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
        'User-Agent': 'openclaw-webhook-gemini-trigger'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) {
          resolve({
            success: true,
            message: 'Workflow dispatch accepted',
            status_code: res.statusCode
          });
        } else {
          resolve({
            success: false,
            error: `GitHub API error: ${res.statusCode}`,
            details: data,
            status_code: res.statusCode
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
}

async function dispatchGemini(requestId, task, repository, baseBranch, kiloExecutionId, githubToken) {
  if (!githubToken) {
    return {
      success: false,
      error: 'Missing GitHub token for workflow dispatch',
      stage: 'authentication'
    };
  }

  const inputs = {
    request_id: requestId,
    task: task,
    repository: repository,
    base_branch: baseBranch,
    kilo_execution_id: kiloExecutionId
  };

  try {
    const result = await triggerGeminiWorkflow(inputs, githubToken);
    return result;
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stage: 'dispatch'
    };
  }
}

function validateDispatchInputs(inputs) {
  const required = ['request_id', 'task', 'repository', 'base_branch', 'kilo_execution_id'];
  for (const field of required) {
    if (!inputs[field]) {
      return { valid: false, error: `Missing required input: ${field}` };
    }
  }
  return { valid: true };
}

module.exports = {
  dispatchGemini,
  validateDispatchInputs,
  triggerGeminiWorkflow
};