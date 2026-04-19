import { createMMKV } from 'react-native-mmkv';

export const kvStore = createMMKV({
  id: 'calorie-tracker-mmkv-v1',
});
