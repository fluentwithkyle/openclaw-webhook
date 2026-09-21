const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const orchestrator = require('./orchestrator');
const taskRegistry = require('./task-registry');
const {
  validateACPCommand,
  validateAuthorization
} = require('./schemas/acp-schema');

const SIGNAL_PATH_REGEX = /^poc\/signals\/([a-zA-Z0-9_-]+)\.json$/;

const DELIVERY_LOG_FILE = path.join(__dirname, 'delivery-log.json');
const DELIVERY_BACKUP_FILE = path.join(__dirname, 'delivery-log.json.bak');

const DEFAULT_REPOSITORY = 'fluentwithkyle/openclaw-webhook';
const DEFAULT_BRANCH = 'main';
const DEFAULT_REF = 'refs/heads/' + DEFAULT_BRANCH;
const SIGNAL_DIR = 'poc/signals/';

const DEFAULT_CONFIG = {
  repository: DEFAULT_REPOSITORY,
  branch: DEFAULT_BRANCH,
  ref: DEFAULT_REF,
  signalDir: SIGNAL_DIR
};

let _fetchSignalArtifact = null;
let _githubToken = null;

function loadDeliveryLog() {
  try {
    if (!fs.existsSync(DELIVERY_LOG_FILE)) {
      return {};
    }
    const data = fs.readFileSync(DELIVERY_LOG_FILE, 'utf8');
    return JSON.parse(data || '{}');
  } catch (err) {
    return {};
  }
}

function saveDeliveryLog(log) {
  try {
    const json = JSON.stringify(log, null, 2);
    fs.writeFileSync(DELIVERY_BACKUP_FILE, json, 'utf8');
    fs.renameSync(DELIVERY_BACKUP_FILE, DELIVERY_LOG_FILE);
  } catch (err) {
    return;
  }
}

function hasProcessedDelivery(deliveryId) {
  if (!deliveryId) {
    return false;
  }
  const log = loadDeliveryLog();
  return !!log[deliveryId];
}

function markDeliveryProcessed(deliveryId, signalId) {
  if (!deliveryId) {
    return;
  }
  const log = loadDeliveryLog();
  log[deliveryId] = {
    signal_id: signalId,
    processed_at: new Date().toISOString()
  };
  saveDeliveryLog(log);
}

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) {
    return false;
  }
  if (typeof rawBody === 'string') {
    rawBody = Buffer.from(rawBody, 'utf8');
  }
  const expected =
    'sha256=' + crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (err) {
    return false;
  }
}

function extractRequestIdFromPath(filePath) {
  if (!filePath) {
    return null;
  }
  const normalized = filePath.replace(/^\.\/+/, '');
  const match = normalized.match(SIGNAL_PATH_REGEX);
  return match ? match[1] : null;
}

function findSignalFiles(commits) {
  const signalFiles = [];
  if (!Array.isArray(commits)) {
    return signalFiles;
  }
  for (const commit of commits) {
    const added = commit.added || [];
    for (const filePath of added) {
      const requestId = extractRequestIdFromPath(filePath);
      if (requestId) {
        signalFiles.push({
          filePath: filePath,
          requestId: requestId,
          commitSha: commit.id || commit.sha
        });
      }
    }
  }
  return signalFiles;
}

