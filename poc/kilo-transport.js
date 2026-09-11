const https = require('https');
const { validate } = require('./acp-engine');

function dispatch(command) {
    // 1. Validate against ACP security boundary
    const v = validate(command);
    if (v.status !== 'SUCCESS') {
        return {
            request_id: command.request_id,
            status: 'BLOCKED',
            error: `Execution blocked: ${v.error}`
        };
    }

    // 2. Validate configuration
    const triggerUrl = process.env.KILO_TRIGGER_URL;
    if (!triggerUrl) {
        return {
            request_id: command.request_id,
            status: 'FAILED',
            error: 'Missing Kilo trigger configuration'
        };
    }

    // 3. Dispatch via HTTPS
    return new Promise((resolve) => {
        const url = new URL(triggerUrl);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        request_id: command.request_id,
                        status: 'SUCCESS',
                        message: 'Successfully dispatched to Kilo',
                        invocation_details: { statusCode: res.statusCode } // No secrets here
                    });
                } else {
                    resolve({
                        request_id: command.request_id,
                        status: 'FAILED',
                        error: `Transport failure: ${res.statusCode}`
                    });
                }
            });
        });

        req.on('error', (e) => {
            resolve({
                request_id: command.request_id,
                status: 'FAILED',
                error: `Transport error: ${e.message}`
            });
        });

        req.write(JSON.stringify(command));
        req.end();
    });
}

module.exports = { dispatch };
