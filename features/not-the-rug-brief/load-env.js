const path = require('path');

function getDotenv() {
  try {
    return require('dotenv');
  } catch {
    return null;
  }
}

let loaded = false;

function loadEnv() {
  if (loaded) return;

  const dotenv = getDotenv();
  if (!dotenv) {
    loaded = true;
    return;
  }

  const root = process.cwd();
  dotenv.config({ path: path.join(root, '.env.local'), override: false });
  dotenv.config({ path: path.join(root, '.env'), override: false });
  loaded = true;
}

loadEnv();

module.exports = { loadEnv };