async function defaultFetchSignalArtifact(commitSha, filePath, githubToken) {
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/');
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path:
        '/repos/' +
        DEFAULT_REPOSITORY +
        '/contents/' +
        encodedPath +
        '?ref=' +
        commitSha,
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + githubToken,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'openclaw-webhook-git-signal-poc'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const content = Buffer.from(parsed.content, 'base64').toString('utf8');
            const signal = JSON.parse(content);
            resolve({ success: true, signal: signal });
          } catch (err) {
            reject(new Error('Failed to decode signal file: ' + err.message));
          }
        } else {
          reject(
            new Error(
              'GitHub API error: ' + res.statusCode + ' - ' + data.substring(0, 200)
            )
          );
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getFetchSignalArtifact() {
  return _fetchSignalArtifact || defaultFetchSignalArtifact;
}

function setFetchSignalArtifact(fn) {
  _fetchSignalArtifact = fn;
}

function setGithubToken(token) {
  _githubToken = token;
}

let _fetchACPCommand = null;

function setFetchACPCommand(fn) {
  _fetchACPCommand = fn;
}

function getFetchACPCommand() {
  return _fetchACPCommand || defaultFetchACPCommandFromGitHub;
}

async function defaultFetchACPCommandFromGitHub(requestId, githubToken) {
  if (!githubToken) {
    return {
      success: false,
      error: 'GitHub token required to fetch ACP command from issue'
    };
  }

  const query =
    'repo:' + DEFAULT_REPOSITORY + ' "' + requestId + '" in:title is:issue';

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/search/issues?q=' + encodeURIComponent(query) + '&per_page=1',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + githubToken,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'openclaw-webhook-git-signal-poc-recover'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.items && parsed.items.length > 0) {
              resolve({ success: true, issue: parsed.items[0] });
            } else {
              resolve({
                success: false,
                error:
                  'No GitHub issue found for request_id: ' + requestId
              });
            }
          } catch (err) {
            resolve({
              success: false,
              error:
                'Failed to parse GitHub search response: ' + err.message
            });
          }
        } else {
          resolve({
            success: false,
            error:
              'GitHub API error (' +
              res.statusCode +
              '): ' +
              data.substring(0, 200)
          });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: 'GitHub API request failed: ' + err.message });
    });
    req.end();
  });
}

function extractMarkdownSection(body, header) {
  if (!body || typeof body !== 'string') {
    return '';
  }
  const lines = body.split('\n');
  let inSection = false;
  let sectionLines = [];
  const headerPattern = new RegExp(
    '^#{1,6}\\s+' + header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$',
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headerPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join('\n').trim();
}

function parseMarkdownKeyValueList(text) {
  const fields = {};
  if (!text) {
    return fields;
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*-\s*(\w+):\s*(.+?)\s*$/);
    if (match) {
      fields[match[1]] = match[2];
    }
  }
  return fields;
}

