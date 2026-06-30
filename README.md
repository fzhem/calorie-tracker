# Calorie Tracker

Simple Expo Android app for logging calories, visualizing weekly trends, and adjusting the daily target from body weight.

## Features

- 🤖 On-device meal estimation with local AI model inference
- 🍽️ Meals, weights, and body-fat logs stored locally in SQLite
- ⚙️ Settings and lightweight preferences stored on-device with MMKV
- 🎯 Daily calorie target from either a fallback goal or latest weight x calories-per-kg multiplier
- 💪 Health Connect weight sync on Android
- 📊 Weekly calorie bar chart
- 📈 Weight trend line chart

## On-device models (LiteRT-LM)

- 📦 AI models are downloaded to the device and run locally using LiteRT-LM: https://github.com/google-ai-edge/LiteRT-LM
- 🔒 No cloud inference is done for model execution after download
- 🛠️ The Settings screen includes controls to download models and run local inference

## Screenshots
<img src="docs/assets/log.png"
	alt="Log screen" width="250"/>
<img src="docs/assets/graphs.png"
	alt="Graphs screen" width="250"/>
<img src="docs/assets/settings.png"
	alt="Settings screen" width="250"/>

## Download

<a href="https://play.google.com/store/apps/details?id=com.zane.calorietracker"><img alt="Get it on Google Play" src="https://play.google.com/intl/en_us/badges/images/generic/en_badge_web_generic.png" height="80"/></a>

## Development

### Android

> **Note:** This app uses `react-native-health-connect` and requires a development build. It does not run inside Expo Go.

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

- The app requests read access for weight records.
- `minSdkVersion` is set to 26 because Health Connect requires Android 8+

## Acknowledgement

- LiteRT-LM: https://github.com/google-ai-edge/LiteRT-LM
- react-native-litert-lm: https://github.com/hung-yueh/react-native-litert-lm

## License
[![CC BY-NC 4.0][cc-by-nc-shield]][cc-by-nc]

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License][cc-by-nc].

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg