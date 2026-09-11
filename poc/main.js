const { validate, execute } = require('./acp-engine');

const acpCommand = {
  "protocol_version": "0.1",
  "request_id": "acp-poc-12345",
  "source": "Qwen Router",
  "target": "Kilo Code",
  "task_type": "read-only-inspection",
  "repository": "fluentwithkyle/openclaw-webhook",
  "base_branch": "main",
  "task": "inspect-repo",
  "constraints": {
    "permitted_paths": ["poc/"]
  },
  "authorization": {
    "capabilities": ["read_only"]
  },
  "verification": "verify read-only execution",
  "reporting": "structured-json"
};

console.log("--- Starting POC ---");
const validation = validate(acpCommand);
if (validation.status === 'SUCCESS') {
    const result = execute(acpCommand);
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log(JSON.stringify({ request_id: acpCommand.request_id, status: validation.status, error: validation.error }, null, 2));
}
console.log("--- POC Finished ---");
