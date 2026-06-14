const { withAppBuildGradle } = require("@expo/config-plugins");

const LLAMA_RN_PROGUARD_RULES = `
# llama.rn — wraps llama.cpp via React Native JSI.
# Native methods and JNI classes must not be obfuscated.
-keep class com.rnllama.** { *; }
`;

const SENTINEL = "# llama.rn";

/**
 * Appends llama.rn ProGuard keep rules to android/app/proguard-rules.pro.
 * This prevents R8 from obfuscating JNI-resolved class names in the native
 * library, which would cause crashes at native method lookup time.
 */
const withLlamaRNProguard = (config) =>
  withAppBuildGradle(config, async (mod) => {
    const fs = require("fs");
    const path = require("path");

    const proguardPath = path.join(
      mod.modRequest.platformProjectRoot,
      "app",
      "proguard-rules.pro",
    );

    if (fs.existsSync(proguardPath)) {
      let contents = fs.readFileSync(proguardPath, "utf8");
      if (!contents.includes(SENTINEL)) {
        contents += LLAMA_RN_PROGUARD_RULES;
        fs.writeFileSync(proguardPath, contents, "utf8");
      }
    }

    return mod;
  });

module.exports = withLlamaRNProguard;