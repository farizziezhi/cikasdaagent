import { env } from "../config/env.js";
import { getGoogleAccessToken } from "./googleAuth.js";

/**
 * Shared Google Sheets client (Zero-Dependency REST API).
 * Berinteraksi langsung dengan Google Sheets REST API v4 menggunakan native `fetch`.
 */

async function getAuthHeader(): Promise<string> {
  const token = await getGoogleAccessToken();
  return `Bearer ${token}`;
}

/**
 * Pastikan tab (sheet) dengan nama tertentu ada di spreadsheet.
 * Jika belum ada, buat tab baru dengan header yang diberikan.
 */
export async function ensureTabExists(
  tabName: string,
  headers: string[]
): Promise<void> {
  const spreadsheetId = env.AUDIT_LOG_SHEET_ID;

  try {
    const authHeader = await getAuthHeader();

    // 1. Cek apakah tab sudah ada
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      {
        headers: { Authorization: authHeader },
      }
    );

    if (!res.ok) {
      console.error(`[SheetsClient] Gagal cek tab:`, await res.text());
      return;
    }

    const data = (await res.json()) as {
      sheets?: Array<{ properties?: { title?: string } }>;
    };
    const existingTabs = data.sheets?.map((s) => s.properties?.title) || [];

    if (existingTabs.includes(tabName)) {
      return; // Tab sudah ada
    }

    // 2. Buat tab baru jika belum ada
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: { title: tabName },
              },
            },
          ],
        }),
      }
    );

    // 3. Tulis header di baris pertama
    const encodedRange = encodeURIComponent(`${tabName}!A1`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [headers],
        }),
      }
    );

    console.log(`[SheetsClient] Tab "${tabName}" berhasil dibuat dengan header.`);
  } catch (error) {
    console.error(`[SheetsClient] Error ensuring tab "${tabName}":`, error);
  }
}

/**
 * Tambahkan baris baru ke tab tertentu.
 */
export async function appendRow(
  tabName: string,
  values: (string | number)[]
): Promise<void> {
  try {
    const spreadsheetId = env.AUDIT_LOG_SHEET_ID;
    const authHeader = await getAuthHeader();
    const encodedRange = encodeURIComponent(`${tabName}!A:Z`);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [values],
        }),
      }
    );

    if (!res.ok) {
      console.error(`[SheetsClient] Gagal append row:`, await res.text());
    }
  } catch (error) {
    console.error(`[SheetsClient] Error appending row:`, error);
  }
}

/**
 * Cari semua baris di tab berdasarkan nilai kolom tertentu.
 */
export async function findRows(
  tabName: string,
  columnIndex: number,
  searchValue: string
): Promise<string[][]> {
  try {
    const spreadsheetId = env.AUDIT_LOG_SHEET_ID;
    const authHeader = await getAuthHeader();
    const encodedRange = encodeURIComponent(`${tabName}!A:Z`);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
      {
        headers: { Authorization: authHeader },
      }
    );

    if (!res.ok) {
      console.error(`[SheetsClient] Gagal findRows:`, await res.text());
      return [];
    }

    const data = (await res.json()) as { values?: string[][] };
    const rows = data.values || [];

    return rows.filter(
      (row, index) =>
        index > 0 && row[columnIndex]?.toString() === searchValue.toString()
    );
  } catch (error) {
    console.error(`[SheetsClient] Error finding rows in "${tabName}":`, error);
    return [];
  }
}

/**
 * Update sel tertentu berdasarkan baris dan kolom.
 */
export async function updateCell(
  tabName: string,
  rowIndex: number,
  columnIndex: number,
  value: string
): Promise<void> {
  try {
    const spreadsheetId = env.AUDIT_LOG_SHEET_ID;
    const authHeader = await getAuthHeader();
    const colLetter = String.fromCharCode(65 + columnIndex);
    const encodedRange = encodeURIComponent(`${tabName}!${colLetter}${rowIndex + 1}`);

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [[value]],
        }),
      }
    );
  } catch (error) {
    console.error(`[SheetsClient] Error updateCell:`, error);
  }
}
