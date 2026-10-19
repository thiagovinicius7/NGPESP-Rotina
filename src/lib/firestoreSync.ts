import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  Unsubscribe 
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { AppState } from "../types.js";

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const dbId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

export const db = (firebaseConfig as any).firestoreDatabaseId 
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId) 
  : getFirestore(app);

const FIRESTORE_COLL = "ngpesp_sync";
const DOC_STATE = "global_state";
const DOC_FILA = "fila_avulsa";
const DOC_SERVIDORES = "servidores";
const DOC_HISTORICO = "historico";
const DOC_PRODUTIVIDADE = "produtividade";

let isWritingToCloud = false;
let lastPushedTimestamp = 0;

/**
 * ECONOMIA DE COTA
 * Guarda a "assinatura" (JSON) do último conteúdo gravado/lido de cada documento.
 * Só regravamos um documento quando o conteúdo dele realmente mudou.
 * (Antes, cada alteração regravava os 5 documentos, ~1,5 MB por salvamento.)
 */
const lastSyncedSig: Record<string, string> = {};

function rememberSig(docId: string, content: any) {
  try {
    lastSyncedSig[docId] = JSON.stringify(content);
  } catch (_) {}
}

/**
 * Os "lançamentos anteriores" existiam em dobro dentro do global_state
 * (state.lancamentosAnteriores e state.config.lancamentosAnteriores, idênticos).
 * Na nuvem gravamos só uma cópia; ao ler, recriamos a cópia em config para que
 * o app continue funcionando exatamente como antes.
 */
function hydrateGlobalState(st: any): any {
  if (!st || typeof st !== "object") return st;
  const top = st.lancamentosAnteriores;
  // A cópia principal (fora de config) é sempre a que vale ao ler da nuvem.
  // Isso evita que uma aba antiga, com uma cópia desatualizada em config, se sobreponha.
  if (Array.isArray(top) && st.config && typeof st.config === "object") {
    return { ...st, config: { ...st.config, lancamentosAnteriores: top } };
  }
  return st;
}

/** Monta o conteúdo (sem updatedAt) de cada documento a partir do estado do app. */
function buildDocContents(state: AppState): Record<string, any> {
  // Mesma prioridade usada pela tela de Relatórios (o que o usuário está vendo)
  const lancamentos = state.config?.lancamentosAnteriores || state.lancamentosAnteriores || [];
  const { lancamentosAnteriores: _dup, ...configSemDuplicata } = (state.config || {}) as any;
  return {
    [DOC_FILA]: { filaAvulsa: state.filaAvulsa || {} },
    [DOC_SERVIDORES]: { servidores: state.servidores || [] },
    [DOC_HISTORICO]: { historico: (state.historico || []).slice(0, 1000) },
    [DOC_PRODUTIVIDADE]: { produtividade: state.produtividade || {} },
    [DOC_STATE]: {
      state: {
        respostas: state.respostas || [],
        codigos: state.codigos || [],
        sei: state.sei || [],
        afastamentos: state.afastamentos || [],
        ferias: state.ferias || {},
        abonos: state.abonos || {},
        balcaoAtendimentos: state.balcaoAtendimentos || {},
        faq: state.faq || [],
        config: configSemDuplicata,
        lancamentosAnteriores: lancamentos,
        gasUrl: state.gasUrl || ""
      }
    }
  };
}

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

/**
 * REST API Write: Ultra-fast, bypasses gRPC/WebChannel connection stalls
 */
