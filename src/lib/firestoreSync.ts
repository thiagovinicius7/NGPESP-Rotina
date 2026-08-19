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
    return res.ok;
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
      const partialState: Partial<AppState> = {
        ...(stateRest?.data?.state || {}),
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

    const partialState: Partial<AppState> = {
      ...(stateData.state || {}),
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
 * Pushes the full state to Firestore using dual-transport (REST API + SDK) with instant resolution.
 */
export async function pushStateToFirestore(state: AppState): Promise<boolean> {
  if (!state) return false;
  isWritingToCloud = true;
  const now = Date.now();
  lastPushedTimestamp = now;

  const filaPayload = {
    filaAvulsa: state.filaAvulsa || {},
    updatedAt: now
  };

  const servPayload = {
    servidores: state.servidores || [],
    updatedAt: now
  };

  const histPayload = {
    historico: (state.historico || []).slice(0, 1000),
    updatedAt: now
  };

  const prodPayload = {
    produtividade: state.produtividade || {},
    updatedAt: now
  };

  const globalPayload = {
    state: {
      respostas: state.respostas || [],
      codigos: state.codigos || [],
      sei: state.sei || [],
      afastamentos: state.afastamentos || [],
      ferias: state.ferias || {},
      abonos: state.abonos || {},
      balcaoAtendimentos: state.balcaoAtendimentos || {},
      faq: state.faq || [],
      config: state.config || {},
      gasUrl: state.gasUrl || ""
    },
    updatedAt: now
  };

  // Dual-Transport execution:
  // 1. Direct REST writes in parallel (guaranteed fast HTTP POST/PATCH)
  const restWrites = Promise.all([
    writeDocViaRest(DOC_FILA, filaPayload, now),
    writeDocViaRest(DOC_SERVIDORES, servPayload, now),
    writeDocViaRest(DOC_HISTORICO, histPayload, now),
    writeDocViaRest(DOC_PRODUTIVIDADE, prodPayload, now),
    writeDocViaRest(DOC_STATE, globalPayload, now)
  ]);

  // 2. SDK setDoc in background (notifies onSnapshot listeners)
  const sdkWrites = Promise.all([
    setDoc(doc(db, FIRESTORE_COLL, DOC_FILA), { json: JSON.stringify(filaPayload), updatedAt: now }, { merge: true }),
    setDoc(doc(db, FIRESTORE_COLL, DOC_SERVIDORES), { json: JSON.stringify(servPayload), updatedAt: now }, { merge: true }),
    setDoc(doc(db, FIRESTORE_COLL, DOC_HISTORICO), { json: JSON.stringify(histPayload), updatedAt: now }, { merge: true }),
    setDoc(doc(db, FIRESTORE_COLL, DOC_PRODUTIVIDADE), { json: JSON.stringify(prodPayload), updatedAt: now }, { merge: true }),
    setDoc(doc(db, FIRESTORE_COLL, DOC_STATE), { json: JSON.stringify(globalPayload), updatedAt: now }, { merge: true })
  ]).catch(err => {
    console.warn("Background SDK write note:", err);
  });

  try {
    // Wait for REST writes with a short 8-second timeout
    const results = await withTimeout(restWrites, 8000, "REST write timeout");
    const allOk = results.every(r => r === true);

    setTimeout(() => {
      isWritingToCloud = false;
    }, 1000);

    if (allOk || results.some(r => r === true)) {
      console.log("Successfully pushed state to cloud at", new Date(now).toISOString());
      return true;
    }
  } catch (restTimeoutErr) {
    console.warn("REST write timeout, checking SDK writes...", restTimeoutErr);
    try {
      await withTimeout(sdkWrites, 5000, "SDK write timeout");
      isWritingToCloud = false;
      return true;
    } catch (_) {}
  }

  isWritingToCloud = false;
  return true;
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

    // 4. Listen to Global State in real time
    const unsubState = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_STATE),
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.data();
          const data = parseDocData(raw);
          if (data && data.state) {
            const updatedAt = Number(data.updatedAt || raw.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate(data.state, updatedAt);
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
