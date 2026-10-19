import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, onSnapshot } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { AppState } from "../types.js";
import {
  stateToSlots, slotsToState, slotDocId, mergeSlotIndex, changedGroups, groupFields, V2_VERSION, SlotMap
} from "./chunkedStore";
import { mergeHistorico, mergeProdutividade, mergeFilaAvulsa } from "./utils";

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const dbId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

export const db = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

/**
 * v1 (formato antigo): 5 documentos grandes em "ngpesp_sync".
 * NÃO é mais gravado. É lido para converter para o v2 e para recuperar
 * alterações de abas que ainda estejam com a versão antiga aberta.
 * Os documentos antigos ficam intactos como cópia de segurança.
 */
const V1_COLL = "ngpesp_sync";
const DOC_STATE = "global_state";
const DOC_FILA = "fila_avulsa";
const DOC_SERVIDORES = "servidores";
const DOC_HISTORICO = "historico";
const DOC_PRODUTIVIDADE = "produtividade";
const V1_DOCS = [DOC_STATE, DOC_FILA, DOC_SERVIDORES, DOC_HISTORICO, DOC_PRODUTIVIDADE];

/** v2 (formato novo): documentos pequenos e imutáveis em "ngpesp_v2" + índice (ver chunkedStore.ts). */
const V2_COLL = "ngpesp_v2";
const V2_INDEX_ID = "_index";
/** Documentos antigos só são apagados depois de 10 min fora do índice. */
const GC_DELAY_MS = 10 * 60 * 1000;

const REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents`;

interface V2Index {
  version: number;
  writer: string;
  slots: Record<string, string>; // slot -> docId
  garbage: { id: string; ts: number }[];
  v1Seen: number; // maior updatedAt do v1 já incorporado
  updatedAt: number;
}

/** Identifica esta aba (para depuração). */
const WRITER_ID = Math.random().toString(36).slice(2, 10);
/** Documentos v2 já lidos (imutáveis: o id muda quando o conteúdo muda). */
const chunkCache = new Map<string, any>();
/** Índice que corresponde ao estado local deste computador. */
let baseSlots: Record<string, string> = {};
/** Maior updatedAt do v1 já incorporado. */
let v1SeenAt = 0;
/** Evita dois envios simultâneos desta aba. */
let pushChain: Promise<any> = Promise.resolve();

/** true quando foi detectada uma aba com a versão antiga gravando no formato antigo. */
export let oldVersionDetected = false;

/**
 * Timeout helper
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMsg));
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export let firestoreQuotaExceeded = false;

/** Lê o campo "json" de um documento REST do Firestore. */
function parseRestDoc(json: any): { data: any; updatedAt: number } | null {
  if (json?.fields?.json?.stringValue) {
    const parsed = JSON.parse(json.fields.json.stringValue);
    const updatedAt = Number(json.fields.updatedAt?.integerValue || 0);
    return { data: parsed, updatedAt };
  }
  return null;
}

/**
 * REST API Write
 */
async function writeDocViaRest(coll: string, docId: string, data: any, timestamp: number): Promise<boolean> {
  try {
    const url = `${REST_BASE}/${coll}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`;
    const body = {
      fields: {
        json: { stringValue: JSON.stringify(data) },
        updatedAt: { integerValue: String(timestamp) }
      }
    };
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.status === 429) {
      firestoreQuotaExceeded = true;
      console.warn("Firestore: limite diário de gravações atingido.");
      return false;
    }
    if (res.ok) {
      firestoreQuotaExceeded = false;
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`REST write error for ${docId}:`, e);
    return false;
  }
}

async function deleteDocViaRest(coll: string, docId: string): Promise<boolean> {
  try {
    const url = `${REST_BASE}/${coll}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`;
    const res = await fetch(url, { method: "DELETE" });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/**
 * REST API Read (v1)
 */
async function readDocViaRest(docId: string): Promise<{ data: any; updatedAt: number } | null> {
  try {
    const url = `${REST_BASE}/${V1_COLL}/${docId}?key=${firebaseConfig.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed = parseRestDoc(await res.json());
    if (parsed && !parsed.updatedAt) parsed.updatedAt = Date.now();
    return parsed;
  } catch (e) {
    console.warn(`REST read error for ${docId}:`, e);
    return null;
  }
}

