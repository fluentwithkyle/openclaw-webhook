const {
  validateExecutionReport,
  validateTaskRegistryEntry,
  isValidStateTransition,
  VALID_STATE_TRANSITIONS
} = require('./schemas/acp-schema');
const taskRegistry = require('./task-registry');

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

  const updateResult = taskRegistry.updateAgentResult(requestId, 'Kilo', {
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
    // Task remains in EXECUTING - no state transition needed
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
      kilo_status: task.kilo.status,
      gemini_status: task.gemini.status,
      next_action: task.next_action,
      created_at: task.created_at,
      updated_at: task.updated_at
    }
  };
}

const SUPPORTED_TRANSITIONS = { ...VALID_STATE_TRANSITIONS };

module.exports = {
  handleKiloCompletion,
  handleGeminiCompletion,
  determineNextAction,
  canTriggerGemini,
  getOrchestrationState,
  SUPPORTED_TRANSITIONS,
  validateRepositoryContext
};