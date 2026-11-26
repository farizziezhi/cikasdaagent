import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export interface ApelinSessionRow {
  id: string;
  sessionCode: string;
  sessionType: "MORNING" | "AFTERNOON";
  localDate: Date;
  scheduledOpenAt: Date;
  lateAfterAt: Date;
  scheduledCloseAt: Date;
  status: "SCHEDULED" | "ACTIVE" | "CLOSED" | "FINALIZED";
  startedAt: Date | null;
  closedAt: Date | null;
}

export interface DepartmentRecapRow {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  totalEmployees: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
}

export interface AuditSnapshotRow {
  anchorStatus: string;
  txHash: string | null;
  blockNumber: string | null;
  anchoredAt: Date | null;
}

export interface ApelinReportData {
  session: {
    id: string;
    sessionCode: string;
    sessionType: "MORNING" | "AFTERNOON";
    localDate: string;
    status: string;
    scheduledOpenAt: string;
    scheduledCloseAt: string;
  };
  summary: {
    totalEmployees: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    attendanceRate: string;
  };
  departments: Array<{
    departmentName: string;
    totalEmployees: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    rate: string;
  }>;
  snapshot: {
    anchorStatus: string;
    txHash: string | null;
  } | null;
}

export interface ApelinClientOptions {
  connectionString?: string;
  customGetSession?: (date?: string) => Promise<ApelinSessionRow | null>;
  customGetDepartmentRecap?: (sessionId: string) => Promise<DepartmentRecapRow[]>;
  customGetSnapshot?: (sessionId: string) => Promise<AuditSnapshotRow | null>;
}

export class ApelinClient {
  private pool: pg.Pool | null = null;
  private customGetSession?: (date?: string) => Promise<ApelinSessionRow | null>;
  private customGetDepartmentRecap?: (sessionId: string) => Promise<DepartmentRecapRow[]>;
  private customGetSnapshot?: (sessionId: string) => Promise<AuditSnapshotRow | null>;

