// Planification des rapports : calculs de fuseaux horaires et d'échéances (fonctions pures, testées).
export type ReportType = "quotidien" | "hebdomadaire" | "mensuel" | "incident";
export type Setting = {
  type: ReportType; actif: boolean; heure: string; fuseau: string; jour_semaine: number; jour_mois: number;
  format: "html" | "html_pdf"; dernier_envoi: string | null;
};

type Parts = { y: number; mo: number; d: number; h: number; mi: number; dow: number };

/** Décalage (minutes) du fuseau `tz` par rapport à UTC à l'instant `utcMs`. */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000) / 60000;
}

/** Instant UTC correspondant à une heure murale locale. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMinutes(guess, tz) * 60000;
  const off2 = tzOffsetMinutes(t, tz);
  t = guess - off2 * 60000;
  return new Date(t);
}

export function localParts(date: Date, tz: string): Parts {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
  }).formatToParts(date);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  const dow = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[g("weekday")];
  return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), h: Number(g("hour")), mi: Number(g("minute")), dow };
}

function hm(heure: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(heure);
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [18, 0];
}

/** Instant programmé aujourd'hui (heure locale) si la fréquence correspond au jour courant, sinon null. */
export function dueAt(s: Setting, now: Date): Date | null {
  if (s.type === "incident") return null;
  const l = localParts(now, s.fuseau);
  if (s.type === "hebdomadaire" && l.dow !== s.jour_semaine) return null;
  if (s.type === "mensuel" && l.d !== s.jour_mois) return null;
  const [h, mi] = hm(s.heure);
  return zonedToUtc(l.y, l.mo, l.d, h, mi, s.fuseau);
}

export function isDue(s: Setting, now: Date): { due: boolean; at: Date | null } {
  if (!s.actif) return { due: false, at: null };
  const at = dueAt(s, now);
  if (!at || now < at) return { due: false, at };
  const last = s.dernier_envoi ? new Date(s.dernier_envoi) : null;
  return { due: !last || last < at, at };
}

const fmtDate = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...o }).format(d);

export function reportPeriod(type: ReportType, now: Date, tz: string): { debut: Date; fin: Date; label: string; dateLabel: string } {
  const l = localParts(now, tz);
  const dateLabel = fmtDate(now, tz, { day: "2-digit", month: "long", year: "numeric" });
  if (type === "quotidien") {
    return { debut: zonedToUtc(l.y, l.mo, l.d, 0, 0, tz), fin: now, label: dateLabel, dateLabel };
  }
  if (type === "hebdomadaire") {
    const debut = new Date(now.getTime() - 7 * 86400e3);
    return { debut, fin: now, label: `du ${fmtDate(debut, tz, { day: "2-digit", month: "long" })} au ${dateLabel}`, dateLabel };
  }
  if (type === "mensuel") {
    const prevMo = l.mo === 1 ? 12 : l.mo - 1, prevY = l.mo === 1 ? l.y - 1 : l.y;
    const debut = zonedToUtc(prevY, prevMo, 1, 0, 0, tz), fin = zonedToUtc(l.y, l.mo, 1, 0, 0, tz);
    return { debut, fin, label: fmtDate(debut, tz, { month: "long", year: "numeric" }), dateLabel };
  }
  return { debut: new Date(now.getTime() - 24 * 3600e3), fin: now, label: dateLabel, dateLabel };
}
