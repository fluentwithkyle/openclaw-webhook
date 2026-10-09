const VALID_AGENTS = ['Kilo', 'Gemini', 'Gemini Builder', 'Security Specialist', 'Utility Specialist'];
const VALID_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT'];
const DEFAULT_TASK_MODE = 'REVIEW';

const REVIEW_CAPABILITIES = ['read_only'];
const VERIFY_RECONCILE_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push'];
const FAILOVER_EXECUTE_CAPABILITIES = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
const BUILDER_CAPABILITIES = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
const RESEARCH_DOCUMENT_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push'];

const VERIFY_RECONCILE_PATHS = ['docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md'];
const RESEARCH_DOCUMENT_PATHS = ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md', 'docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md', 'docs/ai/README.md', 'docs/ai/ARCH_DECISIONS.md', 'poc/schemas/acp-schema.js', 'test/schema.test.js'];

function getRequiredCapabilitiesForMode(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  switch (mode) {
    case 'VERIFY_RECONCILE': return VERIFY_RECONCILE_CAPABILITIES;
    case 'FAILOVER_EXECUTE': return FAILOVER_EXECUTE_CAPABILITIES;
    case 'BUILDER': return BUILDER_CAPABILITIES;
    case 'RESEARCH_DOCUMENT': return RESEARCH_DOCUMENT_CAPABILITIES;
    case 'REVIEW':
    default: return REVIEW_CAPABILITIES.slice();
  }
}

function getAuthorizedPathsForMode(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  if (mode === 'VERIFY_RECONCILE') return VERIFY_RECONCILE_PATHS;
  if (mode === 'RESEARCH_DOCUMENT') return RESEARCH_DOCUMENT_PATHS;
  return null;
}

const ACTIVATION_SURFACES = Object.freeze({
  github_issue_comment: Object.freeze({
    name: 'github_issue_comment',
    requires_activation_syntax: true,
    requires_activation_surface: true
  }),
  github_issue_body: Object.freeze({
    name: 'github_issue_body',
    requires_activation_syntax: true,
    requires_activation_surface: true
  }),
  github_push_event: Object.freeze({
    name: 'github_push_event',
    requires_activation_syntax: true,
    requires_activation_surface: true
  }),
  workflow_dispatch: Object.freeze({
    name: 'workflow_dispatch',
    requires_activation_syntax: false,
    requires_activation_surface: true
  })
});

const ACTIVATION_SURFACE_NAMES = Object.freeze(
  Object.values(ACTIVATION_SURFACES).map(s => s.name)
);

const EXECUTION_TASK_MODES = Object.freeze(['FAILOVER_EXECUTE', 'BUILDER']);

const MAX_AUTHORIZED_PATHS = Object.freeze(['docs/', 'test/', 'poc/', '.github/workflows/main.yml', '.github/workflows/gemini-builder.yml']);

function isPathWithinMaxBoundary(permittedPath) {
  return MAX_AUTHORIZED_PATHS.some(maxPath =>
    permittedPath === maxPath || permittedPath.startsWith(maxPath)
  );
}

function intersectPathsWithMaxBoundary(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter(p => isPathWithinMaxBoundary(p));
}

// Server-derived external configuration prerequisite gate.
// Each entry declares an external configuration key that must be satisfied
// (verified via runtime environment or TaskRegistry) before consequential
// execution. Only the identity is recorded here; secret values are never
// captured in TaskRegistry.
const CONFIG_PREREQUISITE_GATE = Object.freeze({
  'FAILOVER_EXECUTE': Object.freeze([
    {
      config_key: 'DIRECTOR_ORIGIN_SECRET',
      reason: 'Required for consequential FAILOVER_EXECUTE admission via the canonical activation ingress. Absence means external configuration has not been provisioned and the Director has not been notified.',
      mode: 'FAILOVER_EXECUTE',
      required: true
    }
  ]),
  'BUILDER': Object.freeze([
    {
      config_key: 'DIRECTOR_ORIGIN_SECRET',
      reason: 'Required for consequential BUILDER admission via the canonical activation ingress. Absence means external configuration has not been provisioned and the Director has not been notified.',
      mode: 'BUILDER',
      required: true
    }
  ])
});

const READ_ONLY_TASK_MODES = Object.freeze(['REVIEW', 'VERIFY_RECONCILE', 'RESEARCH_DOCUMENT']);

