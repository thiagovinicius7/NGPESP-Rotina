import { useState, useEffect, useRef } from "react";
import { AppState } from "../types.js";
import { mergeProdutividade, mergeFilaAvulsa, saveLocalSnapshot } from "../lib/utils";

const LOCAL_STORAGE_KEY = "ngpesp_local_state";
const LOCAL_TIMESTAMP_KEY = "ngpesp_local_updated_at";

const DEFAULT_SPREADSHEET_ID = "1gk5MZYPDb3g5XM5y52OLMHMU0B0R2qbbZD79ryBizek";

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
  config: { gmov_data: "", spreadsheetId: DEFAULT_SPREADSHEET_ID, backupEnabled: true },
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

export function useSyncState(onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void) {
  const [state, setStateState] = useState<AppState>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (!parsed.config) parsed.config = {};
        if (!parsed.config.spreadsheetId) parsed.config.spreadsheetId = DEFAULT_SPREADSHEET_ID;
        return parsed;
      }
    } catch (_) {}
    return defaultState;
  });

  const [lastUpdated, setLastUpdated] = useState<number>(() => {
    const cached = localStorage.getItem(LOCAL_TIMESTAMP_KEY);
    return cached ? Number(cached) : 0;
  });

  const onToastRef = useRef(onToast);
  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  const [syncing, setSyncing] = useState(false);
  const [isStaticMode, setIsStaticMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      if (window.location.hostname.endsWith("github.io")) {
        return true;
      }
    }
    return false;
  });
  
  const stateRef = useRef<AppState>(state);
  const latestStateRef = useRef<AppState>(state);
  const lastUpdatedRef = useRef<number>(lastUpdated);
  const pushTimeoutRef = useRef<any>(null);
  
  // Track if we have successfully completed the initial load from the server
  const hasLoadedFromServerRef = useRef<boolean>(false);
  // Track if we have local mutations that have not been successfully pushed/saved to the server yet
  const isDirtyRef = useRef<boolean>(false);

  useEffect(() => {
    stateRef.current = state;
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    lastUpdatedRef.current = lastUpdated;
  }, [lastUpdated]);

  const updateState = (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setStateState(prev => {
      const partial = typeof newState === "function" ? newState(prev) : newState;
      const updated = { ...prev, ...partial };
      
      // Save locally immediately
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      saveLocalSnapshot(updated);
      latestStateRef.current = updated;
      stateRef.current = updated;
      
      return updated;
    });

    // Mark as dirty since we have a local change
    isDirtyRef.current = true;

    // Debounce pushing to cloud server
    if (hasLoadedFromServerRef.current && !isStaticMode) {
      if (pushTimeoutRef.current) {
        clearTimeout(pushTimeoutRef.current);
      }
      pushTimeoutRef.current = setTimeout(() => {
        pushStateToServer(latestStateRef.current);
      }, 1000);
    }
  };

  const pushStateToServer = async (currentState: AppState) => {
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: currentState })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          const serverTime = Number(data.updatedAt);
          localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime));
          setLastUpdated(serverTime);
          
          isDirtyRef.current = false;
        }
      }
    } catch (e) {
      console.warn("Failed to push state to server, cached locally:", e);
    }
  };

  // Force sync from/to server
  const forceSync = async () => {
    if (isStaticMode) {
      onToast("Seus dados já estão salvos localmente e de forma segura no navegador!", "info");
      return;
    }
    setSyncing(true);
    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current);
    }
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          const serverTime = Number(data.updatedAt);
          const serverState = data.state || {};
          
          const mergedState: AppState = {
            ...defaultState,
            ...serverState,
            servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (stateRef.current.servidores || []),
            historico: (serverState.historico && serverState.historico.length > 0) ? serverState.historico : (stateRef.current.historico || []),
            respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (stateRef.current.respostas || []),
            faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (stateRef.current.faq || []),
            produtividade: mergeProdutividade(stateRef.current.produtividade || {}, serverState.produtividade || {}),
            filaAvulsa: mergeFilaAvulsa(stateRef.current.filaAvulsa, serverState.filaAvulsa),
            balcaoAtendimentos: { ...(stateRef.current.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) },
            config: { ...(stateRef.current.config || {}), ...(serverState.config || {}) }
          };

          setStateState(mergedState);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
          saveLocalSnapshot(mergedState);
          setLastUpdated(serverTime);
          localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime));
          hasLoadedFromServerRef.current = true;
          isDirtyRef.current = false;
          await pushStateToServer(mergedState);
          onToast("Dados sincronizados com sucesso sem perdas!", "ok");
        }
      } else {
        onToast("Erro de rede ao sincronizar", "err");
      }
    } catch (e) {
      onToast("Erro ao conectar com a nuvem", "err");
    } finally {
      setSyncing(false);
    }
  };

  // 1. Initial pull on startup to load server state (Runs only ONCE on mount)
  useEffect(() => {
    const initialFetch = async () => {
      if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io")) {
        setIsStaticMode(true);
        hasLoadedFromServerRef.current = true;
        return;
      }
      try {
        let cachedState: AppState | null = null;
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (raw) cachedState = JSON.parse(raw);
        } catch (_) {}

        const res = await fetch("/api/state");
        if (res.ok) {
          const data = await res.json();
          if (data.status === "ok") {
            const serverTime = Number(data.updatedAt);
            const serverState: AppState = data.state || {};

            // Safely merge server state with cached local state so no local data is lost
            const mergedState: AppState = {
              ...defaultState,
              ...serverState,
              servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (cachedState?.servidores || []),
              historico: (serverState.historico && serverState.historico.length > 0) ? serverState.historico : (cachedState?.historico || []),
              respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (cachedState?.respostas || []),
              faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (cachedState?.faq || []),
              produtividade: mergeProdutividade(cachedState?.produtividade || {}, serverState.produtividade || {}),
              filaAvulsa: mergeFilaAvulsa(cachedState?.filaAvulsa, serverState.filaAvulsa),
              balcaoAtendimentos: { ...(cachedState?.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) },
              config: { ...(cachedState?.config || {}), ...(serverState.config || {}) }
            };

            setStateState(mergedState);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
            saveLocalSnapshot(mergedState);
            setLastUpdated(serverTime);
            localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime));

            pushStateToServer(mergedState);

            hasLoadedFromServerRef.current = true;
            isDirtyRef.current = false;
            console.log("Successfully initialized merged state from cloud server and local storage");
          } else {
            setIsStaticMode(true);
            hasLoadedFromServerRef.current = true;
          }
        } else {
          setIsStaticMode(true);
          hasLoadedFromServerRef.current = true;
        }
      } catch (err) {
        console.warn("Could not connect to server on startup, using offline cache in static mode", err);
        setIsStaticMode(true);
        hasLoadedFromServerRef.current = true;
      }
    };

    initialFetch();
  }, []);

  // 2. Setup periodic background polling for cloud real-time sync (Runs only ONCE on mount)
  useEffect(() => {
    const fetchLatest = async () => {
      // Do not poll or overwrite if we haven't successfully loaded yet, if we are in static mode, or if we have unsaved local edits
      if (!hasLoadedFromServerRef.current || isStaticMode || isDirtyRef.current) {
        return;
      }
      try {
        const res = await fetch("/api/state");
        if (res.ok) {
          const data = await res.json();
          if (data.status === "ok") {
            const serverTime = Number(data.updatedAt);
            const localTime = lastUpdatedRef.current;

            // Only update locally if server has a strictly newer state, and we are not dirty
            if (serverTime > localTime && !isDirtyRef.current) {
              setStateState(data.state);
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.state));
              setLastUpdated(serverTime);
              localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime));
              onToastRef.current("Novos dados recebidos da nuvem", "info");
            }
          }
        }
      } catch (_) {
        // Silent error for periodic polling
      }
    };

    // Poll every 10 seconds (standard, non-disruptive, safe background sync)
    const interval = setInterval(fetchLatest, 10000);
    return () => clearInterval(interval);
  }, [isStaticMode]);

  return {
    state,
    updateState,
    syncing,
    forceSync,
    isStaticMode
  };
}
