const fs = require('fs');
const {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload
} = require('./external-activation-validator');

const DESCRIPTOR_OUTPUT_FILE = process.env.EXECUTION_DESCRIPTOR_FILE || 'execution-descriptor.json';

async function main() {
    const command = process.argv[2];
    const params = JSON.parse(process.argv[3]);

    const callbackUrl = process.env.CALLBACK_BASE_URL;
    const callbackSecret = process.env.ACP_POC_TRIGGER_SECRET;

    if (!callbackUrl) {
        console.error('::error::Callback URL not configured (CALLBACK_BASE_URL)');
        process.exit(2);
    }

    let payload;
    let targetAgent;

    if (command === 'gemini-issue-comment') {
        payload = buildActivationPayloadForIssueComment(
            params.comment_id,
            params.comment_body,
            params.repository,
            params.base_branch
        );
        targetAgent = 'Gemini';
    } else if (command === 'gemini-workflow-dispatch') {
        payload = buildActivationPayloadForWorkflowDispatch(params);
        targetAgent = 'Gemini';
    } else if (command === 'builder-workflow-dispatch') {
        payload = buildBuilderActivationPayload(params);
        targetAgent = 'Gemini Builder';
    } else {
        console.error(`::error::Unknown activation command: ${command}`);
        process.exit(2);
    }

    console.log(`::notice::Validating ${targetAgent} activation through canonical ingress...`);

    const result = await validateExternalActivation(payload, callbackUrl, callbackSecret);

    if (!result.success) {
        console.error(`::error::BLOCKED: Activation rejected by canonical ingress: ${result.error} (${result.error_code || 'UNKNOWN'})`);
        process.exit(1);
    }

    if (result.activation.replay && result.activation.replay === true) {
        console.log(`::notice::Activation matched existing task (replay/idempotent). Request ID: ${result.request_id}`);
        // Record the replay response for workflow consumption (no execution_descriptor on replay)
        fs.writeFileSync(DESCRIPTOR_OUTPUT_FILE, JSON.stringify(result.activation, null, 2), 'utf8');
        console.log(`::notice::Replay response written to ${DESCRIPTOR_OUTPUT_FILE}`);
        console.log(`::set-output name=replay::true`);
        console.log(`::set-output name=request_id::${result.request_id}`);
        console.log(`::set-output name=execution_claim_id::${result.activation.execution_claim_id || ''}`);
        console.log(`::set-output name=carrier_identity::${result.activation.carrier_identity || ''}`);
        process.exit(0);
    }

    if (result.activation.director_approval_required) {
        console.error(`::error::BLOCKED: Consequential activation requires Director approval`);
        process.exit(1);
    }

    console.log(`::notice::Activation accepted by canonical ingress. Request ID: ${result.request_id}`);
    console.log(`::notice::Task status: ${result.activation.task_status}`);

    const descriptor = result.activation.execution_descriptor;
    if (descriptor) {
        fs.writeFileSync(DESCRIPTOR_OUTPUT_FILE, JSON.stringify(descriptor, null, 2), 'utf8');
        console.log(`::notice::Execution descriptor written to ${DESCRIPTOR_OUTPUT_FILE}`);
        console.log(`::set-output name=request_id::${descriptor.request_id}`);
        console.log(`::set-output name=execution_claim_id::${descriptor.execution_claim_id || ''}`);
        console.log(`::set-output name=carrier_identity::${result.activation.carrier_identity || ''}`);
        console.log(`::set-output name=target_agent::${descriptor.target_agent || ''}`);
        console.log(`::set-output name=task_mode::${descriptor.task_mode || ''}`);
        console.log(`::set-output name=repository::${descriptor.repository || ''}`);
        console.log(`::set-output name=base_branch::${descriptor.base_branch || ''}`);
    } else {
        console.log(`::set-output name=request_id::${result.activation.request_id || result.request_id || ''}`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(`::error::Activation validation failed: ${err.message}`);
    process.exit(2);
});
