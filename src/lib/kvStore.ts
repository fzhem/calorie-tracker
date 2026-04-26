import { createMMKV } from "react-native-mmkv";
import { MMKV_INSTANCE_ID } from "../constants";

export const kvStore = createMMKV({
  id: MMKV_INSTANCE_ID,
});
