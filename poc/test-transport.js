const { dispatch } = require('./kilo-transport');
const https = require('https');
const assert = require('assert');

// Mock https.request
const originalRequest = https.request;
https.request = (options, callback) => {
    return {
        on: (event, handler) => {},
        write: (data) => {},
        end: () => {
            // Simulate successful response for valid cases in tests if needed
            // For now, testing the boundary logic, so trigger failure or success based on mock
        }
    };
};

async function runTests() {
    console.log("--- Running Transport Tests ---");

    // 1. Missing Kilo trigger configuration
    const cmd1 = {
        "protocol_version": "0.1", "request_id": "test-1",
        "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
        "task": "T", "constraints": { "permitted_paths": ["poc/"] },
        "authorization": { "capabilities": ["read_only"] },
        "verification": "V", "reporting": "R"
    };
    const res1 = await dispatch(cmd1);
    assert.strictEqual(res1.status, 'FAILED');
    assert.strictEqual(res1.error, 'Missing Kilo trigger configuration');
    console.log('PASS: Missing configuration test');

    // 2. Blocked command (Unauthorized capability)
    process.env.KILO_TRIGGER_URL = 'https://kilo.example.com';
    const cmd2 = {
        "protocol_version": "0.1", "request_id": "test-2",
        "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
        "task": "T", "constraints": { "permitted_paths": ["poc/"] },
        "authorization": { "capabilities": ["modify_files"] },
        "verification": "V", "reporting": "R"
    };
    const res2 = await dispatch(cmd2);
    assert.strictEqual(res2.status, 'BLOCKED');
    console.log('PASS: Blocked command test');

    // 3. Valid command (success mocked)
    // Need to update the mock to return success
    https.request = (options, callback) => {
        const res = {
            statusCode: 200,
            on: (event, handler) => {
                if (event === 'end') {
                    setTimeout(() => handler(), 5);
                }
            }
        };
        setTimeout(() => callback(res), 10);
        return {
            on: (event, handler) => {},
            write: (data) => {},
            end: () => {}
        };
    };

    const res3 = await dispatch(cmd1);
    assert.strictEqual(res3.status, 'SUCCESS');
    assert.strictEqual(res3.request_id, 'test-1');
    console.log('PASS: Valid command success test');

    console.log("All transport tests passed.");
    https.request = originalRequest; // Restore
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
