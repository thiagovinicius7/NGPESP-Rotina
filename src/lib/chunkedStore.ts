/**
 * ARMAZENAMENTO EM PEDAÇOS (v2) — funções puras, sem Firebase.
 *
 * O estado é dividido em "slots" pequenos. Cada versão de um slot é gravada num
 * documento IMUTÁVEL cujo id inclui um hash do conteúdo ("<slot>~<hash>").
 * O documento "_index" aponta qual documento vale para cada slot e é gravado por
 * último, numa única escrita. Assim um leitor nunca vê um estado pela metade.
 *
 * Slots:
 *   global                 respostas, códigos, sei, afastamentos, férias, abonos, balcão, faq, config, gasUrl
 *   fila_root              filaAvulsa sem as listas (ativa, natal, configProd, pendencias) + ordem das listas
 *   filameta__<h>          dados de uma lista da fila (nome, idx, nº de pedaços)
 *   fila__<h>__<n>         pedaço n (25 itens) de uma lista da fila
 *   serv__<n>              pedaço n (250) dos servidores
 *   hist__<AAAA-MM-DD>     histórico de um dia (dias inteiros, mais recentes, até ~2000 registros)
 *   prod__<AAAA-MM>        produtividade de um mês
 *   lanc__<n>              pedaço n (250) dos lançamentos anteriores
 *
 * Grupos (unidade de "quem salvou por último vence" entre computadores):
 *   cada lista da fila é um grupo; cada dia de histórico e cada mês de produtividade
 *   são grupos; servidores e lançamentos são um grupo cada; global e fila_root também.
 */
import { AppState } from "../types.js";

export const V2_VERSION = 2;

const FILA_CHUNK = 25;
const SERV_CHUNK = 250;
const LANC_CHUNK = 250;
const HIST_MAX_ENTRIES = 2000;

export type SlotMap = Record<string, any>;