const ACTIVATION_POLICY = Object.freeze({
  'Kilo': Object.freeze({
    'REVIEW': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('REVIEW'),
      permitted_paths: getAuthorizedPathsForMode('REVIEW')
    }),
    'VERIFY_RECONCILE': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('VERIFY_RECONCILE'),
      permitted_paths: getAuthorizedPathsForMode('VERIFY_RECONCILE')
    }),
    'RESEARCH_DOCUMENT': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('RESEARCH_DOCUMENT'),
      permitted_paths: getAuthorizedPathsForMode('RESEARCH_DOCUMENT')
    }),
    'FAILOVER_EXECUTE': Object.freeze({
      requires_activation: true,
      permitted_surfaces: ['github_issue_comment', 'github_issue_body', 'github_push_event'],
      required_capabilities: getRequiredCapabilitiesForMode('FAILOVER_EXECUTE'),
      permitted_paths: getAuthorizedPathsForMode('FAILOVER_EXECUTE') || ['poc/']
    })
  }),
  'Gemini': Object.freeze({
    'REVIEW': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('REVIEW'),
      permitted_paths: getAuthorizedPathsForMode('REVIEW')
    }),
    'VERIFY_RECONCILE': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('VERIFY_RECONCILE'),
      permitted_paths: getAuthorizedPathsForMode('VERIFY_RECONCILE')
    }),
    'RESEARCH_DOCUMENT': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('RESEARCH_DOCUMENT'),
      permitted_paths: getAuthorizedPathsForMode('RESEARCH_DOCUMENT')
    }),
    'FAILOVER_EXECUTE': Object.freeze({
      requires_activation: true,
      permitted_surfaces: ['github_issue_comment', 'workflow_dispatch'],
      required_capabilities: getRequiredCapabilitiesForMode('FAILOVER_EXECUTE'),
      permitted_paths: getAuthorizedPathsForMode('FAILOVER_EXECUTE') || ['poc/']
    })
  }),
   'Gemini Builder': Object.freeze({
    'BUILDER': Object.freeze({
      requires_activation: true,
      permitted_surfaces: ['workflow_dispatch'],
      required_capabilities: getRequiredCapabilitiesForMode('BUILDER'),
      permitted_paths: getAuthorizedPathsForMode('BUILDER') || ['poc/']
    })
  }),
  'Security Specialist': Object.freeze({
    'REVIEW': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('REVIEW'),
      permitted_paths: getAuthorizedPathsForMode('REVIEW')
    })
  }),
  'Utility Specialist': Object.freeze({
    'REVIEW': Object.freeze({
      requires_activation: false,
      permitted_surfaces: [],
      required_capabilities: getRequiredCapabilitiesForMode('REVIEW'),
      permitted_paths: getAuthorizedPathsForMode('REVIEW')
    })
  })
});

function getPolicyEntry(agent, taskMode) {
  const agentPolicies = ACTIVATION_POLICY[agent];
  if (!agentPolicies) {
    return null;
  }
  const entry = agentPolicies[taskMode];
  if (!entry) {
    return null;
  }
  return entry;
}

function getPermittedActivationSurfaces(agent, taskMode) {
  const entry = getPolicyEntry(agent, taskMode);
  if (!entry) {
    return null;
  }
  return entry.permitted_surfaces;
}

const VALID_ACTIVATION_SURFACES_LEGACY = Object.freeze({
  'Kilo': getPermittedActivationSurfaces('Kilo', 'FAILOVER_EXECUTE'),
  'Gemini': getPermittedActivationSurfaces('Gemini', 'FAILOVER_EXECUTE'),
  'Gemini Builder': getPermittedActivationSurfaces('Gemini Builder', 'BUILDER')
});

function requiresActivation(agent, taskMode) {
  const entry = getPolicyEntry(agent, taskMode || DEFAULT_TASK_MODE);
  if (!entry) {
    return false;
  }
  return entry.requires_activation;
}

