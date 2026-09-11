function dispatch(command) {
    if (command.task === 'fail') {
        return Promise.resolve({ status: 'FAILED', error: 'Mock failure' });
    }
    if (command.task === 'blocked') {
        return Promise.resolve({ status: 'BLOCKED', error: 'Mock blocked' });
    }
    return Promise.resolve({ status: 'SUCCESS' });
}
module.exports = { dispatch };
