const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Removes EmojiCompatInitializer from the androidx.startup provider so it
 * doesn't run at app startup. With minSdkVersion 26+ the OS handles emoji
 * natively, so EmojiCompat initialization is unnecessary overhead.
 */
const withAndroidManifestExtras = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Ensure the tools namespace is declared on the root element
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    // Remove EmojiCompatInitializer so it doesn't run at startup.
    // We need to either patch the existing InitializationProvider entry or add one
    // that the manifest merger will merge with the library-supplied one.
    const app = manifest.application?.[0];
    if (app) {
      app.provider = app.provider ?? [];
      const startupProvider = app.provider.find(
        (p) => p.$?.['android:name'] === 'androidx.startup.InitializationProvider',
      );

      if (startupProvider) {
        startupProvider.$['tools:node'] = 'merge';
        startupProvider['meta-data'] = startupProvider['meta-data'] ?? [];
        const alreadyRemoved = startupProvider['meta-data'].some(
          (m) => m.$?.['android:name'] === 'androidx.emoji2.text.EmojiCompatInitializer',
        );
        if (!alreadyRemoved) {
          startupProvider['meta-data'].push({
            $: {
              'android:name': 'androidx.emoji2.text.EmojiCompatInitializer',
              'tools:node': 'remove',
            },
          });
        }
      } else {
        app.provider.push({
          $: {
            'android:name': 'androidx.startup.InitializationProvider',
            'android:authorities': '${applicationId}.androidx-startup',
            'android:exported': 'false',
            'tools:node': 'merge',
          },
          'meta-data': [
            {
              $: {
                'android:name': 'androidx.emoji2.text.EmojiCompatInitializer',
                'tools:node': 'remove',
              },
            },
          ],
        });
      }
    }

    return mod;
  });

module.exports = withAndroidManifestExtras;
