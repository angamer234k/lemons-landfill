const fs = require('fs');
const path = require('path');
const impl = path.join(__dirname, 'customCommandStore.impl.js');
if (!fs.existsSync(impl)) {
  const parts = [1, 2, 3].map(i =>
    fs.readFileSync(path.join(__dirname, 'customCommandStore.b64.' + i), 'utf8')
  );
  fs.writeFileSync(impl, Buffer.from(parts.join(''), 'base64'));
}
module.exports = require('./customCommandStore.impl.js');
