import { google } from "googleapis";
import { env } from "../config/env.js";

/**
 * Shared Google Sheets client.
 * Menyediakan fungsi-fungsi umum untuk berinteraksi dengan Google Sheets:
 * - Auto-create tab jika belum ada
 * - Append row
 * - Find rows by column value
 */

const getAuth = () => {
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
};

const getSheets = () => {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
};

/**
 * Pastikan tab (sheet) dengan nama tertentu ada di spreadsheet.
 * Jika belum ada, buat tab baru dengan header yang diberikan.
 */
export async function ensureTabExists(
  tabName: string,
  headers: string[]
): Promise<void> {
  const sheets = getSheets();
  const spreadsheetId = env.AUDIT_LOG_SHEET_ID;

  try {
    // Cek apakah tab sudah ada
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = spreadsheet.data.sheets?.map(
      (s) => s.properties?.title
    ) || [];

    if (existingTabs.includes(tabName)) {
      return; // Tab sudah ada, tidak perlu buat
    }

    // Buat tab baru
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: tabName },
            },
          },
        ],
      },
    });

    // Tulis header di baris pertama
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });

    console.log(`[SheetsClient] Tab "${tabName}" berhasil dibuat dengan header.`);
  } catch (error) {
    console.error(`[SheetsClient] Error ensuring tab "${tabName}":`, error);
    // Jangan throw — biarkan operasi utama tetap jalan
  }
}

/**
 * Tambahkan baris baru ke tab tertentu.
 */
export async function appendRow(
  tabName: string,
  values: (string | number)[]
): Promise<void> {
  const sheets = getSheets();

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.AUDIT_LOG_SHEET_ID,
    range: `${tabName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values],
    },
  });
}

/**
 * Cari semua baris di tab berdasarkan nilai kolom tertentu.
 * @param tabName Nama tab
 * @param columnIndex Index kolom (0-based, A=0, B=1, ...)
 * @param searchValue Nilai yang dicari
 * @returns Array of row values yang cocok
 */
export async function findRows(
  tabName: string,
  columnIndex: number,
  searchValue: string
): Promise<string[][]> {
  const sheets = getSheets();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.AUDIT_LOG_SHEET_ID,
      range: `${tabName}!A:Z`,
    });

    const rows = response.data.values || [];
    
    // Skip header (baris pertama), cari baris yang cocok
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
  const sheets = getSheets();
  
  // Convert column index to letter (0=A, 1=B, ...)
  const colLetter = String.fromCharCode(65 + columnIndex);
  const range = `${tabName}!${colLetter}${rowIndex + 1}`; // +1 karena Sheets 1-indexed

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.AUDIT_LOG_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[value]],
    },
  });
}
