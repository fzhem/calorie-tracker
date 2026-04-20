import { getCachedData, saveStoredData } from "../data/storage";

export function exportUserData() {
  const data = getCachedData();
  if (!data) throw new Error("No data to export.");
  // Export as JSON string
  return JSON.stringify(data, null, 2);
}

/**
 * Imports user data from a JSON string and saves it to storage.
 * Throws if the data is invalid or cannot be parsed.
 */
export async function importUserData(json: string) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error("Invalid JSON format.");
  }
  // Optionally, add validation for required fields here
  await saveStoredData(parsed);
}
