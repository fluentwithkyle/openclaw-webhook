const {
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  validateStateTransitionWithEvidence,
  getRequiredEvidenceForTransition,
  createEvidenceRecord,
  AGENT_EVIDENCE_TYPE,
  EVIDENCE_TYPES,
  VALID_STATE_TRANSITIONS,
  BUILDER_CAPABILITIES
} = require('./schemas/acp-schema');
const taskRegistry = require('./task-registry');
const geminiTrigger = require('./gemini-trigger');
const geminiBuilderTrigger = require('./gemini-builder-trigger');

const BUILDER_API_KEY_ENV = 'GEMINI_BUILDER_API_KEY';

function validateRepositoryContext(report, expectedRepository, expectedBaseBranch) {
  if (report.repository && report.repository !== expectedRepository) {
    return { valid: false, error: `Repository mismatch: expected ${expectedRepository}, got ${report.repository}` };
  }
  if (report.base_branch && report.base_branch !== expectedBaseBranch) {
    return { valid: false, error: `Base branch mismatch: expected ${expectedBaseBranch}, got ${report.base_branch}` };
  }
  return { valid: true };
}

function handleKiloCompletion(requestId, report) {
  const validation = validateExecutionReport(report);
  if (!validation.valid) {
    return { success: false, error: `Invalid execution report: ${validation.error}`, stage: 'validation' };
  }

  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found in registry', stage: 'registry' };
  }

  const repoValidation = validateRepositoryContext(report, task.repository, task.base_branch);
  if (!repoValidation.valid) {
    return { success: false, error: repoValidation.error, stage: 'context' };
  }

  if (report.agent !== 'Kilo') {
    return { success: false, error: `Expected Kilo report, got ${report.agent}`, stage: 'agent' };
  }

  if (task.kilo.status === 'success' || task.kilo.status === 'failure' || task.kilo.status === 'blocked') {
    return { success: false, error: 'Kilo result already recorded (idempotency)', stage: 'idempotency', duplicate: true };
  }

  const executionId = report.execution_id || report.result?.execution_metadata?.invocation_id || null;
  const updateResult = taskRegistry.updateAgentResult(requestId, 'Kilo', {
    status: report.status,
    execution_id: executionId,
    report: report
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error, stage: 'update' };
  }

  let nextAction = null;

  if (report.status === 'success') {
    nextAction = 'trigger_builder';
  } else if (report.status === 'failure') {
    nextAction = 'human_review';
    const statusResult = taskRegistry.updateTaskStatus(requestId, 'FAILED');
    if (!statusResult.success) {
      return { success: false, error: statusResult.error, stage: 'status_transition' };
    }
  } else if (report.status === 'blocked') {
    nextAction = 'human_review';
    const statusResult = taskRegistry.updateTaskStatus(requestId, 'BLOCKED');
    if (!statusResult.success) {
      return { success: false, error: statusResult.error, stage: 'status_transition' };
    }
  }

  taskRegistry.setNextAction(requestId, nextAction);

  return {
    success: true,
    task: taskRegistry.getTask(requestId),
    next_action: nextAction,
    message: `Kilo completion recorded. Next: ${nextAction}`
  };
}

function handleGeminiCompletion(requestId, report) {
  const validation = validateExecutionReport(report);
  if (!validation.valid) {
    return { success: false, error: `Invalid execution report: ${validation.error}`, stage: 'validation' };
  }

  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found in registry', stage: 'registry' };
  }

  const repoValidation = validateRepositoryContext(report, task.repository, task.base_branch);
  if (!repoValidation.valid) {
    return { success: false, error: repoValidation.error, stage: 'context' };
  }

  if (report.agent !== 'Gemini') {
    return { success: false, error: `Expected Gemini report, got ${report.agent}`, stage: 'agent' };
  }

  if (task.gemini.status === 'success' || task.gemini.status === 'failure' || task.gemini.status === 'blocked') {
    return { success: false, error: 'Gemini result already recorded (idempotency)', stage: 'idempotency', duplicate: true };
  }

  const updateResult = taskRegistry.updateAgentResult(requestId, 'Gemini', {
    status: report.status,
    execution_id: report.execution_id || null,
    report: report
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error, stage: 'update' };
  }

  const evidenceCheck = taskRegistry.hasEvidenceOfType(requestId, AGENT_EVIDENCE_TYPE['Gemini']);
  if (report.status === 'success' && !evidenceCheck) {
    return {
      success: false,
      error: 'Gemini completion did not record INDEPENDENT_VERIFICATION evidence; transition blocked (fail closed)',
      stage: 'evidence'
    };
  }

  let nextStatus;
  let nextAction = null;

  if (report.status === 'success') {
    nextStatus = 'VERIFIED';
    nextAction = 'complete';
  } else if (report.status === 'failure') {
    nextStatus = 'FAILED';
    nextAction = 'human_review';
  } else if (report.status === 'blocked') {
    nextStatus = 'BLOCKED';
    nextAction = 'human_review';
  }

  const statusResult = taskRegistry.updateTaskStatus(requestId, nextStatus);
  if (!statusResult.success) {
    return { success: false, error: statusResult.error, stage: 'status_transition' };
  }

  taskRegistry.setNextAction(requestId, nextAction);

  return {
    success: true,
    task: statusResult.entry,
    next_action: nextAction,
    message: `Gemini completion recorded. Next: ${nextAction}`
  };
}

