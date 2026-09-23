const { execSync } = require('child_process');
const path = require('path');

const schema = require('./schemas/acp-schema');

const ALLOWED_CAPABILITIES = ['read_only'];
const ALLOWED_BASE_PATH = 'poc/';

function normalizePath(p) {
    let normalized = p.replace(/\\/g, '/');
    if (normalized.startsWith('./')) normalized = normalized.substring(2);
    if (!normalized.endsWith('/')) normalized += '/';
    if (normalized.startsWith('/')) normalized = normalized.substring(1);

    if (normalized === 'poc/') return 'poc/';
    return null;
}

function validateReviewMode(command) {
    if (!command.authorization.capabilities ||
        !Array.isArray(command.authorization.capabilities) ||
        command.authorization.capabilities.length !== 1 ||
        command.authorization.capabilities[0] !== 'read_only') {
        return { status: 'BLOCKED', error: 'Invalid or missing authorization. Only ["read_only"] allowed.' };
    }

    if (!command.constraints.permitted_paths || !Array.isArray(command.constraints.permitted_paths)) {
        return { status: 'FAILED', error: 'Missing permitted_paths' };
    }

    for (const p of command.constraints.permitted_paths) {
        const normalized = normalizePath(p);
        if (normalized !== 'poc/') {
            return { status: 'BLOCKED', error: `Unauthorized path: ${p}` };
        }
    }

    return { status: 'SUCCESS' };
}

function validate(command) {
    const requiredFields = [
        'protocol_version', 'request_id', 'source', 'target', 'task_type',
        'repository', 'base_branch', 'task', 'constraints', 'authorization',
        'verification', 'reporting'
    ];
    for (const field of requiredFields) {
        if (!command[field]) return { status: 'FAILED', error: `Missing field: ${field}` };
    }

    const taskMode = command.task_mode || schema.DEFAULT_TASK_MODE;

    if (!schema.VALID_TASK_MODES.includes(taskMode)) {
        return { status: 'BLOCKED', error: `Invalid task_mode: ${taskMode}. Must be one of: ${schema.VALID_TASK_MODES.join(', ')}` };
    }

    if (taskMode === 'REVIEW') {
        return validateReviewMode(command);
    }

    const authResult = schema.validateAuthorization(command);
    if (!authResult.valid) {
        return { status: 'BLOCKED', error: authResult.error };
    }

    return { status: 'SUCCESS' };
}

function validateACPCompliance(command) {
    return schema.validateACPCompliance(command);
}

function validateActivationSyntax(activationText, expectedTarget) {
    return schema.validateActivationSyntax(activationText, expectedTarget);
}

function validateActivationSurface(surface, target) {
    return schema.validateActivationSurface(surface, target);
}

function getRequiredEvidenceForTransition(from, to) {
    return schema.getRequiredEvidenceForTransition(from, to);
}

function execute(command) {
    const v = validate(command);
    if (v.status !== 'SUCCESS') {
        return {
            request_id: command.request_id,
            status: 'BLOCKED',
            error: `Execution blocked: ${v.error}`
        };
    }

    try {
        if (command.task === 'inspect-poc-files') {
            const output = execSync('git ls-files poc/', { encoding: 'utf-8' });
            return {
                request_id: command.request_id,
                status: 'SUCCESS',
                task: command.task,
                execution: 'git ls-files poc/',
                result: output
            };
        }
        return { request_id: command.request_id, status: 'FAILED', error: 'Unknown task' };
    } catch (err) {
        return { request_id: command.request_id, status: 'FAILED', error: err.message };
    }
}

module.exports = {
  validate,
  execute,
  normalizePath,
  validateACPCompliance,
  validateActivationSyntax,
  validateActivationSurface,
  getRequiredEvidenceForTransition
};
