const { dispatch } = require('../poc/kilo-transport');

let dispatcher = dispatch;

function getDispatcher() {
    return dispatcher;
}

function setDispatcher(newDispatcher) {
    dispatcher = newDispatcher;
}

module.exports = { getDispatcher, setDispatcher };
