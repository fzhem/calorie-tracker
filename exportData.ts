import { getCachedData } from './storage';

export function exportUserData() {
  const data = getCachedData();
  if (!data) throw new Error('No data to export.');
  // Export as JSON string
  return JSON.stringify(data, null, 2);
}
