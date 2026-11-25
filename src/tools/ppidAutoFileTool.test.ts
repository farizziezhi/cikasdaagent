import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  inferKipCategory,
  buildArchiveFileName,
  executeResolveAndArchivePpid,
} from "./ppidAutoFileTool.js";
import { PpidClient } from "../services/ppidClient.js";

test("ppidAutoFileTool: inferKipCategory mengklasifikasikan dokumen sesuai UU KIP", () => {
  assert.equal(inferKipCategory("Laporan Realisasi Anggaran LRA 2026"), "Berkala");
  assert.equal(inferKipCategory("Peringatan Dini Banjir Sungai Palu"), "Serta Merta");
  assert.equal(inferKipCategory("Data Teknis Jaringan Irigasi Gumbasa"), "Setiap Saat");
});

test("ppidAutoFileTool: buildArchiveFileName membentuk nama standar dinas", () => {
  const name = buildArchiveFileName(
    "Berkala",
    "Laporan Keuangan Tahun 2026",
    "/tmp/doc.pdf",
    new Date("2026-11-25T10:00:00Z"),
  );
  assert.equal(name, "Berkala_2026-11-25_Laporan_Keuangan_Tahun_2026.pdf");
});

test("ppidAutoFileTool: executeResolveAndArchivePpid mengarsipkan ke Drive/Sheets dan update status tiket PPID", async () => {
  const tempPdf = path.join(os.tmpdir(), `ppid-ans-${crypto.randomUUID()}.pdf`);
  fs.writeFileSync(tempPdf, Buffer.from("%PDF-1.4 dummy"));

  let updatedTicket: { id: number; status: string } | null = null;
  let uploadedName = "";
  let sheetRow: any[] = [];

  const mockPpid = new PpidClient({
    customUpdateStatus: async (id, status) => {
      updatedTicket = { id, status };
    },
  });

  try {
    const res = await executeResolveAndArchivePpid(
      {
        ticket_id: 42,
        new_status: "dijawab",
        file_path: tempPdf,
        document_title: "LRA Irigasi Gumbasa 2026",
        chat_id: "telegram:2100878150",
      },
      {
        ppidClient: mockPpid,
        targetFolderId: "folder-ppid-123",
        uploadDriveFn: async (fileName, fileStream) => {
          if (fileStream && typeof (fileStream as any).destroy === "function") {
            await new Promise<void>((resolve) => {
              (fileStream as any).on("error", () => resolve());
              (fileStream as any).on("close", () => resolve());
              (fileStream as any).destroy();
            });
          }
          uploadedName = fileName;
          return {
            file_id: "drv-ans-42",
            webViewLink: "https://drive.google.com/file/d/drv-ans-42/view",
          };
        },
        ensureTabFn: async () => {},
        appendRowFn: async (_tab, values) => {
          sheetRow = values;
        },
      },
    );

    assert.equal(res.success, true);
    assert.ok(uploadedName.startsWith("Berkala_"));
    assert.deepEqual(updatedTicket, { id: 42, status: "dijawab" });
    assert.equal(sheetRow[1], "Berkala");
    assert.equal(sheetRow[4], "#42");
    assert.match(res.message || "", /DIJAWAB/);
  } finally {
    if (fs.existsSync(tempPdf)) fs.unlinkSync(tempPdf);
  }
});
