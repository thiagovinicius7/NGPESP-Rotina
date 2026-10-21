/**
 * Regras da produtividade diária: situação por turno, identificação das
 * atividades e junção entre computadores sem ressuscitar o que foi excluído.
 */
import type { AtividadeLancamento, ProdutividadeDia } from "../types";

export type Turno = "manha" | "tarde";

export const SITUACOES: { id: string; label: string }[] = [
  { id: "normal", label: "Trabalho" },
  { id: "atestado", label: "Atestado" },
  { id: "abono", label: "Abono" },
  { id: "ferias", label: "Férias" },
  { id: "afastamento", label: "Afastamento" },
  { id: "folga", label: "Folga/Feriado" }
];

export function labelSituacao(id: string): string {
  if (id === "parcial") return "Meio período";
  return SITUACOES.find(s => s.id === id)?.label || id;
}

/** "Trabalho Normal", vazio etc. → "normal". */
export function normSituacao(s: any): string {
  const v = String(s || "").trim().toLowerCase();
  if (!v || v === "trabalho normal" || v === "dia normal" || v === "trabalho") return "normal";
  if (v === "parcial") return "parcial";
  if (v.startsWith("féria") || v.startsWith("feria")) return "ferias";
  if (v.startsWith("folga") || v.startsWith("feriado")) return "folga";
  return SITUACOES.some(x => x.id === v) ? v : "normal";
}

export function situacaoTurno(dia: Partial<ProdutividadeDia> | undefined, turno: Turno): string {
  if (!dia) return "normal";
  const propria = turno === "manha" ? dia.situacaoManha : dia.situacaoTarde;
  if (propria) return normSituacao(propria);
  const geral = normSituacao(dia.situacao);
  return geral === "parcial" ? "normal" : geral;
}

export function situacaoGeral(manha: string, tarde: string): string {
  return manha === tarde ? manha : "parcial";
}

export function diaVazio(): ProdutividadeDia {
  return { situacao: "normal", sitObs: "", manha: [], tarde: [] };
}

export function novoIdAtividade(): string {
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Chave que identifica uma atividade: o id, ou o conteúdo (atividades antigas, sem id). */
export function chaveAtividade(a: AtividadeLancamento): string {
  if (a && a.id) return a.id;
  return `${a?.tipo}_${a?.sistema}_${a?.qtd}_${a?.desc || ""}_${a?.processosSei || ""}`;
}

export function qtdNum(a: AtividadeLancamento): number {
  return parseInt(String(a?.qtd ?? ""), 10) || 0;
}

function juntarLista(l1: AtividadeLancamento[], l2: AtividadeLancamento[], removidos: Set<string>): AtividadeLancamento[] {
  const map = new Map<string, AtividadeLancamento>();
  for (const item of [...l1, ...l2]) {
    if (!item) continue;
    const k = chaveAtividade(item);
    const atual = map.get(k);
    // mesma atividade nos dois lados: fica a editada por último (sem data, vale a do segundo lado)
    if (!atual || (Number(item.atualizadoEm) || 0) >= (Number(atual.atualizadoEm) || 0)) map.set(k, item);
  }
  return Array.from(map.values()).filter(a => !removidos.has(chaveAtividade(a)));
}

/** Junta dois dias de produtividade (mesma data) vindos de computadores diferentes. */
export function juntarDiaProdutividade(d1: ProdutividadeDia, d2: ProdutividadeDia): ProdutividadeDia {
  const removidos = new Set<string>([...(d1.removidos || []), ...(d2.removidos || [])]);
  const manha = juntarLista(Array.isArray(d1.manha) ? d1.manha : [], Array.isArray(d2.manha) ? d2.manha : [], removidos);
  const tarde = juntarLista(Array.isArray(d1.tarde) ? d1.tarde : [], Array.isArray(d2.tarde) ? d2.tarde : [], removidos);

  // situação: vale a alterada por último; sem data, a do segundo lado (comportamento antigo)
  const t1 = Number(d1.sitEm) || 0, t2 = Number(d2.sitEm) || 0;
  const sit = t1 > t2 ? d1 : t2 > t1 ? d2 : null;
  const base: Partial<ProdutividadeDia> = sit
    ? { situacao: sit.situacao, situacaoManha: sit.situacaoManha, situacaoTarde: sit.situacaoTarde, sitObs: sit.sitObs, sitEm: sit.sitEm }
    : {
        situacao: d2.situacao || d1.situacao || "normal",
        situacaoManha: d2.situacaoManha || d1.situacaoManha,
        situacaoTarde: d2.situacaoTarde || d1.situacaoTarde,
        sitObs: d2.sitObs || d1.sitObs || ""
      };

  const out: ProdutividadeDia = { situacao: base.situacao || "normal", sitObs: base.sitObs || "", manha, tarde };
  if (base.situacaoManha) out.situacaoManha = base.situacaoManha;
  if (base.situacaoTarde) out.situacaoTarde = base.situacaoTarde;
  if (base.sitEm) out.sitEm = base.sitEm;
  if (removidos.size) out.removidos = Array.from(removidos).slice(-500);
  return out;
}