function handleGeminiBuilderCompletion(requestId, report) {
  const validation = validateExecutionReport(report);
  if (!validation.valid) {
    return { success: false, error: `Invalid execution report: ${validation.error}`, stage: 'validation' };
  }

  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found in registry', stage: 'registry' };
  }

  const repoValidation = validateRepositoryContext(report, task.repository, task.base_branch);
  if (!repoValidation.valid) {
    return { success: false, error: repoValidation.error, stage: 'context' };
  }

  if (report.agent !== 'Gemini Builder') {
    return { success: false, error: `Expected Gemini Builder report, got ${report.agent}`, stage: 'agent' };
  }

  if (task.builder.status === 'success' || task.builder.status === 'failure' || task.builder.status === 'blocked') {
    return { success: false, error: 'Gemini Builder result already recorded (idempotency)', stage: 'idempotency', duplicate: true };
  }

  const updateResult = taskRegistry.updateAgentResult(requestId, 'Gemini Builder', {
    status: report.status,
    execution_id: report.execution_id || null,
    report: report
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error, stage: 'update' };
  }

  let nextAction = null;

  if (report.status === 'success') {
    nextAction = 'trigger_gemini';
  } else if (report.status === 'failure') {
    nextAction = 'human_review';
    const statusResult = taskRegistry.updateTaskStatus(requestId, 'FAILED');
    if (!statusResult.success) {
      return { success: false, error: statusResult.error, stage: 'status_transition' };
    }
  } else if (report.status === 'blocked') {
    nextAction = 'human_review';
    const statusResult = taskRegistry.updateTaskStatus(requestId, 'BLOCKED');
    if (!statusResult.success) {
      return { success: false, error: statusResult.error, stage: 'status_transition' };
    }
  }

  taskRegistry.setNextAction(requestId, nextAction);

  return {
    success: true,
    task: taskRegistry.getTask(requestId),
    next_action: nextAction,
    message: `Gemini Builder completion recorded. Next: ${nextAction}`
  };
}

function determineNextAction(requestId) {
  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  return {
    success: true,
    next_action: task.next_action,
    status: task.status,
    current_agent: task.current_agent
  };
}

function canTriggerGemini(requestId) {
  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { canTrigger: false, reason: 'Task not found' };
  }

  if (task.kilo.status !== 'success') {
    return { canTrigger: false, reason: `Kilo status is ${task.kilo.status}, not success` };
  }

  if (task.gemini.status !== 'pending') {
    return { canTrigger: false, reason: `Gemini already ${task.gemini.status}` };
  }

  if (task.status !== 'EXECUTING') {
    return { canTrigger: false, reason: `Task status is ${task.status}, not EXECUTING` };
  }

  return { canTrigger: true };
}