async function writeDocViaRest(docId: string, data: any, timestamp: number): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/${FIRESTORE_COLL}/${docId}?key=${firebaseConfig.apiKey}`;
    const jsonStr = JSON.stringify(data);
    const body = {
      fields: {
        json: { stringValue: jsonStr },
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
      console.warn("Firestore daily write quota reached on free tier. Using container backend persistence.");
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

/**
 * REST API Read: Ultra-fast fallback
 */
async function readDocViaRest(docId: string): Promise<{ data: any; updatedAt: number } | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/${FIRESTORE_COLL}/${docId}?key=${firebaseConfig.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.fields?.json?.stringValue) {
      const parsed = JSON.parse(json.fields.json.stringValue);
      const updatedAt = Number(json.fields.updatedAt?.integerValue || Date.now());
      return { data: parsed, updatedAt };
    }
    return null;
  } catch (e) {
    console.warn(`REST read error for ${docId}:`, e);
    return null;
  }
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
 * Loads the entire state across split documents from Firestore with REST fallback
 */
export async function fetchFirestoreState(): Promise<{ state: Partial<AppState>; updatedAt: number } | null> {
  // Strategy 1: Fast REST API fetch in parallel (works 100% reliably in any environment)
  try {
    const restPromises = [
      readDocViaRest(DOC_STATE),
      readDocViaRest(DOC_FILA),
      readDocViaRest(DOC_SERVIDORES),
      readDocViaRest(DOC_HISTORICO),
      readDocViaRest(DOC_PRODUTIVIDADE)
    ];

    const [stateRest, filaRest, servRest, histRest, prodRest] = await withTimeout(
      Promise.all(restPromises),
      6000,
      "REST fetch timeout"
    );

    const hasAnyRest = stateRest || filaRest || servRest || histRest || prodRest;
    if (hasAnyRest) {
      if (stateRest?.data?.state) rememberSig(DOC_STATE, { state: stateRest.data.state });
      if (filaRest?.data?.filaAvulsa) rememberSig(DOC_FILA, { filaAvulsa: filaRest.data.filaAvulsa });
      if (servRest?.data?.servidores) rememberSig(DOC_SERVIDORES, { servidores: servRest.data.servidores });
      if (histRest?.data?.historico) rememberSig(DOC_HISTORICO, { historico: histRest.data.historico });
      if (prodRest?.data?.produtividade) rememberSig(DOC_PRODUTIVIDADE, { produtividade: prodRest.data.produtividade });

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

      console.log("Successfully fetched state via REST:", {
        servidoresCount: partialState.servidores?.length || 0,
        historicoCount: partialState.historico?.length || 0,
        hasFila: Boolean(partialState.filaAvulsa)
      });

      return { state: partialState, updatedAt: maxTime || Date.now() };
    }
  } catch (restErr) {
    console.warn("REST fetch fallback to SDK:", restErr);
  }

  // Strategy 2: Firestore SDK getDoc
  try {
    const fetchPromises = [
      getDoc(doc(db, FIRESTORE_COLL, DOC_STATE)),
      getDoc(doc(db, FIRESTORE_COLL, DOC_FILA)),
      getDoc(doc(db, FIRESTORE_COLL, DOC_SERVIDORES)),
      getDoc(doc(db, FIRESTORE_COLL, DOC_HISTORICO)),
      getDoc(doc(db, FIRESTORE_COLL, DOC_PRODUTIVIDADE))
    ];

    const [stateSnap, filaSnap, servidoresSnap, histSnap, prodSnap] = await withTimeout(
      Promise.all(fetchPromises),
      7000,
      "Tempo limite ao carregar dados da nuvem."
    );

    const stateExists = stateSnap.exists();
    const filaExists = filaSnap.exists();
    const servExists = servidoresSnap.exists();
    const histExists = histSnap.exists();
    const prodExists = prodSnap.exists();

    if (!stateExists && !filaExists && !servExists && !histExists && !prodExists) {
      return null;
    }

    const stateData = stateExists ? parseDocData(stateSnap.data()) : {};
    const filaData = filaExists ? parseDocData(filaSnap.data()) : {};
    const servData = servExists ? parseDocData(servidoresSnap.data()) : {};
    const histData = histExists ? parseDocData(histSnap.data()) : {};
    const prodData = prodExists ? parseDocData(prodSnap.data()) : {};

    if (stateData.state) rememberSig(DOC_STATE, { state: stateData.state });
    if (filaData.filaAvulsa) rememberSig(DOC_FILA, { filaAvulsa: filaData.filaAvulsa });
    if (servData.servidores) rememberSig(DOC_SERVIDORES, { servidores: servData.servidores });
    if (histData.historico) rememberSig(DOC_HISTORICO, { historico: histData.historico });
    if (prodData.produtividade) rememberSig(DOC_PRODUTIVIDADE, { produtividade: prodData.produtividade });

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
  } catch (err) {
    console.error("Firestore fetch error:", err);
    throw err;
  }
}

/**
 * Envia o estado para o Firestore, gravando SOMENTE os documentos cujo conteúdo mudou.
 * Use force = true para regravar tudo (ex.: "Salvar Este Computador na Nuvem Agora").
 */
export async function pushStateToFirestore(state: AppState, force: boolean = false): Promise<boolean> {
  if (!state) return false;

  const contents = buildDocContents(state);
  const changed: { docId: string; content: any; sig: string }[] = [];
  for (const [docId, content] of Object.entries(contents)) {
    const sig = JSON.stringify(content);
    if (force || lastSyncedSig[docId] !== sig) {
      changed.push({ docId, content, sig });
    }
  }

  // Nada mudou: não gasta cota
  if (changed.length === 0) {
    return true;
  }

  isWritingToCloud = true;
  const now = Date.now();
  lastPushedTimestamp = now;

  try {
    const results = await Promise.all(
      changed.map(async ({ docId, content, sig }) => {
        const ok = await writeDocViaRest(docId, { ...content, updatedAt: now }, now);
        if (ok) lastSyncedSig[docId] = sig; // se falhar, tenta de novo no próximo salvamento
        return ok;
      })
    );

    isWritingToCloud = false;
    const anyOk = results.some(r => r === true);
    if (anyOk) {
      console.log(
        `Nuvem atualizada (${changed.map(c => c.docId).join(", ")}) em`,
        new Date(now).toISOString()
      );
    }
    return anyOk;
  } catch (e) {
    console.warn("Cloud push error:", e);
    isWritingToCloud = false;
    return false;
  }
}

/**
 * Subscribes to real-time updates from Firestore across all devices.
 */
export function subscribeToFirestore(
  onUpdate: (partial: Partial<AppState>, updatedAt: number) => void
): () => void {
  const unsubs: Unsubscribe[] = [];

  try {
    // 1. Listen to Fila Avulsa in real time
    const unsubFila = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_FILA),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.filaAvulsa) {
            rememberSig(DOC_FILA, { filaAvulsa: data.filaAvulsa });
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ filaAvulsa: data.filaAvulsa }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Fila subscription notice:", error);
      }
    );
    unsubs.push(unsubFila);

    // 2. Listen to Servidores in real time
    const unsubServ = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_SERVIDORES),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.servidores) {
            rememberSig(DOC_SERVIDORES, { servidores: data.servidores });
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ servidores: data.servidores }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Servidores subscription notice:", error);
      }
    );
    unsubs.push(unsubServ);

    // 3. Listen to Produtividade in real time
    const unsubProd = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_PRODUTIVIDADE),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.produtividade) {
            rememberSig(DOC_PRODUTIVIDADE, { produtividade: data.produtividade });
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ produtividade: data.produtividade }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Produtividade subscription notice:", error);
      }
    );
    unsubs.push(unsubProd);

    // 4. Listen to Historico in real time
    const unsubHist = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_HISTORICO),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.historico) {
            rememberSig(DOC_HISTORICO, { historico: data.historico });
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ historico: data.historico }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Historico subscription notice:", error);
      }
    );
    unsubs.push(unsubHist);

    // 5. Listen to Global State in real time
    const unsubState = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_STATE),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.state) {
            rememberSig(DOC_STATE, { state: data.state });
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate(hydrateGlobalState(data.state), updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore State subscription notice:", error);
      }
    );
    unsubs.push(unsubState);
  } catch (err) {
    console.warn("Could not start Firestore listeners:", err);
  }

  return () => {
    unsubs.forEach(unsub => {
      try {
        unsub();
      } catch (_) {}
    });
  };
}
