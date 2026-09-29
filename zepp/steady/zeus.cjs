// Zeus 1.9.3's module-alias/register resolves this project's package.json when
// locally installed. Register the compiler's bundled alias explicitly.
const path = require('node:path');
const root = path.dirname(require.resolve('@zeppos/zeus-cli/package.json'));
require('module-alias')(root);
require(path.join(root, 'bin/main.js'));
