/**
 * Atendimento de balcão aberto ("plantão"): fica guardado na produtividade como uma atividade
 * marcada "em andamento". Assim, ao juntar dados de dois computadores, vale a versão mais nova
 * de cada atividade (pelo id) e nada é apagado por um aparelho que não sabia do atendimento.
 */
import type { AppState, AtividadeLancamento, ProdutividadeDia, SessaoBalcao } from "../types";
import { getLocalDateIso, getSaoPauloHour, toYmdDate } from "./utils.js";
import { diaVazio, novoIdAtividade } from "./produtividade.js";

export interface LocalSessao { chave: string; turno: "manha" | "tarde"; item: AtividadeLancamento }

function horaSP(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function acharSessao(prod: Record<string, ProdutividadeDia> | undefined): LocalSessao | null {
  let achado: LocalSessao | null = null;
  Object.entries(prod || {}).forEach(([chave, d]) => (["manha", "tarde"] as const).forEach(turno => (d?.[turno] || []).forEach(item => {
    if (item?.emAndamento && (!achado || (Number(item.atualizadoEm) || 0) > (Number(achado.item.atualizadoEm) || 0))) achado = { chave, turno, item };
  })));
  return achado;
}

export function sessaoAtual(state: AppState): SessaoBalcao | null {
  const l = acharSessao(state.produtividade);
  if (!l) return null;
  return { inicio: l.item.inicioIso || new Date().toISOString(), topicos: l.item.topicos || [] };
}

function chaveDoDia(p: Record<string, ProdutividadeDia>, iso: string) {
  return p[iso] ? iso : (Object.keys(p).find(k => toYmdDate(k) === iso) || iso);
}

/** Abre, altera ou descarta o atendimento aberto. */
export function gravarSessaoNoEstado(prev: AppState, fn: (s: SessaoBalcao | null) => SessaoBalcao | null): Partial<AppState> {
  const p = { ...(prev.produtividade || {}) };
  const loc = acharSessao(p);
  const atual: SessaoBalcao | null = loc ? { inicio: loc.item.inicioIso || new Date().toISOString(), topicos: loc.item.topicos || [] } : null;
  const prox = fn(atual);
  const agora = Date.now();
  if (loc) {
    const d = { ...p[loc.chave] };
    if (!prox) {
      d[loc.turno] = (d[loc.turno] || []).filter(a => a.id !== loc.item.id);
      d.removidos = [...(d.removidos || []), loc.item.id!];
    } else {
      d[loc.turno] = (d[loc.turno] || []).map(a => a.id === loc.item.id ? {
        ...a, inicioIso: prox.inicio, inicio: horaSP(prox.inicio), topicos: prox.topicos, qtd: 1,
        desc: prox.topicos.map(t => `${t.hora} — ${t.texto}`).join("\n"), atualizadoEm: agora
      } : a);
    }
    p[loc.chave] = d;
  } else if (prox) {
    const data = getLocalDateIso(new Date(prox.inicio));
    const turno: "manha" | "tarde" = getSaoPauloHour(prox.inicio) >= 12 ? "tarde" : "manha";
    const k = chaveDoDia(p, data);
    const d: ProdutividadeDia = p[k] ? { ...p[k] } : diaVazio();
    const item: AtividadeLancamento = {
      id: novoIdAtividade(), qtd: 1, tipo: "Atendimento", sistema: "Balcão", origem: "balcao",
      emAndamento: true, inicioIso: prox.inicio, inicio: horaSP(prox.inicio), topicos: prox.topicos,
      desc: prox.topicos.map(t => `${t.hora} — ${t.texto}`).join("\n"), atualizadoEm: agora
    };
    d[turno] = [...(d[turno] || []), item];
    p[k] = d;
  }
  return { produtividade: p };
}

/** Encerra: a mesma atividade deixa de estar "em andamento" e ganha o horário de fim. */
export function encerrarSessaoNoEstado(prev: AppState, topicos: SessaoBalcao["topicos"]): Partial<AppState> {
  const p = { ...(prev.produtividade || {}) };
  const loc = acharSessao(p);
  if (!loc) return {};
  const d = { ...p[loc.chave] };
  d[loc.turno] = (d[loc.turno] || []).map(a => {
    if (a.id !== loc.item.id) return a;
    const { emAndamento, ...resto } = a;
    return { ...resto, topicos, qtd: 1, desc: topicos.map(t => `${t.hora} — ${t.texto}`).join("\n"), fim: horaSP(new Date()), atualizadoEm: Date.now() };
  });
  p[loc.chave] = d;
  return { produtividade: p };
}
