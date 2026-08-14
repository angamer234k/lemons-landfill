const fs = require('fs');
const path = require('path');
const implPath = path.join(__dirname, 'customCommands.impl.js');
const b64Path = path.join(__dirname, 'customCommands.b64');
if (!fs.existsSync(implPath)) {
  fs.writeFileSync(implPath, Buffer.from(fs.readFileSync(b64Path, 'utf8'), 'base64'));
}
module.exports = require('./customCommands.impl.js');
