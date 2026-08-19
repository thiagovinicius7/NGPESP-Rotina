import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, Unsubscribe 
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { AppState } from "../types.js";

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);

const FIRESTORE_COLL = "ngpesp_sync";
const DOC_STATE = "global_state";
const DOC_FILA = "fila_avulsa";

let isWritingToCloud = false;
let lastPushedTimestamp = 0;

/**
 * Loads both global state and fila avulsa from Firestore.
 */
export async function fetchFirestoreState(): Promise<{ state: Partial<AppState>; updatedAt: number } | null> {
  try {
    const [stateSnap, filaSnap] = await Promise.all([
      getDoc(doc(db, FIRESTORE_COLL, DOC_STATE)),
      getDoc(doc(db, FIRESTORE_COLL, DOC_FILA))
    ]);

    if (!stateSnap.exists() && !filaSnap.exists()) {
      return null;
    }

    const stateData = stateSnap.exists() ? stateSnap.data() : {};
    const filaData = filaSnap.exists() ? filaSnap.data() : {};

    const partialState: Partial<AppState> = {
      ...(stateData.state || {}),
      ...(filaData.filaAvulsa ? { filaAvulsa: filaData.filaAvulsa } : {})
    };

    const updatedAt = Math.max(stateData.updatedAt || 0, filaData.updatedAt || 0);

    return { state: partialState, updatedAt };
  } catch (err) {
    console.warn("Firestore fetch error:", err);
    return null;
  }
}

/**
 * Pushes the full state and fila avulsa to Firestore.
 */
export async function pushStateToFirestore(state: AppState): Promise<boolean> {
  try {
    isWritingToCloud = true;
    const now = Date.now();
    lastPushedTimestamp = now;

    // 1. Separate fila avulsa to ensure high-priority instant queue sync
    const filaPayload = {
      filaAvulsa: state.filaAvulsa,
      updatedAt: now
    };

    // 2. Global state payload
    const globalPayload = {
      state: {
        servidores: state.servidores || [],
        historico: state.historico || [],
        respostas: state.respostas || [],
        codigos: state.codigos || [],
        sei: state.sei || [],
        afastamentos: state.afastamentos || [],
        ferias: state.ferias || {},
        abonos: state.abonos || {},
        produtividade: state.produtividade || {},
        balcaoAtendimentos: state.balcaoAtendimentos || {},
        faq: state.faq || [],
        config: state.config || {}
      },
      updatedAt: now
    };

    await Promise.all([
      setDoc(doc(db, FIRESTORE_COLL, DOC_FILA), filaPayload, { merge: true }),
      setDoc(doc(db, FIRESTORE_COLL, DOC_STATE), globalPayload, { merge: true })
    ]);

    setTimeout(() => {
      isWritingToCloud = false;
    }, 1000);

    return true;
  } catch (err) {
    console.warn("Firestore push error:", err);
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
  let unsubState: Unsubscribe | null = null;
  let unsubFila: Unsubscribe | null = null;

  try {
    // Listen to Fila Avulsa changes in real time
    unsubFila = onSnapshot(
      doc(db, FIRESTORE_COLL, DOC_FILA),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.filaAvulsa) {
            const updatedAt = Number(data.updatedAt || 0);
            // Ignore echo if we just pushed it
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

    // Listen to Global State changes in real time
    unsubState = onSnapshot(
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
  } catch (err) {
    console.warn("Could not start Firestore listeners:", err);
  }

  return () => {
    if (unsubFila) unsubFila();
    if (unsubState) unsubState();
  };
}
