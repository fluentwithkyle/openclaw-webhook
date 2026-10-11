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

function authenticateCarrier(dispatchContext) {
  const carrier = dispatchContext && dispatchContext.carrier_identity;
  if (!carrier || typeof carrier !== 'string' || carrier.trim() === '') {
    return { valid: false, error: 'Missing carrier identity', error_code: 'CARRIER_IDENTITY_REQUIRED' };
  }
  return { valid: true };
}

async function canonicalExternalActivationIngress(request, dispatchContext) {
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

  const directorApprovalId = dispatchContext && dispatchContext.director_approval_id;
  const directorAdmission = dispatchContext && dispatchContext.director_admission;
  if ((directorApprovalId || directorAdmission) && isConsequentialCommand(command)) {
    const rawPermittedPaths = rawRequest.constraints && rawRequest.constraints.permitted_paths;
    if (directorApprovalId) {
      const directorApproval = taskRegistry.getDirectorApproval(directorApprovalId);
      const approvalStatus = directorApproval && directorApproval.status;
      const isPreApproved = approvalStatus === 'PENDING' || approvalStatus === 'CONSUMED';
      if (directorApproval && isPreApproved &&
          Date.parse(directorApproval.expiry) > Date.now() &&
          directorApproval.scope_hash) {
        if (Array.isArray(rawPermittedPaths) && rawPermittedPaths.length > 0) {
          const candidateScope = Object.assign({}, getDirectorScope(command), { permitted_paths: rawPermittedPaths });
          const candidateHash = calculateDirectorScopeHash(candidateScope);
          if (candidateHash === directorApproval.scope_hash) {
            const approvedPaths = activationPolicy.intersectPathsWithMaxBoundary(rawPermittedPaths);
            if (approvedPaths.length > 0) {
              command.constraints = Object.assign({}, command.constraints || {}, { permitted_paths: approvedPaths });
            }
          }
        }
      }
    } else {
      if (Array.isArray(rawPermittedPaths) && rawPermittedPaths.length > 0) {
        const approvedPaths = activationPolicy.intersectPathsWithMaxBoundary(rawPermittedPaths);
        if (approvedPaths.length > 0) {
          command.constraints = Object.assign({}, command.constraints || {}, { permitted_paths: approvedPaths });
        }
      }
    }
  }

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

  const replayResult = taskRegistry.replayTask(command);
  if (replayResult.success && replayResult.replay) {
    if (replayResult.task_terminated) {
      return {
        success: true,
        replay: true,
        request_id: requestId,
        task_status: replayResult.entry.status,
        task_entry: replayResult.entry,
        command: command,
        activation_provenance: replayResult.entry.activation_provenance || undefined,
        is_consequential: isConsequential,
        message: 'Replay matched existing terminated task; no new execution initiated'
      };
    }
    return {
      success: true,
      replay: true,
      request_id: requestId,
      task_status: replayResult.entry.status,
      task_entry: replayResult.entry,
      command: command,
      activation_provenance: replayResult.entry.activation_provenance || undefined,
      is_consequential: isConsequential,
      message: 'Replay matched existing active task; no duplicate created'
    };
  }

  if (replayResult.error_code === 'REPLAY_PAYLOAD_MISMATCH') {
    return {
      success: false,
      status: 'BLOCKED',
      stage: 'conflict',
      error: 'Replay payload does not match original task payload: ' + replayResult.error,
      error_code: 'REPLAY_PAYLOAD_MISMATCH',
      existing_request_id: requestId,
      task_status: replayResult.task_status
    };
  }

  let taskResult;
  if (isConsequential && dispatchContext && dispatchContext.director_approval_id) {
    if (!command.task_name || typeof command.task_name !== 'string' || command.task_name.trim() === '') {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'validation blocked',
        error: 'task_name is required for consequential external activation (FAILOVER_EXECUTE or BUILDER); canonical ACP task identity must not be null or empty',
        error_code: 'MISSING_TASK_NAME'
      };
    }
    taskResult = await taskRegistry.createTaskWithDirectorAuthorization(command);
  } else if (isConsequential && dispatchContext && dispatchContext.director_admission) {
    if (!command.task_name || typeof command.task_name !== 'string' || command.task_name.trim() === '') {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'validation blocked',
        error: 'task_name is required for consequential external activation (FAILOVER_EXECUTE or BUILDER); canonical ACP task identity must not be null or empty',
        error_code: 'MISSING_TASK_NAME'
      };
    }
    taskResult = await taskRegistry.createTaskWithAutoDirectorAuthorization(command);
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
    taskResult = await taskRegistry.createTask(command);
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

  await taskRegistry.persistCache();

  const requiredPrerequisites = activationPolicy.getRequiredConfigPrerequisites(taskMode);
  for (const prereqSpec of requiredPrerequisites) {
    await taskRegistry.declareConfigPrerequisite(
      requestId,
      prereqSpec.config_key,
      prereqSpec.reason,
      prereqSpec.mode,
      prereqSpec.required
    );
  }

   if (requiredPrerequisites.length > 0) {
    const prerequisiteCheck = await taskRegistry.checkPrerequisites(requestId);
    if (!prerequisiteCheck.success && isConsequential) {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'configuration prerequisite check',
         error: prerequisiteCheck.error,
         error_code: 'CONFIG_PREREQUISITE_UNSATISFIED',
        request_id: requestId,
        command: command,
        activation_provenance: taskEntry.activation_provenance,
        is_consequential: isConsequential,
        config_state: prerequisiteCheck.config_state,
        director_notified: prerequisiteCheck.director_notified,
        has_unknown: prerequisiteCheck.has_unknown,
        blocking_prerequisites: prerequisiteCheck.blocking_prerequisites,
        director_notifications: prerequisiteCheck.notifications,
        task_entry: taskRegistry.getTask(requestId),
        message: 'External configuration prerequisite unsatisfied; Director notified and consequential execution blocked (fail closed)'
      };
    }
  }

  const carrierIdentity = dispatchContext && dispatchContext.carrier_identity;
  const carrierType = dispatchContext && dispatchContext.carrier_type;

  if (carrierIdentity) {
    const carrierAuth = authenticateCarrier(dispatchContext);
    if (!carrierAuth.valid) {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'carrier authentication blocked',
        error: carrierAuth.error,
        error_code: carrierAuth.error_code,
        request_id: requestId,
        command: command,
        activation_provenance: taskEntry.activation_provenance,
        is_consequential: isConsequential,
        task_entry: taskEntry
      };
    }

    const transitionResult = await taskRegistry.transitionToExecuting(requestId);
    if (!transitionResult.success) {
      return {
        success: false,
        status: 'BLOCKED',
        stage: 'state transition failed',
        error: transitionResult.error,
        error_code: 'STATE_TRANSITION_FAILED',
        request_id: requestId,
        command: command,
        activation_provenance: taskEntry.activation_provenance,
        is_consequential: isConsequential,
        task_entry: taskRegistry.getTask(requestId)
      };
    }

    const claimIdentity = {
      carrier_id: carrierIdentity,
      carrier_type: carrierType || 'github_workflow'
    };

    const claimResult = await taskRegistry.claimExecutionContext(requestId, claimIdentity);

    if (!claimResult.success) {
      return {
        success: false,
        status: claimResult.status,
        stage: 'execution claim',
        error: claimResult.error,
        error_code: claimResult.error_code,
        request_id: requestId,
        command: command,
        activation_provenance: taskEntry.activation_provenance,
        is_consequential: isConsequential,
        claim_result: claimResult.status === 'ALREADY_CLAIMED' ? { existing_claim: claimResult.existing_claim } : undefined
      };
    }

    const executionDescriptor = taskRegistry.buildExecutionDescriptor(
      requestId,
      taskRegistry.getTask(requestId),
      claimResult.execution_claim_id
    );

    return {
      success: true,
      request_id: requestId,
      task_status: 'EXECUTING',
      task_entry: taskRegistry.getTask(requestId),
      command: command,
      activation_provenance: taskEntry.activation_provenance,
      is_consequential: isConsequential,
      execution_claimed: true,
      execution_claim_id: claimResult.execution_claim_id,
      execution_descriptor: executionDescriptor,
      carrier_identity: claimResult.carrier_identity,
      message: 'Task admitted and execution claim acquired; carrier may invoke agent with server-derived descriptor'
    };
  }

  return {
    success: true,
    request_id: requestId,
    task_status: taskEntry.status,
    task_entry: taskEntry,
    command: command,
    activation_provenance: taskEntry.activation_provenance,
    is_consequential: isConsequential,
    execution_claimed: false,
    message: 'Task admitted; no carrier identity provided, execution claim pending'
  };
}

module.exports = {
  canonicalExternalActivationIngress,
  authenticateCarrier
};
