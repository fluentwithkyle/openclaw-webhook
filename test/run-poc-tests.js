const http = require('http');
const express = require('express');
const fs = require('fs');
const { dispatch } = require('../poc/kilo-transport'); // We will mock this

// Start a minimal server for testing
const app = express();
app.use(express.json());

// Need to duplicate the route logic from index.js
const authenticatePoc = (req, res, next) => {
    const secret = req.headers['x-poc-trigger-secret'];
    if (!secret || secret !== 'test-secret') {
        return res.status(401).json({ status: 'authentication blocked' });
    }
    next();
};

app.post('/poc/kilo', authenticatePoc, async (req, res) => {
    try {
        const commandData = fs.readFileSync('poc/command.json', 'utf8');
        const command = JSON.parse(commandData);
        const result = await dispatch(command);
        if (result.status === 'SUCCESS') res.status(200).json({ status: 'Kilo dispatch accepted' });
        else if (result.status === 'BLOCKED') res.status(403).json({ status: 'ACP validation blocked' });
        else res.status(500).json({ status: 'Kilo transport failure' });
    } catch (e) {
        res.status(500).json({ status: 'Kilo transport failure' });
    }
});

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
    if (res.status === 401) console.log('Test 1 passed');
    else console.error('Test 1 failed: Wrong status', res.status);

    // Test 2: Invalid auth
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'wrong' }
    });
    if (res.status === 401) console.log('Test 2 passed');
    else console.error('Test 2 failed: Wrong status', res.status);

    // Test 3: Valid auth (mock success)
    res = await makeRequest({ 
        hostname: 'localhost', port: 3001, path: '/poc/kilo', method: 'POST',
        headers: { 'x-poc-trigger-secret': 'test-secret' }
    });
    if (res.status === 200) console.log('Test 3 passed');
    else console.error('Test 3 failed: Wrong status', res.status);

    server.close();
}

runTests().catch(console.error);