function parseMarkdownList(text) {
  const items = [];
  if (!text) {
    return items;
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*-\s*(.+?)\s*$/);
    if (match) {
      items.push(match[1].replace(/`/g, '').trim());
    }
  }
  return items;
}

function extractPermittedPaths(text) {
  var paths = [];

  if (text) {
    var backtickRegex = /`([^`]+)`/g;
    var match;
    while ((match = backtickRegex.exec(text)) !== null) {
      paths.push(match[1]);
    }

    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var listMatch = lines[i].match(/^\s*-\s+(.+?)\s*$/);
      if (listMatch && !listMatch[1].includes('`')) {
        var itemText = listMatch[1].toLowerCase();
        if (itemText.includes('test')) {
          if (!paths.includes('test/')) {
            paths.push('test/');
          }
        }
      }
    }
  }

  if (paths.length === 0) {
    paths.push('poc/');
  }

  return paths;
}

function parseACPCommandFromIssueBody(body, requestId) {
  var envelopeSection = extractMarkdownSection(body, 'ACP Envelope');
  var envelopeFields = parseMarkdownKeyValueList(envelopeSection);

  var capabilitiesSection = extractMarkdownSection(body, 'Capabilities');
  var capabilities = parseMarkdownList(capabilitiesSection);

  var areasSection = extractMarkdownSection(body, 'Required Implementation Areas');
  var permittedPaths = extractPermittedPaths(areasSection);

  var objectiveSection = extractMarkdownSection(body, 'Objective');
  var task = objectiveSection
    ? objectiveSection.split('\n\n')[0].trim()
    : '';

  var verificationSection = extractMarkdownSection(body, 'Verification');
  var verification = verificationSection
    ? verificationSection.split('\n\n')[0].trim()
    : '';

  return {
    protocol_version: envelopeFields.protocol_version || 'ACP-1.0',
    request_id: envelopeFields.request_id || requestId,
    source: envelopeFields.source || 'ChatGPT',
    target: envelopeFields.target || 'Kilo',
    task_type: envelopeFields.task_type || 'implementation',
    repository: envelopeFields.repository || DEFAULT_REPOSITORY,
    base_branch: envelopeFields.base_branch || DEFAULT_BRANCH,
    task: task,
    task_mode: envelopeFields.task_mode || 'FAILOVER_EXECUTE',
    constraints: {
      permitted_paths: permittedPaths
    },
    authorization: {
      capabilities: capabilities
    },
    verification: verification,
    reporting: 'structured-json',
    originator: envelopeFields.originator || 'Kyle'
  };
}

async function recoverTaskFromGitHub(requestId, githubToken) {
  try {
    var fetcher = getFetchACPCommand();
    var fetchResult = await fetcher(requestId, githubToken);
    if (!fetchResult || !fetchResult.success) {
      return {
        success: false,
        error: fetchResult
          ? fetchResult.error
          : 'Failed to fetch ACP command from GitHub'
      };
    }

    var issue = fetchResult.issue;
    var command = parseACPCommandFromIssueBody(issue.body, requestId);

    if (command.request_id !== requestId) {
      return {
        success: false,
        error:
          'Request ID mismatch: issue body request_id (' +
          command.request_id +
          ') does not match signal request_id (' +
          requestId +
          ')'
      };
    }

    var commandValidation = validateACPCommand(command);
    if (!commandValidation.valid) {
      return {
        success: false,
        error: 'ACP command validation failed: ' + commandValidation.error
      };
    }

    var authValidation = validateAuthorization(command);
    if (!authValidation.valid) {
      return {
        success: false,
        error:
          'ACP authorization validation failed: ' + authValidation.error
      };
    }

    var caps = command.authorization.capabilities;
    if (!caps.includes('commit') || !caps.includes('push')) {
      return {
        success: false,
        error:
          'Recovered ACP command does not authorize execution path ' +
          '(requires commit and push capabilities)'
      };
    }

    var rehydrateResult = taskRegistry.rehydrateTask(command);
    if (!rehydrateResult.success) {
      return {
        success: false,
        error: 'TaskRegistry rehydration failed: ' + rehydrateResult.error
      };
    }

    return {
      success: true,
      command: command,
      entry: rehydrateResult.entry,
      rehydrated: rehydrateResult.rehydrated,
      issueNumber: issue.number
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function validateSignal(signal, requestId, commitSha, config) {
  const errors = [];

  if (!signal || typeof signal !== 'object') {
    return { valid: false, errors: ['Signal must be an object'] };
  }

  if (signal.request_id !== requestId) {
    errors.push(
      'Request ID mismatch: expected ' + requestId + ', got ' + signal.request_id
    );
  }

  if (signal.commit_sha) {
    if (signal.commit_sha !== commitSha) {
      errors.push(
        'Commit SHA mismatch: expected ' + commitSha + ', got ' + signal.commit_sha
      );
    }
  }

  if (signal.repository && signal.repository !== config.repository) {
    errors.push(
      'Repository mismatch: expected ' +
        config.repository +
        ', got ' +
        signal.repository
    );
  }

  if (signal.base_branch && signal.base_branch !== config.branch) {
    errors.push(
      'Base branch mismatch: expected ' +
        config.branch +
        ', got ' +
        signal.base_branch
    );
  }

  if (!signal.signal_id) {
    errors.push('Missing signal_id');
  }

  if (!['success', 'failure', 'blocked'].includes(signal.status)) {
    errors.push(
      'Invalid status: ' +
        signal.status +
        '. Must be one of: success, failure, blocked'
    );
  }

  if (!signal.result || typeof signal.result !== 'object') {
    errors.push('Missing result object');
  } else {
    if (
      !signal.result.execution_metadata ||
      typeof signal.result.execution_metadata !== 'object'
    ) {
      errors.push('Missing result.execution_metadata');
    } else if (
      !signal.result.execution_metadata.invocation_id ||
      typeof signal.result.execution_metadata.invocation_id !== 'string'
    ) {
      errors.push(
        'result.execution_metadata.invocation_id is required and must be a string'
      );
    }
  }

  if (!Array.isArray(signal.changed_files)) {
    errors.push('changed_files must be an array');
  }

  if (!Array.isArray(signal.verification)) {
    errors.push('verification must be an array');
  }

  if (!Array.isArray(signal.blockers)) {
    errors.push('blockers must be an array');
  }

  if (typeof signal.push !== 'boolean') {
    errors.push('push must be a boolean');
  }

  return errors.length > 0 ? { valid: false, errors: errors } : { valid: true };
}

function buildCompletionReport(signal, headCommitSha) {
  const report = Object.assign({}, signal);
  report.agent = 'Kilo';
  if (headCommitSha) {
    report.commit_sha = headCommitSha;
  }
  if (!report.result || !report.result.execution_metadata) {
    report.result = {
      execution_metadata: {
        invocation_id: report.signal_id || report.request_id,
        run_id: report.commit_sha
      }
    };
  }
  report.commit = report.commit_sha || report.commit;
  report.push = true;
  return report;
}

async function processSignalFile(signalFile, headCommit, config, token) {
  const filePath = signalFile.filePath;
  const requestId = signalFile.requestId;
  const commitSha = headCommit.id;

  const fetcher = getFetchSignalArtifact();
  let signal;
  try {
    const fetchResult = await fetcher(commitSha, filePath, token);
    if (!fetchResult || !fetchResult.success) {
      return {
        status: 'failed',
        requestId: requestId,
        signalId: null,
        commitSha: commitSha,
        error: 'Failed to fetch signal artifact',
        stage: 'fetch'
      };
    }
    signal = fetchResult.signal;
  } catch (err) {
    return {
      status: 'failed',
      requestId: requestId,
      signalId: null,
      commitSha: commitSha,
      error: err.message,
      stage: 'fetch'
    };
  }

  if (!signal || !signal.signal_id) {
    return {
      status: 'rejected',
      requestId: requestId,
      signalId: null,
      commitSha: commitSha,
      error: 'Malformed completion signal: missing signal_id',
      stage: 'validation'
    };
  }

  const validation = validateSignal(signal, requestId, commitSha, config);
  if (!validation.valid) {
    return {
      status: 'rejected',
      requestId: requestId,
      signalId: signal.signal_id,
      commitSha: commitSha,
      error: 'Signal validation failed: ' + validation.errors.join('; '),
      stage: 'validation',
      validationErrors: validation.errors
    };
  }

  let task = taskRegistry.getTask(requestId);
  if (!task) {
    const recoveryResult = await recoverTaskFromGitHub(requestId, token);
    if (!recoveryResult.success) {
      return {
        status: 'rejected',
        requestId: requestId,
        signalId: signal.signal_id,
        commitSha: commitSha,
        error: 'TaskRegistry recovery failed: ' + recoveryResult.error,
        stage: 'recovery'
      };
    }
    task = taskRegistry.getTask(requestId);
    if (!task) {
      return {
        status: 'rejected',
        requestId: requestId,
        signalId: signal.signal_id,
        commitSha: commitSha,
        error:
          'TaskRegistry rehydration succeeded but task not found',
        stage: 'recovery'
      };
    }
  }

  if (task.kilo.status !== 'pending') {
    return {
      status: 'ignored',
      requestId: requestId,
      signalId: signal.signal_id,
      commitSha: commitSha,
      message: 'Kilo result already recorded (idempotency)',
      stage: 'idempotency',
      duplicate: true
    };
  }

  if (task.status !== 'EXECUTING') {
    return {
      status: 'rejected',
      requestId: requestId,
      signalId: signal.signal_id,
      commitSha: commitSha,
      error:
        'Task in invalid state: ' +
        task.status +
        ' (expected EXECUTING)',
      stage: 'state'
    };
  }

  const report = buildCompletionReport(signal, commitSha);

  let orchestratorResult;
  try {
    orchestratorResult = orchestrator.handleKiloCompletion(requestId, report);
  } catch (err) {
    return {
      status: 'failed',
      requestId: requestId,
      signalId: signal.signal_id,
      commitSha: commitSha,
      error: err.message,
      stage: 'orchestrator'
    };
  }

  if (!orchestratorResult.success) {
    return {
      status: 'failed',
      requestId: requestId,
      signalId: signal.signal_id,
      commitSha: commitSha,
      error: orchestratorResult.error,
      stage: orchestratorResult.stage
    };
  }

  let geminiResult = null;
  if (orchestratorResult.next_action === 'trigger_gemini') {
    if (token) {
      try {
        geminiResult = await orchestrator.triggerGemini(requestId, token);
      } catch (err) {
        geminiResult = {
          success: false,
          error: err.message,
          stage: 'gemini_dispatch'
        };
      }
    }
  }

  return {
    status: 'completed',
    requestId: requestId,
    signalId: signal.signal_id,
    commitSha: commitSha,
    nextAction: orchestratorResult.next_action,
    geminiTrigger: geminiResult,
    taskStatus: orchestratorResult.task.status,
    kiloStatus: orchestratorResult.task.kilo.status
  };
}

async function processPushEvent(payload, deliveryId, options) {
  options = options || {};
  const config = Object.assign({}, DEFAULT_CONFIG, options.config || {});
  const token =
    options.githubToken ||
    _githubToken ||
    process.env.ORCHESTRATOR_GH_TOKEN ||
    process.env.GITHUB_TOKEN;

  if (options.rawBody && options.signature !== undefined) {
    const secret = options.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
    if (secret) {
      if (!verifySignature(options.rawBody, options.signature, secret)) {
        return {
          status: 'blocked',
          stage: 'signature',
          error: 'Invalid webhook signature'
        };
      }
    }
  }

  if (!payload || typeof payload !== 'object' || payload.ref === undefined) {
    return {
      status: 'ignored',
      message: 'Not a push event'
    };
  }

  const repoFullName =
    payload.repository && payload.repository.full_name
      ? payload.repository.full_name
      : null;

  if (repoFullName !== config.repository) {
    return {
      status: 'blocked',
      stage: 'repository',
      error:
        'Repository mismatch: expected ' +
        config.repository +
        ', got ' +
        repoFullName
    };
  }

  if (payload.ref !== config.ref) {
    return {
      status: 'ignored',
      message: 'Not a push to ' + config.branch + ' (ref: ' + payload.ref + ')'
    };
  }

  if (deliveryId && hasProcessedDelivery(deliveryId)) {
    return {
      status: 'processed',
      deliveryId: deliveryId,
      message: 'Delivery already processed'
    };
  }

  const allCommits = payload.commits || [];
  const signalFiles = findSignalFiles(allCommits);

  if (signalFiles.length === 0) {
    return {
      status: 'ignored',
      message:
        'No Kilo completion signal files found in push - unrelated push or Gemini reconciliation commit'
    };
  }

  const headCommit = payload.head_commit || {};
  const results = [];

  for (const signalFile of signalFiles) {
    const result = await processSignalFile(signalFile, headCommit, config, token);
    results.push(result);

    if (result.status === 'completed' || result.status === 'failed') {
      if (deliveryId) {
        markDeliveryProcessed(deliveryId, result.signalId);
      }
    }
  }

  return {
    status: 'completed',
    deliveryId: deliveryId,
    results: results
  };
}

module.exports = {
  verifySignature,
  extractRequestIdFromPath,
  findSignalFiles,
  validateSignal,
  buildCompletionReport,
  processPushEvent,
  processSignalFile,
  hasProcessedDelivery,
  markDeliveryProcessed,
  setFetchSignalArtifact,
  getFetchSignalArtifact,
  setFetchACPCommand,
  getFetchACPCommand,
  defaultFetchACPCommandFromGitHub,
  extractMarkdownSection,
  parseMarkdownKeyValueList,
  parseMarkdownList,
  extractPermittedPaths,
  parseACPCommandFromIssueBody,
  recoverTaskFromGitHub,
  setGithubToken,
  loadDeliveryLog,
  saveDeliveryLog,
  SIGNAL_PATH_REGEX,
  DEFAULT_REPOSITORY,
  DEFAULT_BRANCH,
  DEFAULT_REF,
  SIGNAL_DIR,
  DEFAULT_CONFIG
};
