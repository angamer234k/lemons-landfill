const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const impl = path.join(__dirname, 'customCommandHtml.impl.js');
if (!fs.existsSync(impl)) {
  const b64 = fs.readFileSync(path.join(__dirname, 'customCommandHtml.gz.b64'), 'utf8');
  fs.writeFileSync(impl, zlib.gunzipSync(Buffer.from(b64, 'base64')));
}
module.exports = require('./customCommandHtml.impl.js');