async function triggerGemini(requestId, githubToken) {
  const canTriggerResult = canTriggerGemini(requestId);
  if (!canTriggerResult.canTrigger) {
    return { success: false, error: canTriggerResult.reason, stage: 'precondition' };
  }

  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found', stage: 'registry' };
  }

  const kiloExecutionId = task.kilo.execution_id || task.kilo.report?.result?.execution_metadata?.invocation_id || 'unknown';
  const verification = task.verification;
  const taskMode = task.task_mode || 'REVIEW';
  const capabilities = task.capabilities || ['read_only'];
  const permittedPaths = task.permitted_paths || [];

  const dispatchResult = await geminiTrigger.dispatchGemini(
    task.request_id,
    task.task,
    task.repository,
    task.base_branch,
    kiloExecutionId,
    githubToken,
    verification,
    taskMode,
    capabilities,
    permittedPaths
  );

  if (!dispatchResult.success) {
    return {
      success: false,
      error: dispatchResult.error,
      stage: 'dispatch',
      details: dispatchResult.details
    };
  }

  const updateResult = taskRegistry.updateAgentResult(requestId, 'Gemini', {
    status: 'running',
    execution_id: `dispatched-${Date.now()}`,
    report: null
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error, stage: 'update' };
  }

  taskRegistry.setNextAction(requestId, 'waiting_gemini_callback');

  return {
    success: true,
    message: 'Gemini workflow dispatched',
    dispatch_result: dispatchResult,
    task: taskRegistry.getTask(requestId)
  };
}

function canTriggerGeminiBuilder(requestId) {
  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { canTrigger: false, reason: 'Task not found' };
  }

  if (task.kilo.status !== 'success' && task.kilo.status !== 'pending') {
    return { canTrigger: false, reason: `Kilo status is ${task.kilo.status}, not success or pending` };
  }

  if (task.builder.status !== 'pending') {
    return { canTrigger: false, reason: `Builder already ${task.builder.status}` };
  }

  if (task.gemini.status !== 'pending') {
    return { canTrigger: false, reason: `Reviewer already ${task.gemini.status}` };
  }

  if (task.status !== 'EXECUTING') {
    return { canTrigger: false, reason: `Task status is ${task.status}, not EXECUTING` };
  }

  return { canTrigger: true };
}

async function triggerGeminiBuilder(requestId, githubToken, builderApiKey) {
  const canTriggerResult = canTriggerGeminiBuilder(requestId);
  if (!canTriggerResult.canTrigger) {
    return { success: false, error: canTriggerResult.reason, stage: 'precondition' };
  }

  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found', stage: 'registry' };
  }

  const executionId = task.builder.execution_id || `builder-dispatched-${Date.now()}`;
  const verification = task.verification;
  const taskMode = task.task_mode || 'BUILDER';
  const capabilities = task.capabilities || BUILDER_CAPABILITIES;
  const permittedPaths = task.permitted_paths || [];

  const dispatchResult = await geminiBuilderTrigger.dispatchGeminiBuilder(
    task.request_id,
    task.task,
    task.repository,
    task.base_branch,
    githubToken,
    verification,
    taskMode,
    capabilities,
    permittedPaths,
    builderApiKey
  );

  if (!dispatchResult.success) {
    return {
      success: false,
      error: dispatchResult.error,
      stage: 'dispatch',
      details: dispatchResult.details
    };
  }

  const updateResult = taskRegistry.updateAgentResult(requestId, 'Gemini Builder', {
    status: 'running',
    execution_id: executionId,
    report: null
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error, stage: 'update' };
  }

  taskRegistry.setNextAction(requestId, 'waiting_builder_callback');

  return {
    success: true,
    message: 'Gemini Builder workflow dispatched',
    dispatch_result: dispatchResult,
    task: taskRegistry.getTask(requestId)
  };
}

function getOrchestrationState(requestId) {
  const task = taskRegistry.getTask(requestId);
  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  return {
    success: true,
    state: {
      request_id: task.request_id,
      status: task.status,
      current_agent: task.current_agent,
      next_agent: task.next_agent,
      task_mode: task.task_mode || 'REVIEW',
      capabilities: task.capabilities || ['read_only'],
      kilo_status: task.kilo.status,
      gemini_status: task.gemini.status,
      builder_status: task.builder ? task.builder.status : null,
      next_action: task.next_action,
      evidence_count: task.evidence ? task.evidence.length : 0,
      created_at: task.created_at,
      updated_at: task.updated_at
    }
  };
}

const SUPPORTED_TRANSITIONS = { ...VALID_STATE_TRANSITIONS };

module.exports = {
  handleKiloCompletion,
  handleGeminiCompletion,
  handleGeminiBuilderCompletion,
  determineNextAction,
  canTriggerGemini,
  triggerGemini,
  canTriggerGeminiBuilder,
  triggerGeminiBuilder,
  getOrchestrationState,
  SUPPORTED_TRANSITIONS,
  validateRepositoryContext,
  validateStateTransitionWithEvidence,
  getRequiredEvidenceForTransition,
  createEvidenceRecord
};
