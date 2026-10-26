/**
 * Atividade automática na produtividade a partir dos lançamentos do SISREF:
 * uma atividade por dia, turno e fila (tipo Documento, sistema SISREF), com a quantidade
 * lançada e o número de servidores. É recalculada a partir do histórico a cada lançamento,
 * então fica certa mesmo juntando dados de dois computadores.
 */
import type { AppState, HistoryEntry, ProdutividadeDia, AtividadeLancamento } from "../types";
import { getLocalDateIso, getSaoPauloHour, toYmdDate, normalizeMatricula } from "./utils.js";
import { diaVazio } from "./produtividade.js";
import { hashName } from "./chunkedStore.js";

function turnoDe(ts: string): "manha" | "tarde" {
  return getSaoPauloHour(ts) >= 12 ? "tarde" : "manha";
}

export function grupoDoLancamento(h: HistoryEntry): string {
  return (h.fila || h.setor || "SISREF").trim();
}

function rotuloGrupo(h: HistoryEntry): string {
  const g = grupoDoLancamento(h);
  if (h.fila) return `fila ${g}`;
  if (g === "SISREF" || g === "Avulsa Fila") return "fila avulsa";
  return `setor ${g}`;
}

/** Atualiza (ou cria) a atividade do dia/turno/fila deste lançamento. */
export function atualizarProdutividadeSisref(prev: AppState, historico: HistoryEntry[], novo: HistoryEntry): Partial<AppState> {
  if (!novo?.ts) return {};
  const data = getLocalDateIso(new Date(novo.ts));
  const turno = turnoDe(novo.ts);
  const grupo = grupoDoLancamento(novo);
  const id = `sisref-${data}-${turno}-${hashName(grupo)}`;

  const p = { ...(prev.produtividade || {}) };
  const k = p[data] ? data : (Object.keys(p).find(x => toYmdDate(x) === data) || data);
  const d: ProdutividadeDia = p[k] ? { ...p[k] } : diaVazio();
  if ((d.removidos || []).includes(id)) return {}; // a pessoa excluiu esta atividade: não recria

  const doGrupo = historico.filter(h => h?.ts && getLocalDateIso(new Date(h.ts)) === data && turnoDe(h.ts) === turno && grupoDoLancamento(h) === grupo);
  const qtd = doGrupo.reduce((n, h) => n + (Number(h.qtd) || 0), 0);
  const servidores = new Set(doGrupo.map(h => normalizeMatricula(h.mat) || h.nome)).size;
  const primeiraLinha = `Lançamento de afastamentos de ${servidores} servidor(es) — ${rotuloGrupo(novo)}`;

  const lista = [...(d[turno] || [])];
  const pos = lista.findIndex(a => a.id === id);
  const antiga = pos >= 0 ? lista[pos] : undefined;
  // mantém o que a pessoa escreveu depois da primeira linha
  const resto = antiga?.desc ? antiga.desc.split("\n").slice(1).join("\n") : "";
  const item: AtividadeLancamento = {
    ...(antiga || {}),
    id,
    qtd,
    tipo: antiga?.tipo || "Documento",
    sistema: "SISREF",
    desc: resto ? `${primeiraLinha}\n${resto}` : primeiraLinha,
    autoSisref: grupo,
    atualizadoEm: Date.now()
  };
  if (pos >= 0) lista[pos] = item; else lista.push(item);
  p[k] = { ...d, [turno]: lista };
  return { produtividade: p };
}
