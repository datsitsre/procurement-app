// Next.js's `output: 'standalone'` build (next.config.ts) produces a self-contained server
// bundle at .next/standalone/ with only the node_modules it actually traced in - but it does NOT
// copy public/ or .next/static/ into that bundle. Those two are the actual root cause of "This
// page couldn't load" / a blank, unstyled page when running `node .next/standalone/server.js`:
// every CSS/JS chunk the HTML references lives under /_next/static/*, which 404s until this copy
// step runs. This is documented, expected Next.js standalone behavior, not a bug in this app -
// see https://nextjs.org/docs/pages/api-reference/config/next-config-js/output - and running
// `npm run build` alone is exactly the situation that used to leave the standalone bundle
// unusable. Wired as `postbuild` in package.json so every build fixes itself automatically.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const standaloneDir = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  // next.config.ts doesn't set `output: 'standalone'` in some other build mode (e.g. a plain
  // `next build` locally without that option) - nothing to copy, not an error.
  process.exit(0);
}

function copy(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
  console.log(`copy-standalone-assets: ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

copy(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'));
copy(path.join(root, 'public'), path.join(standaloneDir, 'public'));
