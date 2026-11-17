import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { CommandCenterScheduler } from "./services/commandCenterScheduler.js";
import { sendBroadcast } from "./services/broadcast.js";

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

    // 5. Tool: transcribe_minutes (Multimodal: Audio, PPTX, PDF, Foto, Teks)
    api.registerTool({
      name: "transcribe_minutes",
      label: "Transcribe Minutes & Meeting Notes",
      description: "Menyusun notulen rapat cerdas, bersih, dan to-the-point (.docx & ringkasan chat Telegram). Mendukung multimodal: Voice Note/audio, link Google Drive, materi slide PPTX/PDF, foto papan tulis/slide rapat, atau coretan catatan teks dari staf.",
      parameters: Type.Object({
        audio_file_path: Type.Optional(Type.String({ description: "Path lokal ke file audio / voice note" })),
        drive_link: Type.Optional(Type.String({ description: "Link Google Drive ke rekaman audio rapat" })),
        document_file_path: Type.Optional(Type.String({ description: "Path lokal ke file materi presentasi PPTX atau PDF" })),
        image_file_path: Type.Optional(Type.String({ description: "Path lokal ke foto papan tulis rapat atau foto slide" })),
        meeting_notes_text: Type.Optional(Type.String({ description: "Catatan kasar teks tambahan dari staf di chat" })),
        chat_id: Type.String({ description: "Chat ID peminta" })
      }),
      async execute(_id, params: any) {
        const { executeTranscribeMinutes } = await import("./tools/transcribeMinutes.js");
        const result = await executeTranscribeMinutes({
          audioFilePath: params.audio_file_path,
          driveLink: params.drive_link,
          documentFilePath: params.document_file_path,
          imageFilePath: params.image_file_path,
          meetingNotesText: params.meeting_notes_text,
          chatId: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 6. Tool: learn_meeting_context
    api.registerTool({
      name: "learn_meeting_context",
      label: "Learn Meeting Context & Memory",
      description: "Menyimpan atau melihat memori konteks dinas (proyek berjalan, peran tim/staf, istilah singkatan khusus, atau preferensi rapat). Panggil tool ini saat staf mengajari bot fakta baru, meralat istilah, atau bertanya apa saja yang sudah diingat bot.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("learn"),
          Type.Literal("forget"),
          Type.Literal("list")
        ], { description: "Aksi: 'learn' (mengingat fakta baru), 'forget' (menghapus fakta), atau 'list' (melihat memori)" }),
        category: Type.Optional(Type.Union([
          Type.Literal("project"),
          Type.Literal("team"),
          Type.Literal("glossary"),
          Type.Literal("preference")
        ], { description: "Kategori fakta: project, team, glossary, preference" })),
        key: Type.Optional(Type.String({ description: "Kata kunci / topik / istilah / nama orang" })),
        value: Type.Optional(Type.String({ description: "Penjelasan fakta atau konteks yang harus diingat" }))
      }),
      async execute(_id, params: any) {
        const { executeLearnContext } = await import("./tools/learnContext.js");
        const result = await executeLearnContext(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 7. Tool: check_ppid_sla
    api.registerTool({
      name: "check_ppid_sla",
      label: "Check PPID Digital SLA Status",
      description: "Pantau kepatuhan batas waktu SLA permohonan informasi publik PPID Digital (10 hari kerja + 7 hari perpanjangan). Panggil saat staf bertanya status permohonan, tiket mendekati jatuh tempo (H-3/H-1), atau ringkasan permohonan aktif.",
      parameters: Type.Object({
        id: Type.Optional(Type.Number({ description: "Nomor ID tiket permohonan tertentu (opsional, kosongkan untuk melihat semua tiket aktif)" })),
        chat_id: Type.Optional(Type.String({ description: "Chat ID pengguna Telegram" }))
      }),
      async execute(_id, params: any) {
        const { executeCheckPpidSla } = await import("./tools/ppidSlaTool.js");
        const result = await executeCheckPpidSla({
          id: params.id,
          chat_id: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 8. Tool: extend_ppid_sla
    api.registerTool({
      name: "extend_ppid_sla",
      label: "Extend PPID SLA (+7 Hari Kerja)",
      description: "Memperpanjang batas waktu layanan informasi publik (+7 hari kerja) langsung di basis data PPID Digital sesuai UU KIP No. 14/2008 Pasal 22 ayat (7). Hanya dapat dilakukan satu kali per tiket permohonan.",
      parameters: Type.Object({
        id: Type.Number({ description: "Nomor ID tiket permohonan informasi yang diperpanjang" }),
        alasan: Type.String({ description: "Alasan resmi perpanjangan waktu layanan (minimal 5 karakter, contoh verifikasi teknis/lapangan)" }),
        chat_id: Type.String({ description: "Chat ID petugas PPID yang mengeksekusi" })
      }),
      async execute(_id, params: any) {
        const { executeExtendPpidSla } = await import("./tools/ppidSlaTool.js");
        const result = await executeExtendPpidSla({
          id: params.id,
          alasan: params.alasan,
          chat_id: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 9. Tool: track_sivera_surat
    api.registerTool({
      name: "track_sivera_surat",
      label: "Track SIVERA Mail & Disposition",
      description: "Lacak posisi surat dinas masuk pada 5 Checkpoint audit trail SIVERA (Registrasi PPID -> Agenda Kearsipan -> Disposisi Kadis -> Tanda Terima Bidang -> Arsip) dan lihat catatan lembar disposisi pimpinan. Panggil saat staf PPID bertanya posisi surat, disposisi surat, atau status naskah dinas tertentu.",
      parameters: Type.Object({
        keyword: Type.String({ description: "Kata kunci pencarian (Nomor surat, nomor agenda, nama instansi pengirim, atau perihal)" }),
        chat_id: Type.Optional(Type.String({ description: "Chat ID pengguna Telegram" }))
      }),
      async execute(_id, params: any) {
        const { executeTrackSiveraSurat } = await import("./tools/siveraTrackTool.js");
        const result = await executeTrackSiveraSurat({
          keyword: params.keyword,
          chat_id: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 10. Tool: check_apelin_session
    api.registerTool({
      name: "check_apelin_session",
      label: "Check APEL-IN Attendance Report",
      description: "Pantau status operasional sesi apel dinas (Senin Pagi 07:15 & Kamis Sore 15:45 WITA) dan dapatkan rekapitulasi kehadiran pegawai per bidang yang siap dilaporkan ke pimpinan (Kadis / Sekdis). Panggil saat staf bertanya status apel hari ini, presensi apel, atau rekap disiplin pegawai.",
      parameters: Type.Object({
        date: Type.Optional(Type.String({ description: "Tanggal sesi apel dalam format YYYY-MM-DD (opsional, kosongkan untuk sesi hari ini/terbaru)" })),
        chat_id: Type.Optional(Type.String({ description: "Chat ID pengguna Telegram" }))
      }),
      async execute(_id, params: any) {
        const { executeCheckApelinSession } = await import("./tools/apelinSessionTool.js");
        const result = await executeCheckApelinSession({
          date: params.date,
          chat_id: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    // 11. Tool: trigger_morning_digest
    api.registerTool({
      name: "trigger_morning_digest",
      label: "Trigger Morning Command Briefing",
      description: "Menyusun dan menampilkan laporan pagi terpadu (Morning Command Briefing CIKASDA) yang merangkum 3 pilar: tiket SLA KIP PPID yang mendesak, antrean naskah dinas di loket/meja Kadis SIVERA, dan jadwal/status apel kedinasan APEL-IN hari ini. Panggil saat staf/pimpinan meminta briefing pagi, laporan harian, atau ringkasan status dinas.",
      parameters: Type.Object({
        chat_id: Type.Optional(Type.String({ description: "Chat ID pengguna Telegram" }))
      }),
      async execute(_id, params: any) {
        const { executeTriggerMorningDigest } = await import("./tools/morningDigestTool.js");
        const result = await executeTriggerMorningDigest({
          chat_id: params.chat_id
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });

    console.log("[OpenClaw] PPID tools registered successfully (11 tools: Notulensi, Arsip, Memori, PPID SLA Watchdog, SIVERA Tracking, APEL-IN Presence, & Morning Briefing).");

    // --- Scheduler proaktif (PATCH GABUNGAN 2026-11-17) ---
    // Inilah yang selama ini hilang: scheduler dibuat + start() dipanggil,
    // dengan callback pengiriman Telegram yang nyata.
    // Guard global supaya start() tidak dobel kalau plugin di-reload.
    const g = globalThis as unknown as { __cikasdaSchedulerStarted?: boolean };
    if (!g.__cikasdaSchedulerStarted) {
      g.__cikasdaSchedulerStarted = true;
      const scheduler = new CommandCenterScheduler({ sendBroadcast });
      scheduler.start(60_000); // cek tiap 1 menit
      console.log(
        "[OpenClaw] CommandCenterScheduler started (briefing 08:00, apel Senin 06:45 & Kamis 15:45, cek SLA tiap jam kerja)",
      );
    }
  }
}) as any;





