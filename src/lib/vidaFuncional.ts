/** Leituras da Vida Funcional (férias, abonos, afastamentos) usadas em mais de uma tela. */
import type { AppState, Absence } from "../types";

const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Mês AAAA-MM a partir do campo "mes" (aceita AAAA-MM, MM/AAAA, MM e o texto de data do JavaScript). */
export function mesDoAfastamento(mes: string): string {
  const s = String(mes || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^[A-Za-z]{3} ([A-Za-z]{3}) \d{1,2} (\d{4})/); // "Thu Jan 01 2026 00:00:00 GMT-0300"
  if (m) {
    const i = MESES.indexOf(m[1].toLowerCase());
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  return "";
}

/** Período (AAAA-MM-DD) de um afastamento, inclusive dos registros antigos que só têm dia e mês. */
export function periodoAfastamento(a: Absence): { inicio: string; fim: string } | null {
  if (a.inicio) return { inicio: a.inicio, fim: a.fim && a.fim >= a.inicio ? a.fim : a.inicio };
  const mes = mesDoAfastamento(a.mes);
  const dia = parseInt(String(a.dia || ""), 10);
  if (!mes || !dia) return null;
  const ini = `${mes}-${String(dia).padStart(2, "0")}`;
  return { inicio: ini, fim: ini };
}

export function diasEntre(inicio?: string, fim?: string): number {
  if (!inicio || !fim) return 0;
  const n = Math.round((new Date(fim + "T12:00:00").getTime() - new Date(inicio + "T12:00:00").getTime()) / 86400000) + 1;
  return n > 0 ? n : 0;
}

export function fmtBR(iso?: string): string {
  return iso ? iso.split("-").reverse().join("/") : "";
}

export interface EventoVida {
  tipo: "ferias" | "abono" | "afastamento";
  situacao: string;          // id da situação na produtividade
  turno?: "manha" | "tarde"; // só um turno (afastamento de meio período)
  texto: string;
}

/** O que a Vida Funcional diz sobre um dia (férias, abono ou afastamento registrados). */
export function eventosDoDia(state: AppState, iso: string): EventoVida[] {
  const out: EventoVida[] = [];
  Object.entries(state.ferias || {}).forEach(([ex, lista]) => (lista || []).forEach((p, i) => {
    if (p?.inicio && p?.fim && iso >= p.inicio && iso <= p.fim) out.push({ tipo: "ferias", situacao: "ferias", texto: `Férias (exercício ${ex}, ${i + 1}º período: ${fmtBR(p.inicio)} a ${fmtBR(p.fim)})` });
  }));
  Object.values(state.abonos || {}).forEach(lista => (lista || []).forEach(a => {
    if (a?.data === iso) out.push({ tipo: "abono", situacao: "abono", texto: `Abono${a.processo ? ` — ${a.processo}` : ""}` });
  }));
  (state.afastamentos || []).forEach(a => {
    const p = periodoAfastamento(a);
    if (p && iso >= p.inicio && iso <= p.fim) {
      const turno = a.turno === "manha" || a.turno === "tarde" ? a.turno : undefined;
      const sit = /atest|licen|médic|medic|odont/i.test(a.tipo) ? "atestado" : "afastamento";
      out.push({ tipo: "afastamento", situacao: sit, turno, texto: `${a.tipo}${turno ? ` (${turno === "manha" ? "manhã" : "tarde"})` : ""}` });
    }
  });
  return out;
}
