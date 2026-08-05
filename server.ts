import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { AppState } from "./src/types.js";

const app = express();
const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "db.json");
const CONFIG_FILE = path.join(process.cwd(), "firebase-applet-config.json");

// Parse JSON bodies up to 50MB (to allow importing lists of servers comfortably)
app.use(express.json({ limit: "50mb" }));

// Initialize Firebase Firestore for cloud persistence if config exists
let firestoreDb: any = null;
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    const firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp);
    console.log("Firebase initialized successfully on server for cloud persistence.");
  } catch (err) {
    console.warn("Could not initialize Firebase on server:", err);
  }
}

// Default initial state
const defaultState: AppState = {
  servidores: [],
  historico: [],
  respostas: [],
  codigos: [],
  sei: [],
  afastamentos: [],
  ferias: {},
  abonos: {},
  produtividade: {},
  config: { gmov_data: "" },
  filaAvulsa: {
    listas: { "Padrão": { fila: [], idx: 0 } },
    ativa: "Padrão",
    natal: [],
    configProd: {
      tipos: ["documento", "processo", "análise", "atendimento", "reunião", "outro"],
      sistemas: ["SISREF", "SEI", "SIAPE", "SOUGOV", "E-mail", "Físico", "Outro"]
    },
    pendencias: []
  },
  balcaoAtendimentos: {},
  faq: [],
  gasUrl: ""
};

let appState: AppState = { ...defaultState };
let stateUpdatedAt = Date.now();

let saveCloudTimeout: any = null;

async function loadCloudState(): Promise<AppState | null> {
  if (!firestoreDb) return null;
  try {
    const mainRef = doc(firestoreDb, "app_state", "main");
    const mainSnap = await getDoc(mainRef);
    if (!mainSnap.exists()) return null;

    const mainData = mainSnap.data() || {};
    let baseState: AppState = { ...defaultState, ...(mainData.state || {}) };

    try {
      const servRef = doc(firestoreDb, "app_state", "servidores");
      const servSnap = await getDoc(servRef);
      if (servSnap.exists()) {
        const d = servSnap.data();
        if (d && Array.isArray(d.list)) baseState.servidores = d.list;
      }
    } catch (_) {}

    try {
      const histRef = doc(firestoreDb, "app_state", "historico");
      const histSnap = await getDoc(histRef);
      if (histSnap.exists()) {
        const d = histSnap.data();
        if (d && Array.isArray(d.list)) baseState.historico = d.list;
      }
    } catch (_) {}

    console.log("Loaded persistent state directly from Firebase Firestore Cloud Database!");
    return baseState;
  } catch (err: any) {
    const errMsg = String(err?.message || err || "");
    if (errMsg.includes("NOT_FOUND") || errMsg.includes("not-found") || err?.code === "not-found" || err?.code === 5) {
      console.warn("Firestore database (default) is not provisioned on this Firebase project. Disabling Firestore sync and falling back to db.json disk database.");
      firestoreDb = null;
    } else {
      console.warn("Could not load state from Firestore:", err);
    }
    return null;
  }
}

function saveCloudState(stateToSave: AppState) {
  if (!firestoreDb) return;
  if (saveCloudTimeout) clearTimeout(saveCloudTimeout);
  saveCloudTimeout = setTimeout(async () => {
    if (!firestoreDb) return;
    try {
      const { servidores, historico, ...mainPart } = stateToSave;

      await setDoc(doc(firestoreDb, "app_state", "main"), {
        state: mainPart,
        updatedAt: Date.now()
      });

      if (servidores && servidores.length > 0) {
        await setDoc(doc(firestoreDb, "app_state", "servidores"), {
          list: servidores,
          updatedAt: Date.now()
        });
      }

      if (historico && historico.length > 0) {
        await setDoc(doc(firestoreDb, "app_state", "historico"), {
          list: historico,
          updatedAt: Date.now()
        });
      }

      console.log("Successfully saved state to Firebase Firestore Cloud Database.");
    } catch (err: any) {
      const errMsg = String(err?.message || err || "");
      if (errMsg.includes("NOT_FOUND") || errMsg.includes("not-found") || err?.code === "not-found" || err?.code === 5) {
        console.warn("Firestore database (default) is not provisioned on this Firebase project. Disabling Firestore sync.");
        firestoreDb = null;
      } else {
        console.warn("Error persisting state to Firebase Firestore:", err);
      }
    }
  }, 500);
}

