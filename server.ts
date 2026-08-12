import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { AppState } from "./src/types.js";

const app = express();
const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "db.json");

// Parse JSON bodies up to 50MB (to allow importing lists of servers comfortably)
app.use(express.json({ limit: "50mb" }));

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

// Function to save state to file
function saveState() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(appState, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving state to disk:", error);
  }
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
