import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";

export default definePluginEntry({
  id: "ppid-agent-tools",
  name: "PPID Agent Tools",
  description: "Custom tools for Kesekretariatan PPID",
  register(api) {
    // 1. Tool: check_registration
    api.registerTool({
      name: "check_registration",
      label: "Check Registration",
      description: "WAJIB dipanggil PERTAMA KALI sebelum menjalankan tool lain. Cek apakah pengguna sudah terdaftar. Jika belum terdaftar, minta mereka mendaftar dulu dengan kode akses kantor menggunakan tool register_user.",
      parameters: Type.Object({
        chat_id: Type.String({ description: "Chat ID pengguna Telegram" })
      }),
      async execute(_id, params: any) {
        const { isRegistered } = await import("./services/userRegistry.js");
        const registered = await isRegistered(params.chat_id);
        const result = {
          registered,
          message: registered
            ? "Pengguna terdaftar. Silakan lanjutkan."
            : "Pengguna BELUM terdaftar. Minta mereka memberikan kode akses kantor untuk mendaftar menggunakan tool register_user."
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 2. Tool: register_user
    api.registerTool({
      name: "register_user",
      label: "Register User",
      description: "Mendaftarkan pengguna baru. Panggil setelah pengguna memberikan kode akses kantor dan nama lengkapnya.",
      parameters: Type.Object({
        chat_id: Type.String({ description: "Chat ID pengguna Telegram" }),
        nama: Type.String({ description: "Nama lengkap pegawai" }),
        registration_code: Type.String({ description: "Kode akses kantor yang diberikan pengguna" })
      }),
      async execute(_id, params: any) {
        const { registerUser } = await import("./services/userRegistry.js");
        const result = await registerUser(
          params.chat_id,
          params.nama,
          params.registration_code
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 3. Tool: search_archive
    api.registerTool({
      name: "search_archive",
      label: "Search Archive",
      description: "Cari dokumen arsip PPID berdasarkan metadata (nama, tanggal, jenis dokumen). Bukan pencarian isi dokumen.",
      parameters: Type.Object({
        keywords: Type.String({ description: "Kata kunci dari nama dokumen" }),
        date_from: Type.Optional(Type.String({ description: "ISO date, opsional" })),
        date_to: Type.Optional(Type.String({ description: "ISO date, opsional" })),
        doc_type: Type.Optional(Type.String({ description: "Jenis dokumen (pdf, doc, any), default any" }))
      }),
      async execute(_id, params: any) {
        const { executeSearchArchive } = await import("./tools/searchArchive.js");
        const result = await executeSearchArchive(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 4. Tool: send_document
    api.registerTool({
      name: "send_document",
      label: "Send Document",
      description: "Kirim dokumen ke staf. File <50MB dikirim langsung, >=50MB dikirim sebagai link.",
      parameters: Type.Object({
        file_id: Type.String({ description: "ID file dari Google Drive" }),
        chat_id: Type.String({ description: "Chat ID staf yang meminta" })
      }),
      async execute(_id, params: any) {
        const { executeSendDocument } = await import("./tools/sendDocument.js");
        const result = await executeSendDocument(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 5. Tool: transcribe_minutes
    api.registerTool({
      name: "transcribe_minutes",
      label: "Transcribe Minutes",
      description: "Mentranskripsi file audio rapat dan membuat notulen terstruktur (.docx). Bisa menerima file audio langsung via Telegram ATAU link Google Drive. Untuk rapat panjang (>20MB), minta staf kirimkan link Google Drive saja.",
      parameters: Type.Object({
        audio_file_path: Type.Optional(Type.String({ description: "Path lokal ke file audio (dari Telegram upload)" })),
        drive_link: Type.Optional(Type.String({ description: "Link Google Drive ke file audio" })),
        chat_id: Type.String({ description: "Chat ID peminta" })
      }),
      async execute(_id, params: any) {
        const { executeTranscribeMinutes } = await import("./tools/transcribeMinutes.js");
        const result = await executeTranscribeMinutes({
          audioFilePath: params.audio_file_path,
          driveLink: params.drive_link,
          chatId: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    console.log("[OpenClaw] PPID tools registered successfully (5 tools, lazy-loaded).");
  }
}) as any;
