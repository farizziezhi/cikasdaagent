export interface BusinessDaysResult {
  daysRemaining: number;
  status: "NORMAL" | "WARNING" | "CRITICAL" | "OVERDUE";
  formattedTargetDate: string;
}

const HOLIDAYS_YMD: Set<string> = new Set([
  "2026-01-01",
  "2026-03-20",
  "2026-03-21",
  "2026-04-03",
  "2026-05-01",
  "2026-05-14",
  "2026-05-25",
  "2026-06-01",
  "2026-06-16",
  "2026-08-17",
  "2026-12-25"
]);

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isHoliday(date: Date): boolean {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return HOLIDAYS_YMD.has(`${yyyy}-${mm}-${dd}`);
}

export function isWorkingDay(date: Date): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/**
 * Menghitung selisih hari kerja (Senin-Jumat non-libur) antara tanggal acuan dan tanggal tenggat.
 * Mengacu pada UU No. 14 Tahun 2008 Pasal 22 untuk SLA permohonan informasi publik.
 */
export function calculateBusinessDaysRemaining(
  currentDate: Date,
  targetDate: Date | string
): BusinessDaysResult {
  const target = typeof targetDate === "string" ? new Date(targetDate) : new Date(targetDate.getTime());
  
  const start = new Date(currentDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(target);
  end.setHours(0, 0, 0, 0);

  const formattedTargetDate = end.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const diffMs = end.getTime() - start.getTime();
  
  if (diffMs < 0) {
    let overdueDays = 0;
    const cur = new Date(end);
    while (cur < start) {
      cur.setDate(cur.getDate() + 1);
      if (isWorkingDay(cur)) {
        overdueDays++;
      }
    }
    return {
      daysRemaining: -overdueDays,
      status: "OVERDUE",
      formattedTargetDate
    };
  }

  let workingDays = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur)) {
      workingDays++;
    }
  }

  let status: BusinessDaysResult["status"] = "NORMAL";
  if (workingDays <= 0) {
    status = "CRITICAL";
  } else if (workingDays === 1) {
    status = "CRITICAL";
  } else if (workingDays <= 3) {
    status = "WARNING";
  }

  return {
    daysRemaining: workingDays,
    status,
    formattedTargetDate
  };
}

/**
 * Menambahkan sejumlah hari kerja ke tanggal awal.
 * Digunakan untuk menghitung deadline perpanjangan waktu layanan (+7 hari kerja).
 */
export function addBusinessDays(startDate: Date, daysToAdd: number): Date {
  const result = new Date(startDate);
  result.setHours(0, 0, 0, 0);
  
  let added = 0;
  while (added < daysToAdd) {
    result.setDate(result.getDate() + 1);
    if (isWorkingDay(result)) {
      added++;
    }
  }
  return result;
}
