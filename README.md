# Calorie Tracker

Simple Expo Android app for logging calories, visualizing weekly trends, and adjusting the daily target from body weight.

## Features

- Local calorie log stored on-device with AsyncStorage
- Daily calorie target based on either:
  - fallback calorie goal
  - latest weight x calories-per-kg multiplier
- Health Connect weight sync on Android
- Weekly calorie bar chart
- Weight trend line chart

## Android setup

This app uses `react-native-health-connect`, so it does not run inside Expo Go.

1. Install dependencies:

```bash
npm install
```

2. Generate the native Android project:

```bash
npm run prebuild
```

3. Build and launch the Android app:

```bash
npm run android
```

4. Start Metro for the development build:

```bash
npm run start
```

## Health Connect notes

- Health Connect must be installed or available on the device.
- The app requests read access for weight records.
- `minSdkVersion` is set to 26 because Health Connect requires Android 8+
- If you plan to publish to Google Play, Health Connect access requires Google's declaration and approval process.