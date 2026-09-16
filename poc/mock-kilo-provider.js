const MOCK_PROVIDER_STATUSES = new Map();

function setMockStatus(requestId, status, completionData = {}) {
    MOCK_PROVIDER_STATUSES.set(requestId, { status, completionData, timestamp: Date.now() });
}

function getMockStatus(requestId) {
    return MOCK_PROVIDER_STATUSES.get(requestId) || null;
}

function clearMockStatus(requestId) {
    MOCK_PROVIDER_STATUSES.delete(requestId);
}

function clearAllMockStatuses() {
    MOCK_PROVIDER_STATUSES.clear();
}

async function getCompletionStatus(identifiers) {
    const requestId = identifiers.request_id;
    const mockStatus = getMockStatus(requestId);

    if (!mockStatus) {
        return {
            success: true,
            status: 'in_progress',
            message: 'No mock status set, defaulting to in_progress'
        };
    }

    const { status, completionData } = mockStatus;

    if (status === 'in_progress') {
        return {
            success: true,
            status: 'in_progress',
            message: 'Kilo execution in progress'
        };
    }

    if (status === 'success' || status === 'failure' || status === 'blocked') {
        return {
            success: true,
            status,
            completion: {
                status,
                task: completionData.task || 'mock-task',
                changed_files: completionData.changed_files || ['mock-file.js'],
                verification: completionData.verification || ['mock verification passed'],
                result: completionData.result || { mock: true },
                commit: completionData.commit || 'mock-commit-sha',
                push: completionData.push || false,
                blockers: completionData.blockers || [],
                invocation_id: completionData.invocation_id || null,
                run_id: completionData.run_id || null
            },
            provider_invocation_id: identifiers.provider_invocation_id,
            provider_session_id: identifiers.provider_session_id
        };
    }

    return {
        success: false,
        error: `Unknown mock status: ${status}`,
        stage: 'mock_provider'
    };
}

module.exports = {
    getCompletionStatus,
    setMockStatus,
    getMockStatus,
    clearMockStatus,
    clearAllMockStatuses
};