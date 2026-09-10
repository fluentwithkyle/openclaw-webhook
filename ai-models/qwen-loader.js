const { pipeline } = require('@xenova/transformers');

async function runSmokeTest() {
    try {
        console.log('Loading Qwen model...');
        // Qwen/Qwen3-0.6B is a text generation model.
        const generator = await pipeline('text-generation', 'Qwen/Qwen3-0.6B');
        console.log('Model loaded.');
        const output = await generator('Hello, Qwen!', { max_new_tokens: 10 });
        console.log('Output:', output);
    } catch (error) {
        console.error('Error loading model:', error);
    }
}

runSmokeTest();
