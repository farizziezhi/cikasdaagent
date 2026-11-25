import crypto from "crypto";
import { env } from "../config/env.js";

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedPpidDriveToken: { token: string; expiresAt: number } | null = null;

/**
 * Tukar OAuth2 Refresh Token milik akun Google Drive PPID-Digital menjadi Access Token.
 * Mengembalikan null jika env PPID_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN belum diisi.
 */
export async function getPpidDriveAccessToken(): Promise<string | null> {
  const clientId = (env.PPID_DRIVE_CLIENT_ID || "").trim();
  const clientSecret = (env.PPID_DRIVE_CLIENT_SECRET || "").trim();
  const refreshToken = (env.PPID_DRIVE_REFRESH_TOKEN || "").trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedPpidDriveToken && cachedPpidDriveToken.expiresAt > now + 60) {
    return cachedPpidDriveToken.token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth2 refresh_token PPID Drive gagal (${res.status}): ${errText.slice(0, 150)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedPpidDriveToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  };
  return data.access_token;
}

/**
 * Lightweight, zero-dependency Google OAuth2 token generator for Service Accounts.
 * Menggunakan modul bawaan `crypto` dan `fetch` milik Node.js tanpa membebani RAM.
 */
export async function getGoogleAccessToken(
  scopes = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
  ]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Gunakan token dari cache jika masih berlaku (dengan buffer 60 detik)
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaim = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = signer.sign(credentials.private_key, "base64url");

  const jwt = `${signatureInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`[GoogleAuth] Gagal mendapatkan access token: ${errorText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  };

  return data.access_token;
}
