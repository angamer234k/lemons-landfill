const fs = require('fs');
const path = require('path');
const impl = path.join(__dirname, 'customCommands.impl.js');
const parts = [1, 2, 3].map(i =>
  fs.readFileSync(path.join(__dirname, 'customCommands.b64.' + i), 'utf8')
);
fs.writeFileSync(impl, Buffer.from(parts.join(''), 'base64'));
module.exports = require('./customCommands.impl.js');
