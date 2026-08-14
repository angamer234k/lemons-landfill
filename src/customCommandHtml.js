const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const impl = path.join(__dirname, 'customCommandHtml.impl.js');
if (!fs.existsSync(impl)) {
  const parts = [1, 2, 3].map(i =>
    fs.readFileSync(path.join(__dirname, 'customCommandHtml.gz.b64.' + i), 'utf8')
  );
  fs.writeFileSync(impl, zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')));
}
module.exports = require('./customCommandHtml.impl.js');
