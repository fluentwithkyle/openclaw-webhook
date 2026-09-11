'use strict';

const fs = require('fs');
const path = require('path');
const { executeAcpCommand } = require('./acp');

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    process.stderr.write('Usage: node poc/index.js <acp-command.json>\n');
    process.exit(2);
  }
  const file = path.resolve(process.cwd(), inputArg);
  let cmd;
  try {
    cmd = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    process.stderr.write('Failed to parse ACP command JSON: ' + e.message + '\n');
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, '..');
  const report = executeAcpCommand(cmd, repoRoot);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.status === 'SUCCESS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main };
