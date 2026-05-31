const { withAppBuildGradle } = require('@expo/config-plugins');

const LITERT_PROGUARD_RULES = `
# react-native-litert-lm — Google LiteRT-LM SDK classes are accessed by name
# from native JNI code (liblitertlm_jni.so). Obfuscating them causes a native
# crash at nativeCreateConversation because JNI field/method lookups return null.
-keep class com.google.ai.edge.litertlm.** { *; }
-keep class com.margelo.nitro.dev.litert.litertlm.** { *; }
-keep class com.margelo.nitro.core.** { *; }
-keep class dev.litert.litertlm.** { *; }
`;

const SENTINEL = '# react-native-litert-lm';

/**
 * Appends LiteRT-LM ProGuard keep rules to android/app/proguard-rules.pro.
 * This prevents R8 from obfuscating JNI-resolved class names in the native
 * library, which causes a fatal crash at nativeCreateConversation.
 */
const withLiteRTProguard = (config) =>
  withAppBuildGradle(config, async (mod) => {
    // withAppBuildGradle gives us android/app/build.gradle, but we need
    // proguard-rules.pro. Use the dangerous mod to write that file directly.
    const fs = require('fs');
    const path = require('path');

    const proguardPath = path.join(
      mod.modRequest.platformProjectRoot,
      'app',
      'proguard-rules.pro',
    );

    if (fs.existsSync(proguardPath)) {
      let contents = fs.readFileSync(proguardPath, 'utf8');
      if (!contents.includes(SENTINEL)) {
        contents += LITERT_PROGUARD_RULES;
        fs.writeFileSync(proguardPath, contents, 'utf8');
      }
    }

    return mod;
  });

module.exports = withLiteRTProguard;