function validateActivationSurface(surface, agent, taskMode) {
  if (!surface || typeof surface !== 'string') {
    return { valid: false, error: 'activation_surface is required', error_code: 'MISSING_ACTIVATION_SURFACE' };
  }

  if (!Object.prototype.hasOwnProperty.call(ACTIVATION_SURFACES, surface)) {
    return { valid: false, error: 'Unknown activation surface: ' + surface, error_code: 'UNKNOWN_ACTIVATION_SURFACE' };
  }

  const entry = getPolicyEntry(agent, taskMode || DEFAULT_TASK_MODE);
  if (!entry) {
    return { valid: false, error: 'No activation policy for agent ' + agent + ' in mode ' + taskMode, error_code: 'NO_ACTIVATION_POLICY' };
  }

  if (!entry.permitted_surfaces.includes(surface)) {
    return {
      valid: false,
      error: 'Unauthorized activation surface for ' + agent + ' / ' + taskMode + ': ' + surface + '. Permitted: ' + (entry.permitted_surfaces.length > 0 ? entry.permitted_surfaces.join(', ') : '(none)'),
      error_code: 'UNAUTHORIZED_ACTIVATION_SURFACE'
    };
  }

  return { valid: true, surface };
}

function objectKeys(obj) {
  return Object.keys(obj);
}

function validateActivationSyntax(activationText, target) {
  if (!activationText || typeof activationText !== 'string' || activationText.trim().length === 0) {
    return { valid: false, error: 'Activation syntax is required', error_code: 'MISSING_ACTIVATION_SYNTAX' };
  }

  const trimmed = activationText.trim();

  if (target === 'Kilo') {
    if (/^@kilo\b/i.test(trimmed)) {
      if (trimmed.startsWith('@kilo')) {
        return { valid: true, activation_surface: 'github_issue_comment' };
      }
      return {
        valid: false,
        error: 'Invalid activation syntax: @kilo is case-sensitive. Use "@kilo" (lowercase)',
        error_code: 'INVALID_ACTIVATION_SYNTAX'
      };
    }
    return {
      valid: false,
      error: 'Kilo execution tasks require @kilo initiation syntax with an authorized issue-based activation surface',
      error_code: 'INVALID_ACTIVATION_SYNTAX'
    };
  }

  if (target === 'Gemini' || target === 'Gemini Builder') {
    if (/^@gemini-cli\b/.test(trimmed)) {
      return { valid: true, activation_surface: 'github_issue_comment' };
    }
    if (/^@Gemini\b/.test(trimmed)) {
      return {
        valid: false,
        error: 'Invalid activation syntax: @Gemini is not valid. Use @gemini-cli for Gemini execution tasks',
        error_code: 'INVALID_ACTIVATION_SYNTAX'
      };
    }
    if (/@gemini\b/i.test(trimmed)) {
      return {
        valid: false,
        error: 'Arbitrary Gemini mentions are not valid activation syntax. Use @gemini-cli for Gemini execution tasks',
        error_code: 'INVALID_ACTIVATION_SYNTAX'
      };
    }
    return {
      valid: false,
      error: target + ' execution tasks require @gemini-cli initiation syntax',
      error_code: 'INVALID_ACTIVATION_SYNTAX'
    };
  }

  return { valid: false, error: 'Unknown target for activation validation: ' + target, error_code: 'UNKNOWN_TARGET' };
}

const SERVER_DERIVED_AUTHORITY_FIELDS = Object.freeze([
  'task_mode',
  'authorization',
  'constraints',
  'repository',
  'base_branch',
  'target',
  'workflow_stage'
]);

function isAuthorityConflict(command, externalActivation) {
  if (!externalActivation || !externalActivation.claimed_authority) {
    return { conflict: false, conflicting_fields: [] };
  }

  const claimed = externalActivation.claimed_authority;
  const conflicts = [];

  for (const field of SERVER_DERIVED_AUTHORITY_FIELDS) {
    if (claimed[field] !== undefined && command[field] !== undefined) {
      const commandValue = JSON.stringify(command[field]);
      const claimedValue = JSON.stringify(claimed[field]);
      if (commandValue !== claimedValue) {
        conflicts.push(field);
      }
    }
  }

  if (command.activation_surface !== undefined &&
      claimed.activation_surface !== undefined &&
      command.activation_surface !== claimed.activation_surface) {
    conflicts.push('activation_surface');
  }

  return {
    conflict: conflicts.length > 0,
    conflicting_fields: conflicts
  };
}

