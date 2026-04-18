const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'build.gradle');
const targetPath = path.join(projectRoot, 'android', 'build.gradle');

function main() {
  if (!fs.existsSync(sourcePath)) {
    console.error(`[gradle-sync] Source not found: ${sourcePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(path.dirname(targetPath))) {
    console.error(`[gradle-sync] Android target folder not found: ${path.dirname(targetPath)}`);
    console.error('[gradle-sync] Run Expo prebuild/android first so android/ exists.');
    process.exit(1);
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[gradle-sync] Copied ${sourcePath} -> ${targetPath}`);
}

main();
