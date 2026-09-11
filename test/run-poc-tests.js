const http = require('http');
const express = require('express');
const { router: pocRouter } = require('../routes/poc');
const { setDispatcher } = require('../services/transport-provider');

// Start a minimal server for testing
const app = express();
app.use(express.json());

// Set environment for auth
process.env.ACP_POC_TRIGGER_SECRET = 'test-secret';

// Use the production router
app.use('/poc', pocRouter);

const server = app.listen(3001);

async function runTests() {
    console.log('Running tests...');
    
    // Helper to make request
    function makeRequest(options, data = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
            });
            req.on('error', reject);
            req.write(JSON.stringify(data));
            req.end();
        });
    }

    // Test 1: Missing auth
    let res = await makeRequest({ hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST' });
    if (res.status === 401) console.log('Test 1 passed: Missing secret');
    else console.error('Test 1 failed: Wrong status', res.status);

    // Test 2: Invalid auth
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'wrong' }
    });
    if (res.status === 401) console.log('Test 2 passed: Invalid secret');
    else console.error('Test 2 failed: Wrong status', res.status);

    // Test 3: Valid auth (mock success)
    setDispatcher(async () => ({ status: 'SUCCESS' }));
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'test-secret' }
    });
    if (res.status === 200) console.log('Test 3 passed: Success');
    else console.error('Test 3 failed: Wrong status', res.status);
    
    // Test 4: ACP rejection
    setDispatcher(async () => ({ status: 'BLOCKED' }));
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'test-secret' }
    });
    if (res.status === 403) console.log('Test 4 passed: ACP blocked');
    else console.error('Test 4 failed: Wrong status', res.status);
    
    // Test 5: Transport failure
    setDispatcher(async () => ({ status: 'FAILED' }));
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'test-secret' }
    });
    if (res.status === 500) console.log('Test 5 passed: Transport failure');
    else console.error('Test 5 failed: Wrong status', res.status);

    server.close();
}

runTests().catch(console.error);
