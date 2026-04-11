const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'assets');
const targetRoot = path.join(projectRoot, 'android', 'app', 'src', 'main');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectoryRecursive(srcDir, destDir) {
  ensureDir(destDir);

  let copied = 0;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copied += copyDirectoryRecursive(srcPath, destPath);
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
    copied += 1;
  }

  return copied;
}

function main() {
  if (!fs.existsSync(sourceRoot)) {
    console.error(`[asset-sync] Source not found: ${sourceRoot}`);
    process.exit(1);
  }

  if (!fs.existsSync(targetRoot)) {
    console.error(`[asset-sync] Android main target not found: ${targetRoot}`);
    console.error('[asset-sync] Run Expo prebuild/android first so android/ exists.');
    process.exit(1);
  }

  const sourceEntries = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name);

  let totalCopied = 0;
  for (const entryName of sourceEntries) {
    const sourcePath = path.join(sourceRoot, entryName);

    // Never remove Android resource roots; only copy/overwrite icon files.
    if (entryName === 'res' && fs.statSync(sourcePath).isDirectory()) {
      const resTargetRoot = path.join(targetRoot, 'res');
      ensureDir(resTargetRoot);
      const copied = copyDirectoryRecursive(sourcePath, resTargetRoot);
      totalCopied += copied;
      console.log(`[asset-sync] merged res/ into android resources (${copied} file(s))`);
      continue;
    }

    const targetPath = path.join(targetRoot, entryName);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      const copied = copyDirectoryRecursive(sourcePath, targetPath);
      totalCopied += copied;
      console.log(`[asset-sync] copied ${entryName}/ (${copied} file(s))`);
    } else {
      ensureDir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
      totalCopied += 1;
      console.log(`[asset-sync] copied ${entryName}`);
    }
  }

  console.log(`[asset-sync] Complete. Synced ${sourceEntries.length} top-level asset item(s), copied ${totalCopied} file(s), no destructive deletes.`);
}

main();
