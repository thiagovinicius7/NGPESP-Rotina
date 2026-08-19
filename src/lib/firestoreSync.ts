import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeFirestore, 
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

// Initialize Firestore with long-polling autodetection and undefined property handling
let dbInstance: any = null;
try {
  dbInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true
  });
} catch (_) {
  dbInstance = getFirestore(app);
}

export const db = dbInstance;

const FIRESTORE_COLL = "ngpesp_sync";
const DOC_STATE = "global_state";
const DOC_FILA = "fila_avulsa";
const DOC_SERVIDORES = "servidores";
const DOC_HISTORICO = "historico";
const DOC_PRODUTIVIDADE = "produtividade";

let isWritingToCloud = false;
let lastPushedTimestamp = 0;

/**
 * Timeout helper to prevent any cloud promise from hanging indefinitely
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
 * Deep cleaner to remove undefined values and ensure JSON-serializable structure
 */
function cleanPayload<T>(obj: T): T {
  if (!obj) return obj;
  try {
    return JSON.parse(JSON.stringify(obj, (_, value) => {
      if (value === undefined) return null;
      return value;
    }));
  } catch (_) {
    return obj;
  }
}

/**
 * Loads the entire state across split documents from Firestore.
 */
export async function fetchFirestoreState(): Promise<{ state: Partial<AppState>; updatedAt: number } | null> {
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
      12000,
      "Tempo limite ao carregar dados da nuvem (12s). Verifique sua conexão."
    );

    const stateExists = stateSnap.exists();
    const filaExists = filaSnap.exists();
    const servExists = servidoresSnap.exists();
    const histExists = histSnap.exists();
    const prodExists = prodSnap.exists();

    if (!stateExists && !filaExists && !servExists && !histExists && !prodExists) {
      console.log("Firestore is currently empty (no documents found)");
      return null;
    }

    const stateData = stateExists ? stateSnap.data() : {};
    const filaData = filaExists ? filaSnap.data() : {};
    const servData = servExists ? servidoresSnap.data() : {};
    const histData = histExists ? histSnap.data() : {};
    const prodData = prodExists ? prodSnap.data() : {};

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

    console.log("Successfully fetched state from Firestore:", {
      servidoresCount: partialState.servidores?.length || 0,
      historicoCount: partialState.historico?.length || 0,
      hasFila: Boolean(partialState.filaAvulsa)
    });

    return { state: partialState, updatedAt: updatedAt || Date.now() };
  } catch (err) {
    console.error("Firestore fetch error:", err);
    throw err;
  }
}

/**
 * Pushes the full state and split documents to Firestore safely with timeout protection.
 */
export async function pushStateToFirestore(state: AppState): Promise<boolean> {
  if (!state) return false;
  try {
    isWritingToCloud = true;
    const now = Date.now();
    lastPushedTimestamp = now;

    const filaPayload = cleanPayload({
      filaAvulsa: state.filaAvulsa || {},
      updatedAt: now
    });

    const servPayload = cleanPayload({
      servidores: state.servidores || [],
      updatedAt: now
    });

    const histPayload = cleanPayload({
      historico: (state.historico || []).slice(0, 1000), // Keep the latest 1000 logs for high speed
      updatedAt: now
    });

    const prodPayload = cleanPayload({
      produtividade: state.produtividade || {},
      updatedAt: now
    });

    const globalPayload = cleanPayload({
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
    });

    const writes = [
      setDoc(doc(db, FIRESTORE_COLL, DOC_FILA), filaPayload, { merge: true }),
      setDoc(doc(db, FIRESTORE_COLL, DOC_SERVIDORES), servPayload, { merge: true }),
      setDoc(doc(db, FIRESTORE_COLL, DOC_HISTORICO), histPayload, { merge: true }),
      setDoc(doc(db, FIRESTORE_COLL, DOC_PRODUTIVIDADE), prodPayload, { merge: true }),
      setDoc(doc(db, FIRESTORE_COLL, DOC_STATE), globalPayload, { merge: true })
    ];

    await withTimeout(
      Promise.all(writes),
      15000,
      "Tempo limite ao enviar dados para a nuvem Firestore (15s). Verifique sua conexão à internet."
    );

    setTimeout(() => {
      isWritingToCloud = false;
    }, 1000);

    console.log("Successfully pushed full state to Firestore at", new Date(now).toISOString());
    return true;
  } catch (err) {
    console.error("Firestore push error:", err);
    isWritingToCloud = false;
    throw err;
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
          const data = snapshot.data();
          if (data && data.filaAvulsa) {
            const updatedAt = Number(data.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ filaAvulsa: data.filaAvulsa }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Fila subscription error:", error);
      }
    );
    unsubs.push(unsubFila);

    // 2. Listen to Servidores in real time
    const unsubServ = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_SERVIDORES),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.servidores) {
            const updatedAt = Number(data.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ servidores: data.servidores }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Servidores subscription error:", error);
      }
    );
    unsubs.push(unsubServ);

    // 3. Listen to Produtividade in real time
    const unsubProd = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_PRODUTIVIDADE),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.produtividade) {
            const updatedAt = Number(data.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate({ produtividade: data.produtividade }, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore Produtividade subscription error:", error);
      }
    );
    unsubs.push(unsubProd);

    // 4. Listen to Global State in real time
    const unsubState = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_STATE),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.state) {
            const updatedAt = Number(data.updatedAt || 0);
            if (updatedAt && Math.abs(updatedAt - lastPushedTimestamp) < 500 && isWritingToCloud) {
              return;
            }
            onUpdate(data.state, updatedAt);
          }
        }
      },
      (error) => {
        console.warn("Firestore State subscription error:", error);
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