// Load state from file on startup
try {
  if (fs.existsSync(DB_FILE)) {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    appState = {
      ...defaultState,
      ...parsed
    };
    stateUpdatedAt = Date.now();
    console.log("Loaded existing database from db.json");
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultState, null, 2), "utf-8");
    console.log("Initialized new database db.json");
  }
} catch (error) {
  console.error("Error initializing database file:", error);
}

// Function to save state to file and cloud
function saveState() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(appState, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving state to disk:", error);
  }
  saveCloudState(appState);
}

// API Routes
app.get("/api/state", (req, res) => {
  res.json({
    status: "ok",
    state: appState,
    updatedAt: stateUpdatedAt
  });
});

app.post("/api/state", (req, res) => {
  const clientState = req.body.state as AppState;
  const clientTimestamp = Number(req.body.updatedAt || 0);

  if (!clientState) {
    return res.status(400).json({ status: "error", message: "Missing state data" });
  }

  appState = {
    ...defaultState,
    ...clientState
  };
  stateUpdatedAt = Date.now();
  saveState();

  res.json({
    status: "ok",
    state: appState,
    updatedAt: stateUpdatedAt
  });
});

// For single conferência registration (similar to inserirDados)
app.post("/api/insert-log", (req, res) => {
  const { matricula, observacao } = req.body;
  if (!matricula) {
    return res.status(400).json({ status: "error", message: "Missing matricula" });
  }

  // Find the server to log the full name and lotacao
  const srv = appState.servidores.find(s => String(s.matricula) === String(matricula));
  const nome = srv ? srv.nome : `Servidor ${matricula}`;
  const setor = srv ? srv.lotacao : "Desconhecido";

  const newLog = {
    mat: String(matricula),
    nome,
    setor,
    qtd: 0, // Will be filled during checking
    ts: new Date().toISOString()
  };

  // Add to history
  appState.historico = [newLog, ...appState.historico].slice(0, 500);
  stateUpdatedAt = Date.now();
  saveState();

  res.json({ status: "success", log: newLog, updatedAt: stateUpdatedAt });
});

// Proxy endpoint to communicate with Google Apps Script Web App without CORS restrictions
app.post("/api/gas-sync", async (req, res) => {
  const { gasUrl, action, state } = req.body;
  if (!gasUrl) {
    return res.status(400).json({ status: "error", message: "A URL do Apps Script é obrigatória" });
  }

  try {
    const response = await fetch(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, state }),
    });

    if (!response.ok) {
      throw new Error(`Google Apps Script retornou status HTTP ${response.status}`);
    }

    const data = await response.json();
    return res.json({ status: "success", data });
  } catch (error: any) {
    console.error("Erro na comunicação com GAS:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Não foi possível conectar ao Google Apps Script. Verifique a URL e se as permissões de acesso do script estão configuradas como 'Qualquer pessoa' (Anyone)."
    });
  }
});

// Vite & Static file serving setup
async function startServer() {
  try {
    const cloudState = await loadCloudState();
    if (cloudState) {
      appState = {
        ...defaultState,
        ...cloudState
      };
      stateUpdatedAt = Date.now();
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(appState, null, 2), "utf-8");
      } catch (_) {}
      console.log("Restored cloud state from Firebase Firestore into memory & disk cache.");
    }
  } catch (err) {
    console.warn("Cloud state restore skipped:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