function canonicalizeExternalActivation(rawActivation) {
  const canonical = {
    activation_surface: rawActivation.activation_surface || 'github_issue_comment',
    activation_syntax: rawActivation.activation_syntax || null,
    activation_source: rawActivation.activation_source || 'external',
    activation_timestamp: rawActivation.activation_timestamp || new Date().toISOString(),
    activation_id: rawActivation.activation_id || ('ext-activ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)),
    activation_target: rawActivation.target || rawActivation.activation_target || null,
    activation_task_mode: rawActivation.task_mode || rawActivation.activation_task_mode || DEFAULT_TASK_MODE,
    activation_request_id: rawActivation.request_id || rawActivation.activation_request_id || null,
    claimed_authority: rawActivation.claimed_authority || null
  };

  return canonical;
}

function evaluateActivation(requestId, agent, taskMode, activationSurface) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  const entry = getPolicyEntry(agent, mode);

  if (!entry) {
    return {
      allowed: false,
      reason: 'No activation policy exists for agent ' + agent + ' in task_mode ' + mode,
      policy: null
    };
  }

  if (!entry.requires_activation) {
    return {
      allowed: true,
      policy: entry,
      surface: activationSurface || null,
      requires_activation: false
    };
  }

  if (!activationSurface) {
    return {
      allowed: false,
      reason: 'Activation requires an authorized activation_surface',
      policy: entry,
      error_code: 'MISSING_ACTIVATION_SURFACE',
      requires_activation: true
    };
  }

  const surfaceValidation = validateActivationSurface(activationSurface, agent, mode);
  if (!surfaceValidation.valid) {
    return {
      allowed: false,
      reason: surfaceValidation.error,
      policy: entry,
      error_code: surfaceValidation.error_code,
      requires_activation: true
    };
  }

  return {
    allowed: true,
    policy: entry,
    surface: surfaceValidation.surface,
    requires_activation: true
  };
}

function deriveServerAuthority(agent, taskMode) {
  const entry = getPolicyEntry(agent, taskMode || DEFAULT_TASK_MODE);
  if (!entry) {
    return { success: false, error: 'No activation policy for agent ' + agent + ' in mode ' + taskMode };
  }
  return {
    success: true,
    capabilities: entry.required_capabilities,
    permitted_paths: entry.permitted_paths,
    requires_activation: entry.requires_activation,
    permitted_surfaces: entry.permitted_surfaces
  };
}

  function enforceServerDerivedAuthority(command) {
  const agent = command.target;
  const taskMode = command.task_mode || DEFAULT_TASK_MODE;

  const entry = getPolicyEntry(agent, taskMode);
  if (!entry) {
    return { valid: false, error: 'No activation policy for agent ' + agent + ' in mode ' + taskMode, error_code: 'NO_ACTIVATION_POLICY' };
  }

  const serverCapabilities = entry.required_capabilities;

  return {
    valid: true,
    server_derived: {
      capabilities: serverCapabilities,
      permitted_paths: entry.permitted_paths,
      requires_activation: entry.requires_activation,
      permitted_surfaces: entry.permitted_surfaces
    }
  };
}

function getRequiredConfigPrerequisites(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  if (READ_ONLY_TASK_MODES.includes(mode)) {
    return [];
  }
  return CONFIG_PREREQUISITE_GATE[mode] || [];
}

function isConsequentialMode(taskMode) {
  const mode = taskMode || DEFAULT_TASK_MODE;
  return EXECUTION_TASK_MODES.includes(mode);
}

module.exports = {
  ACTIVATION_SURFACES,
  ACTIVATION_SURFACE_NAMES,
  ACTIVATION_POLICY,
  CONFIG_PREREQUISITE_GATE,
  READ_ONLY_TASK_MODES,
  MAX_AUTHORIZED_PATHS,
  SERVER_DERIVED_AUTHORITY_FIELDS,
  getPolicyEntry,
  getPermittedActivationSurfaces,
  getAuthorizedPathsForMode,
  getRequiredConfigPrerequisites,
  isConsequentialMode,
  requiresActivation,
  validateActivationSurface,
  validateActivationSyntax,
  isAuthorityConflict,
  isPathWithinMaxBoundary,
  intersectPathsWithMaxBoundary,
  canonicalizeExternalActivation,
  evaluateActivation,
  deriveServerAuthority,
  enforceServerDerivedAuthority,
  EXECUTION_TASK_MODES,
  VALID_ACTIVATION_SURFACES_LEGACY,
  DEFAULT_TASK_MODE,
  VALID_AGENTS,
  VALID_TASK_MODES
};