/** Lê só o updatedAt de um documento v1 (download mínimo). */
async function readV1UpdatedAt(docId: string): Promise<number> {
  try {
    const url = `${REST_BASE}/${V1_COLL}/${docId}?mask.fieldPaths=updatedAt&key=${firebaseConfig.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const json = await res.json();
    return Number(json?.fields?.updatedAt?.integerValue || 0);
  } catch (_) {
    return 0;
  }
}

async function readV1MaxUpdatedAt(): Promise<number> {
  const times = await Promise.all(V1_DOCS.map(readV1UpdatedAt));
  return Math.max(0, ...times);
}

/** Lê um documento v2. undefined = não existe; null = erro de leitura. */
async function getV2Doc(docId: string): Promise<{ data: any; updatedAt: number } | undefined | null> {
  try {
    const url = `${REST_BASE}/${V2_COLL}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`;
    const res = await fetch(url);
    if (res.status === 404) return undefined;
    if (!res.ok) return null;
    return parseRestDoc(await res.json());
  } catch (e) {
    console.warn(`REST read v2 error for ${docId}:`, e);
    return null;
  }
}

async function readIndex(): Promise<V2Index | undefined | null> {
  const r = await getV2Doc(V2_INDEX_ID);
  if (r === undefined) return undefined;
  if (r === null) return null;
  const idx = r.data;
  if (!idx || typeof idx.slots !== "object") return null;
  return {
    version: Number(idx.version || V2_VERSION),
    writer: String(idx.writer || ""),
    slots: idx.slots || {},
    garbage: Array.isArray(idx.garbage) ? idx.garbage : [],
    v1Seen: Number(idx.v1Seen || 0),
    updatedAt: Number(idx.updatedAt || r.updatedAt || 0)
  };
}

/** Lê (com cache) o conteúdo de todos os documentos de um índice. null se algum faltar. */
async function loadSlots(slots: Record<string, string>): Promise<SlotMap | null> {
  const entries = Object.entries(slots);
  const missing = entries.filter(([, id]) => !chunkCache.has(id));
  const results = await Promise.all(missing.map(([, id]) => getV2Doc(id)));
  for (let i = 0; i < missing.length; i++) {
    const r = results[i];
    if (!r) return null; // não existe ou erro: não monta pela metade
    chunkCache.set(missing[i][1], r.data?.c);
  }
  const out: SlotMap = {};
  entries.forEach(([slot, id]) => (out[slot] = chunkCache.get(id)));
  return out;
}

/**
 * Helper to parse a document whether stored as structured fields or as a JSON string
 */
function parseDocData(data: any): any {
  if (!data) return null;
  if (data.json && typeof data.json === "string") {
    try {
      return JSON.parse(data.json);
    } catch (_) {
      return data;
    }
  }
  return data;
}

/**
 * No v1 os "lançamentos anteriores" existiam em dobro (state.lancamentosAnteriores e
 * state.config.lancamentosAnteriores). A cópia principal (fora de config) é a que vale.
 */
function hydrateGlobalState(st: any): any {
  if (!st || typeof st !== "object") return st;
  const top = st.lancamentosAnteriores;
  if (Array.isArray(top) && st.config && typeof st.config === "object") {
    return { ...st, config: { ...st.config, lancamentosAnteriores: top } };
  }
  return st;
}

/**
 * Lê o formato antigo (v1). Usado só quando ainda não existe v2 na nuvem.
 */
async function fetchV1State(): Promise<{ state: Partial<AppState>; updatedAt: number } | null> {
  // Strategy 1: REST
  try {
    const [stateRest, filaRest, servRest, histRest, prodRest] = await withTimeout(
      Promise.all([
        readDocViaRest(DOC_STATE),
        readDocViaRest(DOC_FILA),
        readDocViaRest(DOC_SERVIDORES),
        readDocViaRest(DOC_HISTORICO),
        readDocViaRest(DOC_PRODUTIVIDADE)
      ]),
      6000,
      "REST fetch timeout"
    );

    if (stateRest || filaRest || servRest || histRest || prodRest) {
      const partialState: Partial<AppState> = {
        ...(hydrateGlobalState(stateRest?.data?.state) || {}),
        ...(filaRest?.data?.filaAvulsa ? { filaAvulsa: filaRest.data.filaAvulsa } : {}),
        ...(servRest?.data?.servidores ? { servidores: servRest.data.servidores } : {}),
        ...(histRest?.data?.historico ? { historico: histRest.data.historico } : {}),
        ...(prodRest?.data?.produtividade ? { produtividade: prodRest.data.produtividade } : {})
      };
      const maxTime = Math.max(
        stateRest?.updatedAt || 0,
        filaRest?.updatedAt || 0,
        servRest?.updatedAt || 0,
        histRest?.updatedAt || 0,
        prodRest?.updatedAt || 0
      );
      return { state: partialState, updatedAt: maxTime || Date.now() };
    }
  } catch (restErr) {
    console.warn("REST fetch fallback to SDK:", restErr);
  }

  // Strategy 2: SDK
  const [stateSnap, filaSnap, servidoresSnap, histSnap, prodSnap] = await withTimeout(
    Promise.all([
      getDoc(doc(db, V1_COLL, DOC_STATE)),
      getDoc(doc(db, V1_COLL, DOC_FILA)),
      getDoc(doc(db, V1_COLL, DOC_SERVIDORES)),
      getDoc(doc(db, V1_COLL, DOC_HISTORICO)),
      getDoc(doc(db, V1_COLL, DOC_PRODUTIVIDADE))
    ]),
    7000,
    "Tempo limite ao carregar dados da nuvem."
  );

  if (!stateSnap.exists() && !filaSnap.exists() && !servidoresSnap.exists() && !histSnap.exists() && !prodSnap.exists()) {
    return null;
  }

  const stateData = stateSnap.exists() ? parseDocData(stateSnap.data()) : {};
  const filaData = filaSnap.exists() ? parseDocData(filaSnap.data()) : {};
  const servData = servidoresSnap.exists() ? parseDocData(servidoresSnap.data()) : {};
  const histData = histSnap.exists() ? parseDocData(histSnap.data()) : {};
  const prodData = prodSnap.exists() ? parseDocData(prodSnap.data()) : {};

  const partialState: Partial<AppState> = {
    ...(hydrateGlobalState(stateData.state) || {}),
    ...(filaData.filaAvulsa ? { filaAvulsa: filaData.filaAvulsa } : {}),
    ...(servData.servidores ? { servidores: servData.servidores } : {}),
    ...(histData.historico ? { historico: histData.historico } : {}),
    ...(prodData.produtividade ? { produtividade: prodData.produtividade } : {})
  };

  const updatedAt = Math.max(
    Number(stateData.updatedAt || 0),
    Number(filaData.updatedAt || 0),
    Number(servData.updatedAt || 0),
    Number(histData.updatedAt || 0),
    Number(prodData.updatedAt || 0)
  );

  return { state: partialState, updatedAt: updatedAt || Date.now() };
}

/**
 * Recupera alterações gravadas no formato antigo por uma aba desatualizada
 * (histórico, produtividade e fila são mesclados sem perder nada).
 */
function mergeV1Into(state: Partial<AppState>, v1: Partial<AppState>): Partial<AppState> {
  return {
    ...state,
    historico: mergeHistorico(state.historico || [], v1.historico || []),
    produtividade: mergeProdutividade(state.produtividade || {}, v1.produtividade || {}),
    filaAvulsa: mergeFilaAvulsa(state.filaAvulsa, v1.filaAvulsa)
  };
}

/**
 * Carrega o estado da nuvem: formato novo (v2) se existir; senão o antigo (v1).
 */
export async function fetchFirestoreState(): Promise<{ state: Partial<AppState>; updatedAt: number } | null> {
  let index = await withTimeout(readIndex(), 8000, "timeout").catch(() => null);

  if (index === undefined) {
    console.log("Nuvem ainda no formato antigo (v1). Será convertida no próximo salvamento.");
    const [v1, v1Max] = await Promise.all([fetchV1State(), readV1MaxUpdatedAt()]);
    v1SeenAt = Math.max(v1SeenAt, v1Max);
    baseSlots = {};
    return v1;
  }

  let slots = index ? await loadSlots(index.slots) : null;
  if (!slots) {
    // Um documento pode ter sido trocado entre a leitura do índice e a dos pedaços: tenta de novo
    await new Promise(r => setTimeout(r, 1000));
    index = await withTimeout(readIndex(), 8000, "timeout").catch(() => null);
    slots = index ? await loadSlots(index.slots) : null;
  }
  let state = slots ? slotsToState(slots) : null;
  if (!index || !state) {
    throw new Error("Não foi possível carregar os dados da nuvem agora. Tente sincronizar novamente em instantes.");
  }

  baseSlots = { ...index.slots };
  v1SeenAt = Math.max(v1SeenAt, index.v1Seen);

  // Alguma aba com a versão antiga gravou depois da conversão?
  try {
    const v1Max = await readV1MaxUpdatedAt();
    if (v1Max > v1SeenAt) {
      const v1 = await fetchV1State();
      if (v1?.state) {
        state = mergeV1Into(state, v1.state);
        oldVersionDetected = true;
        console.warn("Alterações de uma aba com a versão antiga foram recuperadas.");
      }
      v1SeenAt = v1Max;
      baseSlots = {}; // força regravar os grupos alterados pela mescla no próximo envio
    }
  } catch (_) {}

  console.log("Estado carregado da nuvem (v2):", {
    servidores: state.servidores?.length || 0,
    historico: state.historico?.length || 0
  });
  return { state, updatedAt: index.updatedAt || Date.now() };
}

/**
 * Envia o estado para o Firestore (v2).
 * 1. Lê o índice atual da nuvem.
 * 2. Grava só os documentos novos (conteúdo que mudou).
 * 3. Grava o índice (por último, numa única escrita), preservando grupos que
 *    outros computadores alteraram e este não.
 * 4. Apaga documentos que saíram do índice há mais de 10 minutos.
 * Use force = true para que este computador vença em todos os grupos.
 */
export function pushStateToFirestore(state: AppState, force: boolean = false): Promise<boolean> {
  const run = pushChain.then(() => doPush(state, force)).catch(() => false);
  pushChain = run;
  return run;
}

async function doPush(state: AppState, force: boolean): Promise<boolean> {
  if (!state) return false;

  const slotContents = stateToSlots(state);
  const desired: Record<string, string> = {};
  Object.entries(slotContents).forEach(([slot, content]) => (desired[slot] = slotDocId(slot, content)));

  const fresh = await readIndex();
  if (fresh === null) return false; // erro de leitura: tenta depois
  const freshSlots = fresh ? fresh.slots : {};

  const merged = mergeSlotIndex(baseSlots, freshSlots, desired, force || !fresh);
  const sameAsFresh = fresh && JSON.stringify(Object.entries(merged).sort()) === JSON.stringify(Object.entries(freshSlots).sort());
  if (sameAsFresh && !force) {
    baseSlots = desired;
    return true; // nada mudou: não gasta cota
  }

  const now = Date.now();
  const referenced = new Set(Object.values(freshSlots));

  // 2. Documentos novos (os que o índice atual não cita)
  const toWrite = Object.entries(merged).filter(([slot, id]) => desired[slot] === id && (force || !referenced.has(id)));
  const results = await Promise.all(
    toWrite.map(async ([slot, id]) => {
      const ok = await writeDocViaRest(V2_COLL, id, { c: slotContents[slot] }, now);
      if (ok) chunkCache.set(id, slotContents[slot]);
      return ok;
    })
  );
  if (results.some(r => !r)) return false; // índice NÃO é gravado se faltar algum documento

  // 3. Índice
  const mergedIds = new Set(Object.values(merged));
  const garbage = (fresh?.garbage || []).filter(g => !mergedIds.has(g.id));
  Object.values(freshSlots).forEach(id => {
    if (!mergedIds.has(id) && !garbage.some(g => g.id === id)) garbage.push({ id, ts: now });
  });
  const expired = garbage.filter(g => now - g.ts > GC_DELAY_MS);
  const remaining = garbage.filter(g => now - g.ts <= GC_DELAY_MS);
  const newIndex: V2Index = {
    version: V2_VERSION,
    writer: WRITER_ID,
    slots: merged,
    garbage: remaining,
    v1Seen: Math.max(v1SeenAt, fresh?.v1Seen || 0),
    updatedAt: now
  };
  const okIndex = await writeDocViaRest(V2_COLL, V2_INDEX_ID, newIndex, now);
  if (!okIndex) return false;

  // O estado local corresponde ao que este computador quis gravar.
  // Grupos preservados de outros computadores chegam pelo listener.
  baseSlots = desired;
  v1SeenAt = newIndex.v1Seen;

  // 4. Limpeza (melhor esforço)
  await Promise.all(expired.map(async g => {
    await deleteDocViaRest(V2_COLL, g.id);
    chunkCache.delete(g.id);
  }));

  console.log(`Nuvem atualizada: ${toWrite.length} documento(s) + índice`);
  return true;
}

/**
 * Atualizações em tempo real (v2): escuta só o índice. Quando outro computador
 * grava, baixa apenas os documentos novos e aplica só os grupos que mudaram.
 * onUpdate deve retornar false se não aplicou (ex.: há edição local pendente).
 */
export function subscribeToFirestore(
  onUpdate: (partial: Partial<AppState>, updatedAt: number) => boolean | void
): () => void {
  let stopped = false;
  let latest: V2Index | null = null;
  let running = false;

  const process = async () => {
    if (running) return;
    running = true;
    try {
      while (latest && !stopped) {
        const idx = latest;
        latest = null;
        const groups = changedGroups(baseSlots, idx.slots);
        if (groups.size === 0) {
          continue;
        }
        const slots = await loadSlots(idx.slots);
        if (!slots || stopped) continue; // documento faltando: espera o próximo índice
        const full = slotsToState(slots);
        if (!full) continue;
        const fields = new Set<string>();
        groups.forEach(g => groupFields(g).forEach(f => fields.add(f)));
        const partial: any = {};
        fields.forEach(f => {
          if ((full as any)[f] !== undefined) partial[f] = (full as any)[f];
        });
        const applied = onUpdate(partial, idx.updatedAt);
        if (applied !== false) {
          baseSlots = { ...idx.slots };
        }
      }
    } finally {
      running = false;
    }
  };

  let unsub: () => void = () => {};
  try {
    unsub = onSnapshot(
      doc(db, V2_COLL, V2_INDEX_ID),
      (snapshot) => {
        if (!snapshot.exists()) return; // ainda no formato antigo
        const data = parseDocData(snapshot.data());
        if (!data || typeof data.slots !== "object") return;
        latest = {
          version: Number(data.version || V2_VERSION),
          writer: String(data.writer || ""),
          slots: data.slots,
          garbage: data.garbage || [],
          v1Seen: Number(data.v1Seen || 0),
          updatedAt: Number(data.updatedAt || 0)
        };
        process();
      },
      (error) => console.warn("Firestore subscription notice:", error)
    );
  } catch (err) {
    console.warn("Could not start Firestore listener:", err);
  }

  return () => {
    stopped = true;
    try { unsub(); } catch (_) {}
  };
}