  constructor(options: ApelinClientOptions = {}) {
    this.customGetSession = options.customGetSession;
    this.customGetDepartmentRecap = options.customGetDepartmentRecap;
    this.customGetSnapshot = options.customGetSnapshot;

    const connectionString = options.connectionString ?? env.APELIN_DATABASE_URL;

    if (connectionString && !this.customGetSession) {
      this.pool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });
    }
  }

  public isConnected(): boolean {
    return Boolean(this.pool || this.customGetSession);
  }

  public async getSession(dateStr?: string): Promise<ApelinSessionRow | null> {
    if (this.customGetSession) {
      return this.customGetSession(dateStr);
    }

    if (!this.pool) return null;

    if (dateStr && dateStr.trim()) {
      const query = `
        SELECT 
          id, 
          "sessionCode", 
          "sessionType", 
          "localDate", 
          "scheduledOpenAt", 
          "lateAfterAt", 
          "scheduledCloseAt", 
          status, 
          "startedAt", 
          "closedAt"
        FROM attendance_sessions
        WHERE "localDate"::date = $1::date
        ORDER BY "scheduledOpenAt" DESC
        LIMIT 1;
      `;
      const res = await this.pool.query(query, [dateStr.trim()]);
      return res.rows[0] ?? null;
    }

    const query = `
      SELECT 
        id, 
        "sessionCode", 
        "sessionType", 
        "localDate", 
        "scheduledOpenAt", 
        "lateAfterAt", 
        "scheduledCloseAt", 
        status, 
        "startedAt", 
        "closedAt"
      FROM attendance_sessions
      ORDER BY "scheduledOpenAt" DESC
      LIMIT 1;
    `;
    const res = await this.pool.query(query);
    return res.rows[0] ?? null;
  }

  public async getSessionRecap(dateStr?: string): Promise<ApelinReportData | null> {
    const session = await this.getSession(dateStr);
    if (!session) return null;

    let deptRows: DepartmentRecapRow[] = [];

    if (this.customGetDepartmentRecap) {
      deptRows = await this.customGetDepartmentRecap(session.id);
    } else if (this.pool) {
      const dQuery = `
        SELECT 
          d.id as "departmentId",
          d.name as "departmentName",
          d.code as "departmentCode",
          COUNT(e.id)::int as "totalEmployees",
          COUNT(ar.id) FILTER (WHERE ar.status = 'PRESENT')::int as "presentCount",
          COUNT(ar.id) FILTER (WHERE ar.status = 'LATE')::int as "lateCount",
          COUNT(ar.id) FILTER (WHERE ar.status = 'ABSENT' OR ar.status IS NULL)::int as "absentCount"
        FROM departments d
        LEFT JOIN employees e ON e."departmentId" = d.id AND e."isActive" = true
        LEFT JOIN attendance_records ar ON ar."employeeId" = e.id AND ar."sessionId" = $1
        GROUP BY d.id, d.name, d.code
        ORDER BY d.code ASC;
      `;
      const dRes = await this.pool.query(dQuery, [session.id]);
      deptRows = dRes.rows;
    }

    let snapshotRow: AuditSnapshotRow | null = null;

    if (this.customGetSnapshot) {
      snapshotRow = await this.customGetSnapshot(session.id);
    } else if (this.pool) {
      const sQuery = `
        SELECT 
          "anchorStatus", 
          "txHash", 
          "blockNumber"::text as "blockNumber", 
          "anchoredAt"
        FROM audit_snapshots
        WHERE "sessionId" = $1
        LIMIT 1;
      `;
      const sRes = await this.pool.query(sQuery, [session.id]);
      snapshotRow = sRes.rows[0] ?? null;
    }

    let totalEmployees = 0;
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;

    const departments = deptRows.map((d) => {
      const deptTotal = Number(d.totalEmployees) || 0;
      const deptPresent = Number(d.presentCount) || 0;
      const deptLate = Number(d.lateCount) || 0;
      const deptAbsent = Number(d.absentCount) || 0;

      totalEmployees += deptTotal;
      totalPresent += deptPresent;
      totalLate += deptLate;
      totalAbsent += deptAbsent;

      const rateNum = deptTotal > 0 ? ((deptPresent + deptLate) / deptTotal) * 100 : 0;

      return {
        departmentName: d.departmentName,
        totalEmployees: deptTotal,
        presentCount: deptPresent,
        lateCount: deptLate,
        absentCount: deptAbsent,
        rate: rateNum.toFixed(1),
      };
    });

    const overallRateNum = totalEmployees > 0 ? ((totalPresent + totalLate) / totalEmployees) * 100 : 0;

    return {
      session: {
        id: session.id,
        sessionCode: session.sessionCode,
        sessionType: session.sessionType,
        localDate: new Date(session.localDate).toLocaleDateString("id-ID", {
          dateStyle: "long",
        }),
        status: session.status,
        scheduledOpenAt: new Date(session.scheduledOpenAt).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        scheduledCloseAt: new Date(session.scheduledCloseAt).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      summary: {
        totalEmployees,
        presentCount: totalPresent,
        lateCount: totalLate,
        absentCount: totalAbsent,
        attendanceRate: overallRateNum.toFixed(1),
      },
      departments,
      snapshot: snapshotRow
        ? {
            anchorStatus: snapshotRow.anchorStatus,
            txHash: snapshotRow.txHash,
          }
        : null,
    };
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export function formatApelinReportMessage(report: ApelinReportData | null): string {
  if (!report) {
    return [
      "⏱️ <b>Pengawasan Apel Kedinasan APEL-IN</b>",
      "Tidak ada data sesi apel yang ditemukan untuk tanggal yang dimaksud.",
      "",
      "💡 <i>Catatan: Jadwal apel rutin: Senin Pagi (07:15 WITA) & Kamis Sore (15:45 WITA).</i>",
    ].join("\n");
  }

  const s = report.session;
  const isMorning = s.sessionType === "MORNING";
  const sessionName = isMorning ? "Apel Senin Pagi" : "Apel Kamis Sore";

  const statusBadge =
    s.status === "ACTIVE"
      ? "🟡 <b>SEDANG BERLANGSUNG</b>"
      : s.status === "CLOSED" || s.status === "FINALIZED"
      ? "🟢 <b>SELESAI DITUTUP</b>"
      : "⚪ <b>TERJADWAL</b>";

  const sum = report.summary;
  const presentPct = sum.totalEmployees > 0 ? ((sum.presentCount / sum.totalEmployees) * 100).toFixed(1) : "0";
  const latePct = sum.totalEmployees > 0 ? ((sum.lateCount / sum.totalEmployees) * 100).toFixed(1) : "0";
  const absentPct = sum.totalEmployees > 0 ? ((sum.absentCount / sum.totalEmployees) * 100).toFixed(1) : "0";

  const lines: string[] = [
    "⏱️ <b>LAPORAN PRESENSI APEL KEDINASAN CIKASDA</b>",
    `• <b>Sesi        :</b> ${sessionName} (${s.localDate})`,
    `• <b>Kode Sesi   :</b> <code>${s.sessionCode}</code>`,
    `• <b>Status Sesi :</b> ${statusBadge} (${s.scheduledOpenAt} - ${s.scheduledCloseAt} WITA)`,
    "",
    "📊 <b>Ringkasan Kehadiran Total:</b>",
    `• <b>Total Pegawai Terdaftar :</b> ${sum.totalEmployees} orang`,
    `• <b>Hadir Tepat Waktu (✓)   :</b> ${sum.presentCount} orang (${presentPct}%)`,
    `• <b>Hadir Terlambat (⚠️)    :</b> ${sum.lateCount} orang (${latePct}%)`,
    `• <b>Tanpa Keterangan (✗)    :</b> ${sum.absentCount} orang (${absentPct}%)`,
    `• <b>Total Tingkat Disiplin  :</b> <b>${sum.attendanceRate}%</b>`,
    "",
    "🏢 <b>Persentase Kehadiran per Unit Kerja:</b>",
  ];

  report.departments.forEach((dept, idx) => {
    const presentTotal = dept.presentCount + dept.lateCount;
    lines.push(
      `${idx + 1}. <b>${dept.departmentName}</b>: ${dept.rate}% (${presentTotal}/${dept.totalEmployees} hadir)`
    );
  });

  if (report.snapshot && report.snapshot.txHash) {
    const rawTx = report.snapshot.txHash;
    const shortTx = rawTx.length > 14 ? `${rawTx.slice(0, 6)}...${rawTx.slice(-4)}` : rawTx;
    lines.push("");
    lines.push(`🔒 <b>Audit Trail Sepolia:</b> TERSINKRONISASI ON-CHAIN (Tx: <code>${shortTx}</code>)`);
  }

  return lines.join("\n");
}

export const apelinClient = new ApelinClient();
