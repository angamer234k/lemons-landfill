const fs = require('fs');
const path = require('path');
const impl = path.join(__dirname, 'customCommandHtml.impl.js');
if (!fs.existsSync(impl)) {
  const a = fs.readFileSync(path.join(__dirname, 'customCommandHtml.b64.1'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, 'customCommandHtml.b64.2'), 'utf8');
  fs.writeFileSync(impl, Buffer.from(a + b, 'base64'));
}
module.exports = require('./customCommandHtml.impl.js');
