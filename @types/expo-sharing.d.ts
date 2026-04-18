declare module 'expo-sharing' {
  export function shareAsync(uri: string, options?: any): Promise<void>;
}
declare module 'expo-file-system' {
  export const documentDirectory: string;
  export function writeAsStringAsync(uri: string, data: string, options?: any): Promise<void>;
}