/** Hash curto e estável (djb2) para nomes de listas. */
export function hashName(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Hash de conteúdo (~64 bits, dois hashes independentes). */
export function contentHash(str: string): string {
  let h1 = 5381, h2 = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = (c + (h2 << 6) + (h2 << 16) - h2) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + str.length.toString(36);
}

export function slotDocId(slot: string, content: any): string {
  return `${slot}~${contentHash(JSON.stringify(content))}`;
}

/** Grupo ao qual o slot pertence. */
export function slotGroup(slot: string): string {
  if (slot.startsWith("filameta__")) return "filalist:" + slot.slice("filameta__".length);
  if (slot.startsWith("fila__")) return "filalist:" + slot.split("__")[1];
  if (slot.startsWith("serv__")) return "serv";
  if (slot.startsWith("lanc__")) return "lanc";
  return slot; // global, fila_root, hist__dia, prod__mes
}

/** Campos do estado afetados por cada grupo (para aplicar só o que mudou). */
export function groupFields(group: string): string[] {
  if (group === "global") return ["respostas", "codigos", "sei", "afastamentos", "ferias", "abonos", "balcaoAtendimentos", "faq", "config", "gasUrl"];
  if (group === "fila_root" || group.startsWith("filalist:")) return ["filaAvulsa"];
  if (group === "serv") return ["servidores"];
  if (group === "lanc") return ["lancamentosAnteriores", "config"];
  if (group.startsWith("hist__")) return ["historico"];
  if (group.startsWith("prod__")) return ["produtividade"];
  return [];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dayKey(ts: any): string {
  const s = typeof ts === "string" ? ts : "";
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "sem-data";
}

/** Converte o estado do app em slots. */
export function stateToSlots(state: AppState): SlotMap {
  const slots: SlotMap = {};
  const lanc: any[] = (state.config as any)?.lancamentosAnteriores || state.lancamentosAnteriores || [];

  // global
  const { lancamentosAnteriores: _dup, ...configSemLanc } = (state.config || {}) as any;
  slots["global"] = {
    respostas: state.respostas || [],
    codigos: state.codigos || [],
    sei: state.sei || [],
    afastamentos: state.afastamentos || [],
    ferias: state.ferias || {},
    abonos: state.abonos || {},
    balcaoAtendimentos: state.balcaoAtendimentos || {},
    faq: state.faq || [],
    config: configSemLanc,
    gasUrl: state.gasUrl || ""
  };

  // fila
  const fila: any = state.filaAvulsa || {};
  const { listas = {}, ...filaResto } = fila;
  const ordem = Object.keys(listas);
  slots["fila_root"] = { ...filaResto, _ordem: ordem };
  ordem.forEach(nome => {
    const { fila: itens, ...resto } = listas[nome] || {};
    const arr: any[] = Array.isArray(itens) ? itens : [];
    const h = hashName(nome);
    const pedacos = chunk(arr, FILA_CHUNK);
    slots[`filameta__${h}`] = { ...resto, _nome: nome, _chunks: pedacos.length, _temFila: Array.isArray(itens) };
    pedacos.forEach((items, n) => (slots[`fila__${h}__${n}`] = items));
  });

  // servidores
  chunk(state.servidores || [], SERV_CHUNK).forEach((items, n) => (slots[`serv__${n}`] = items));

  // histórico: dias inteiros, mais recentes primeiro, até ~2000 registros
  const porDia = new Map<string, any[]>();
  (state.historico || []).forEach(item => {
    const k = dayKey(item?.ts);
    if (!porDia.has(k)) porDia.set(k, []);
    porDia.get(k)!.push(item);
  });
  const dias = Array.from(porDia.keys()).filter(d => d !== "sem-data").sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  let total = 0;
  for (const d of dias) {
    const items = porDia.get(d)!;
    if (total > 0 && total + items.length > HIST_MAX_ENTRIES) break;
    slots[`hist__${d}`] = items;
    total += items.length;
  }
  if (porDia.has("sem-data")) slots["hist__sem-data"] = porDia.get("sem-data");

  // produtividade por mês
  Object.entries<any>(state.produtividade || {}).forEach(([k, v]) => {
    const mes = /^\d{4}-\d{2}/.test(k) ? k.slice(0, 7) : "outros";
    (slots[`prod__${mes}`] = slots[`prod__${mes}`] || {})[k] = v;
  });

  // lançamentos anteriores (uma cópia só)
  chunk(lanc, LANC_CHUNK).forEach((items, n) => (slots[`lanc__${n}`] = items));
  slots["global"]._lancCount = lanc.length;

  return slots;
}

/**
 * Reconstrói o estado a partir dos slots (conteúdos já lidos).
 * Retorna null se faltar algum slot essencial (não aplica nada pela metade).
 */
export function slotsToState(slots: SlotMap): Partial<AppState> | null {
  const g = slots["global"];
  const root = slots["fila_root"];
  if (!g || !root) return null;

  // fila
  const { _ordem = [], ...filaResto } = root;
  const nomesMeta = new Map<string, any>();
  Object.keys(slots).filter(s => s.startsWith("filameta__")).forEach(s => {
    const meta = slots[s];
    if (meta && typeof meta._nome === "string") nomesMeta.set(meta._nome, { slot: s, meta });
  });
  const ordem: string[] = [..._ordem.filter((n: string) => nomesMeta.has(n))];
  nomesMeta.forEach((_v, nome) => { if (!ordem.includes(nome)) ordem.push(nome); });
  const listas: Record<string, any> = {};
  for (const nome of ordem) {
    const { meta } = nomesMeta.get(nome);
    const { _nome, _chunks, _temFila, ...resto } = meta;
    const h = hashName(nome);
    const itens: any[] = [];
    for (let n = 0; n < (Number(_chunks) || 0); n++) {
      const part = slots[`fila__${h}__${n}`];
      if (!Array.isArray(part)) return null; // pedaço faltando
      itens.push(...part);
    }
    listas[nome] = _temFila === false && itens.length === 0 ? { ...resto } : { ...resto, fila: itens };
  }
  const filaAvulsa = { ...filaResto, listas };

  const ordNum = (prefix: string) =>
    Object.keys(slots).filter(s => s.startsWith(prefix)).sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));

  const servidores: any[] = [];
  ordNum("serv__").forEach(s => servidores.push(...(slots[s] || [])));

  const histSlots = Object.keys(slots).filter(s => s.startsWith("hist__") && s !== "hist__sem-data")
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (slots["hist__sem-data"]) histSlots.push("hist__sem-data");
  const historico: any[] = [];
  histSlots.forEach(s => historico.push(...(slots[s] || [])));

  const produtividade: Record<string, any> = {};
  Object.keys(slots).filter(s => s.startsWith("prod__")).forEach(s => Object.assign(produtividade, slots[s] || {}));

  const lanc: any[] = [];
  ordNum("lanc__").forEach(s => lanc.push(...(slots[s] || [])));

  const { _lancCount, ...globalState } = g;
  const temLanc = _lancCount !== undefined || lanc.length > 0;
  const config = { ...(globalState.config || {}) };
  if (temLanc) config.lancamentosAnteriores = lanc;

  const result: any = { ...globalState, config, filaAvulsa, servidores, historico, produtividade };
  if (temLanc) result.lancamentosAnteriores = lanc;
  return result as Partial<AppState>;
}

/**
 * Combina 3 índices (slot -> docId) por grupo:
 *  - base:    o que este computador tinha carregado/aplicado
 *  - fresh:   o que está na nuvem agora
 *  - desired: o que este computador quer gravar
 * Para cada grupo: se este computador não mudou o grupo (desired == base), mantém o da nuvem
 * (preserva alterações feitas por outros); senão, o deste computador vence.
 */
export function mergeSlotIndex(
  base: Record<string, string>,
  fresh: Record<string, string>,
  desired: Record<string, string>,
  force: boolean
): Record<string, string> {
  if (force) return { ...desired };
  const groups = new Set<string>();
  [base, fresh, desired].forEach(m => Object.keys(m).forEach(s => groups.add(slotGroup(s))));
  const pick = (m: Record<string, string>, g: string) => {
    const out: Record<string, string> = {};
    Object.entries(m).forEach(([s, id]) => { if (slotGroup(s) === g) out[s] = id; });
    return out;
  };
  const same = (a: Record<string, string>, b: Record<string, string>) => {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  };
  const result: Record<string, string> = {};
  groups.forEach(g => {
    const b = pick(base, g), f = pick(fresh, g), d = pick(desired, g);
    Object.assign(result, same(d, b) ? f : d);
  });
  return result;
}

/** Grupos cujo mapeamento difere entre dois índices. */
export function changedGroups(a: Record<string, string>, b: Record<string, string>): Set<string> {
  const out = new Set<string>();
  const slots = new Set([...Object.keys(a), ...Object.keys(b)]);
  slots.forEach(s => { if (a[s] !== b[s]) out.add(slotGroup(s)); });
  return out;
}
