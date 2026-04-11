const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withMainActivity } = require('@expo/config-plugins');

function addImportIfMissing(src) {
  const importLine = 'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
  if (src.includes(importLine)) return src;

  const marker = 'import expo.modules.ReactActivityDelegateWrapper';
  if (!src.includes(marker)) return src;
  return src.replace(marker, `${marker}\n${importLine}`);
}

function addDelegateCallIfMissing(src) {
  const callLine = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';
  if (src.includes(callLine)) return src;

  const onCreateStart = 'override fun onCreate(savedInstanceState: Bundle?) {';
  if (!src.includes(onCreateStart)) return src;

  return src.replace(
    'super.onCreate(null)',
    `super.onCreate(null)\n    // Required by react-native-health-connect before calling requestPermission.\n    ${callLine}`,
  );
}

const withHealthConnectPermissionDelegate = (config) =>
  withMainActivity(config, (mod) => {
    let contents = mod.modResults.contents;
    contents = addImportIfMissing(contents);
    contents = addDelegateCallIfMissing(contents);
    mod.modResults.contents = contents;
    return mod;
  });

function withHealthConnectManifestMetadata(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;

    app['meta-data'] = app['meta-data'] || [];
    const hasHealthMetadata = app['meta-data'].some(
      (item) => item?.$?.['android:name'] === 'health_permissions',
    );

    if (!hasHealthMetadata) {
      app['meta-data'].push({
        $: {
          'android:name': 'health_permissions',
          'android:resource': '@array/health_permissions',
        },
      });
    }

    app.activity = app.activity || [];
    const mainActivity = app.activity[0];
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
      const hasRationaleFilter = mainActivity['intent-filter'].some((intentFilter) =>
        (intentFilter.action || []).some(
          (action) => action?.$?.['android:name'] === 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
        ),
      );

      if (!hasRationaleFilter) {
        mainActivity['intent-filter'].push({
          action: [
            {
              $: {
                'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
              },
            },
          ],
        });
      }
    }

    app['activity-alias'] = app['activity-alias'] || [];
    const hasPermissionUsageAlias = app['activity-alias'].some(
      (alias) => alias?.$?.['android:name'] === 'ViewPermissionUsageActivity',
    );

    if (!hasPermissionUsageAlias) {
      app['activity-alias'].push({
        $: {
          'android:name': 'ViewPermissionUsageActivity',
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE',
                },
              },
            ],
            category: [
              {
                $: {
                  'android:name': 'android.intent.category.HEALTH_PERMISSIONS',
                },
              },
            ],
          },
        ],
      });
    }

    return mod;
  });
}

function withHealthConnectPermissionsResource(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const valuesPath = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'values',
      );
      fs.mkdirSync(valuesPath, { recursive: true });

      const resourceFile = path.join(valuesPath, 'health_permissions.xml');
      const content = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string-array name="health_permissions">\n    <item>android.permission.health.READ_WEIGHT</item>\n  </string-array>\n</resources>\n`;

      fs.writeFileSync(resourceFile, content, 'utf8');
      return mod;
    },
  ]);
}

const withHealthConnectSetup = (config) => {
  let nextConfig = withHealthConnectPermissionDelegate(config);
  nextConfig = withHealthConnectManifestMetadata(nextConfig);
  nextConfig = withHealthConnectPermissionsResource(nextConfig);
  return nextConfig;
};

module.exports = withHealthConnectSetup;
