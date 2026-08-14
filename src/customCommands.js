const fs = require('fs');
const path = require('path');
const implPath = path.join(__dirname, 'customCommands.impl.js');
if (!fs.existsSync(implPath)) {
  const p1 = fs.readFileSync(path.join(__dirname, 'customCommands.b64.1'), 'utf8');
  const p2 = fs.readFileSync(path.join(__dirname, 'customCommands.b64.2'), 'utf8');
  fs.writeFileSync(implPath, Buffer.from(p1 + p2, 'base64'));
}
module.exports = require('./customCommands.impl.js');
