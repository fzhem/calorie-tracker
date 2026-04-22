const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'AndroidManifest.xml');
const targetPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

function main() {
  if (!fs.existsSync(sourcePath)) {
    console.error(`[manifest-sync] Source not found: ${sourcePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(path.dirname(targetPath))) {
    console.error(`[manifest-sync] Android main target not found: ${path.dirname(targetPath)}`);
    console.error('[manifest-sync] Run Expo prebuild/android first so android/ exists.');
    process.exit(1);
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[manifest-sync] Copied ${sourcePath} -> ${targetPath}`);
}

main();