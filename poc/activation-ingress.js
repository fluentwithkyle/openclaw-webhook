const activationPolicy = require('./activation-policy');
const acpEngine = require('./acp-engine');
const taskRegistry = require('./task-registry');
const {
  validateACPCompliance,
  validateACPCommand,
  DEFAULT_TASK_MODE,
  VALID_TASK_MODES,
  VALID_AGENTS,
  isConsequentialCommand,
  getDirectorScope,
  calculateDirectorScopeHash
} = require('./schemas/acp-schema');

function canonicalExternalActivationIngress(request, dispatchContext) {
  const errors = [];
  const warnings = [];

  const rawRequest = request || {};
  if (!rawRequest || typeof rawRequest !== 'object') {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'authentication blocked',
      error: 'Invalid request: must be an object',
      error_code: 'INVALID_REQUEST'
    };
  }

  const canonical = activationPolicy.canonicalizeExternalActivation({
    activation_surface: rawRequest.activation_surface,
    activation_syntax: rawRequest.activation_syntax,
    activation_source: rawRequest.activation_source,
    activation_timestamp: rawRequest.activation_timestamp,
    activation_id: rawRequest.activation_id,
    target: rawRequest.target,
    task_mode: rawRequest.task_mode,
    request_id: rawRequest.request_id,
    claimed_authority: rawRequest.claimed_authority
  });

  const agent = canonical.activation_target;
  const taskMode = canonical.activation_task_mode || DEFAULT_TASK_MODE;

  if (!VALID_AGENTS.includes(agent)) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'validation blocked',
      error: 'Invalid or unauthorized target agent: ' + agent,
      error_code: 'INVALID_AGENT'
    };
  }

  if (!VALID_TASK_MODES.includes(taskMode)) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'validation blocked',
      error: 'Invalid task_mode: ' + taskMode,
      error_code: 'INVALID_TASK_MODE'
    };
  }

  const evaluation = activationPolicy.evaluateActivation(
    canonical.activation_request_id,
    agent,
    taskMode,
    canonical.activation_surface
  );

  if (!evaluation.allowed && activationPolicy.requiresActivation(agent, taskMode)) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'activation blocked',
      error: evaluation.reason,
      error_code: evaluation.error_code
    };
  }

  const authorityConflict = activationPolicy.isAuthorityConflict(rawRequest, canonical);
  if (authorityConflict.conflict) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'authorization blocked',
      error: 'Authority conflict detected on fields: ' + authorityConflict.conflicting_fields.join(', ') + '. Authority-bearing fields are server-derived.',
      error_code: 'AUTHORITY_CONFLICT',
      conflicting_fields: authorityConflict.conflicting_fields
    };
  }

  const authorityEnforcement = activationPolicy.enforceServerDerivedAuthority(rawRequest);
  if (!authorityEnforcement.valid) {
    const serverDerived = authorityEnforcement.server_derived || {};
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'authorization blocked',
      error: authorityEnforcement.error,
      error_code: authorityEnforcement.error_code,
      server_derived: serverDerived
    };
  }

  const serverDerived = authorityEnforcement.server_derived;
  const command = Object.assign({}, rawRequest, {
    target: agent,
    task_mode: taskMode,
    authorization: serverDerived.capabilities
      ? Object.assign({}, rawRequest.authorization || {}, { capabilities: serverDerived.capabilities })
      : rawRequest.authorization,
    constraints: serverDerived.permitted_paths
      ? Object.assign({}, rawRequest.constraints || {}, { permitted_paths: serverDerived.permitted_paths })
      : rawRequest.constraints
  });

  command.activation_surface = canonical.activation_surface;
  command.activation_syntax = canonical.activation_syntax;
  command.activation_source = canonical.activation_source;
  command.activation_id = canonical.activation_id;
  command.activation_timestamp = canonical.activation_timestamp;
  command.activation_target = agent;
  command.activation_task_mode = taskMode;
  command.activation_request_id = canonical.activation_request_id;

  const acpValidation = validateACPCompliance(command);
  if (!acpValidation.valid) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'validation blocked',
      error: 'ACP compliance failed: ' + acpValidation.error,
      error_code: 'ACP_COMPLIANCE_FAILED'
    };
  }

  const serverAuthCheck = acpEngine.validate(command);
  if (serverAuthCheck.status !== 'SUCCESS') {
    return {
      success: false,
      status: serverAuthCheck.status === 'BLOCKED' ? 'BLOCKED' : 'BLOCKED',
      stage: 'authorization blocked',
      error: 'Server authorization failed: ' + serverAuthCheck.error,
      error_code: 'SERVER_AUTHORIZATION_FAILED'
    };
  }

  const requestId = command.request_id;
  if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'validation blocked',
      error: 'request_id is required for external activation',
      error_code: 'MISSING_REQUEST_ID'
    };
  }

  const isConsequential = isConsequentialCommand(command);
  const existingTask = taskRegistry.getTask(requestId);
  if (existingTask) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'conflict',
      error: 'Duplicate request_id: ' + requestId,
      error_code: 'DUPLICATE_REQUEST_ID',
      duplicate: true,
      entry: existingTask
    };
  }

  let taskResult;
  if (isConsequential && dispatchContext && dispatchContext.director_approval_id) {
    taskResult = taskRegistry.createTaskWithDirectorAuthorization(command);
  } else if (isConsequential) {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'authorization blocked',
      error: 'Consequential command requires Director approval',
      error_code: 'DIRECTOR_APPROVAL_REQUIRED',
      director_approval_required: true
    };
  } else {
    taskResult = taskRegistry.createTask(command);
  }

  if (!taskResult.success) {
    if (taskResult.authorization) {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'authorization blocked',
        error: taskResult.error,
        error_code: 'REGISTRATION_AUTHORIZATION_BLOCKED'
      };
    }
    if (taskResult.duplicate) {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'conflict',
        error: taskResult.error,
        error_code: 'DUPLICATE_REQUEST_ID',
        duplicate: true,
        entry: taskResult.entry
      };
    }
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'registration failed',
      error: taskResult.error,
      error_code: 'REGISTRATION_FAILED'
    };
  }

  const taskEntry = taskResult.entry;
  taskEntry.activation_provenance = {
    activation_id: canonical.activation_id,
    activation_surface: canonical.activation_surface,
    activation_source: canonical.activation_source,
    activation_timestamp: canonical.activation_timestamp,
    activation_target: agent,
    activation_task_mode: taskMode
  };

  if (taskEntry.lineage && taskEntry.lineage.parent_activation_id) {
    taskEntry.activation_provenance.parent_activation = taskEntry.lineage.parent_activation_id;
  }

  taskRegistry.persistCache();

  return {
    success: true,
    request_id: requestId,
    task_status: taskEntry.status,
    task_entry: taskEntry,
    command: command,
    activation_provenance: taskEntry.activation_provenance,
    is_consequential: isConsequential
  };
}

module.exports = {
  canonicalExternalActivationIngress
};
