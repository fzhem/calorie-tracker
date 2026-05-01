const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

function copyDirectoryRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const withAndroidIcons = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const resSource = path.join(mod.modRequest.projectRoot, 'assets', 'res');
      const resDest = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
      );

      if (fs.existsSync(resSource)) {
        copyDirectoryRecursive(resSource, resDest);
      }

      return mod;
    },
  ]);

module.exports = withAndroidIcons;
