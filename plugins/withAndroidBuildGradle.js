const { withProjectBuildGradle } = require('@expo/config-plugins');

const KOTLIN_VERSION = '2.3.0';

/**
 * Sets ext.kotlin_version in the top-level android/build.gradle and ensures
 * the kotlin-gradle-plugin classpath uses it.
 */
const withAndroidBuildGradle = (config) =>
  withProjectBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    // Set / update kotlin_version in the ext block
    if (contents.includes('ext.kotlin_version')) {
      contents = contents.replace(
        /ext\.kotlin_version\s*=\s*['"][^'"]*['"]/,
        `ext.kotlin_version = '${KOTLIN_VERSION}'`,
      );
    } else {
      // Inject after opening `buildscript {`
      contents = contents.replace(
        /buildscript\s*\{/,
        `buildscript {\n  ext.kotlin_version = '${KOTLIN_VERSION}'`,
      );
    }

    // Ensure the kotlin-gradle-plugin classpath uses the version variable.
    // Expo prebuild generates it without a version, so we replace any form of it.
    contents = contents.replace(
      /classpath\(["']org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^'"]*)?['"]\)/,
      `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:\${kotlin_version}")`,
    );

    // If it wasn't present at all, inject it after the react-native-gradle-plugin line
    if (!contents.includes('kotlin-gradle-plugin')) {
      contents = contents.replace(
        /classpath\(['"]com\.facebook\.react:react-native-gradle-plugin['"]\)/,
        `classpath('com.facebook.react:react-native-gradle-plugin')\n    classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:\${kotlin_version}")`,
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });

module.exports = withAndroidBuildGradle;
