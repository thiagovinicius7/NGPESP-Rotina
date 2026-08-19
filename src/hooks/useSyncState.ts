import { useState, useEffect, useRef } from "react";
import { AppState } from "../types.js";
import { mergeProdutividade, mergeFilaAvulsa, saveLocalSnapshot } from "../lib/utils";
import { 
  fetchFirestoreState, pushStateToFirestore, subscribeToFirestore 
} from "../lib/firestoreSync";

const LOCAL_STORAGE_KEY = "ngpesp_local_state";
const LOCAL_TIMESTAMP_KEY = "ngpesp_local_updated_at";

const DEFAULT_SPREADSHEET_ID = "1gk5MZYPDb3g5XM5y52OLMHMU0B0R2qbbZD79ryBizek";

// Broadcast channel for instant multi-window / multi-tab synchronization
const SYNC_CHANNEL_NAME = "ngpesp_intertab_sync";

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
  const [cloudSynced, setCloudSynced] = useState(false);
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
  
  // Track if we have local mutations that have not been successfully pushed/saved to the cloud yet
  const isDirtyRef = useRef<boolean>(false);
  const hasLoadedFromCloudRef = useRef<boolean>(false);

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
      
      // 1. Save locally immediately for instant offline resilience
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      saveLocalSnapshot(updated);
      latestStateRef.current = updated;
      stateRef.current = updated;
      
      // 2. Instantly broadcast update to any other open windows/tabs on this machine
      try {
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          const bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
          bc.postMessage({ type: "INTERTAB_STATE_UPDATE", state: updated, timestamp: Date.now() });
          bc.close();
        }
      } catch (_) {}

      return updated;
    });

    isDirtyRef.current = true;

    // 3. Debounce pushing to Firestore (and Node server if active)
    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current);
    }
    pushTimeoutRef.current = setTimeout(() => {
      pushStateToCloud(latestStateRef.current);
    }, 1000);
  };

  const pushStateToCloud = async (currentState: AppState) => {
    const now = Date.now();
    try {
      // Don't push empty state from a blank device if it hasn't loaded cloud data
      const hasMeaningfulData = (currentState.servidores?.length || 0) > 0 || 
        Object.values(currentState.filaAvulsa?.listas || {}).some(l => (l.fila?.length || 0) > 0);

      if (!hasMeaningfulData && !hasLoadedFromCloudRef.current) {
        console.log("Skipping push: device is blank and hasn't loaded cloud data yet.");
        return;
      }

      // Push to Firestore (works universally on all devices and GitHub Pages)
      const firestoreOk = await pushStateToFirestore(currentState);
      if (firestoreOk) {
        localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(now));
        setLastUpdated(now);
        isDirtyRef.current = false;
        setCloudSynced(true);
      }

      // Also push to Node backend if available (fallback)
      if (!isStaticMode) {
        try {
          await fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: currentState })
          });
        } catch (_) {}
      }
    } catch (e) {
      console.warn("Failed to push state to cloud:", e);
    }
  };

  // Force Push THIS device's data to cloud immediately
  const forcePushThisDeviceToCloud = async () => {
    setSyncing(true);
    try {
      const currentState = stateRef.current;
      const ok = await pushStateToFirestore(currentState);
      if (ok) {
        const now = Date.now();
        setLastUpdated(now);
        localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(now));
        setCloudSynced(true);
        isDirtyRef.current = false;
        hasLoadedFromCloudRef.current = true;
        const totalServ = currentState.servidores?.length || 0;
        const activeList = currentState.filaAvulsa?.listas?.[currentState.filaAvulsa?.ativa || "Padrão"];
        const totalFila = activeList?.fila?.length || 0;
        onToast(`Nuvem atualizada com sucesso! (${totalServ} servidores, ${totalFila} itens na fila)`, "ok");
      } else {
        onToast("Erro ao gravar dados na nuvem Firestore", "err");
      }
    } catch (e) {
      console.error(e);
      onToast("Falha ao salvar dados na nuvem", "err");
    } finally {
      setSyncing(false);
    }
  };

  // Force Pull latest data from cloud
  const forcePullFromCloud = async () => {
    setSyncing(true);
    try {
      const cloudResult = await fetchFirestoreState();
      if (cloudResult && cloudResult.state) {
        const serverState = cloudResult.state;
        const serverTime = cloudResult.updatedAt;

        const mergedState: AppState = {
          ...defaultState,
          ...serverState,
          servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (stateRef.current.servidores || []),
          historico: (serverState.historico && serverState.historico.length > 0) ? serverState.historico : (stateRef.current.historico || []),
          respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (stateRef.current.respostas || []),
          faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (stateRef.current.faq || []),
          produtividade: mergeProdutividade(stateRef.current.produtividade || {}, serverState.produtividade || {}),
          filaAvulsa: serverState.filaAvulsa || stateRef.current.filaAvulsa,
          balcaoAtendimentos: { ...(stateRef.current.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) },
          config: { ...(stateRef.current.config || {}), ...(serverState.config || {}) }
        };

        setStateState(mergedState);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
        saveLocalSnapshot(mergedState);
        setLastUpdated(serverTime || Date.now());
        localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime || Date.now()));
        isDirtyRef.current = false;
        hasLoadedFromCloudRef.current = true;
        setCloudSynced(true);
        onToast("Dados baixados da nuvem com sucesso!", "ok");
      } else {
        onToast("Nenhum dado encontrado na nuvem ainda. Clique em 'Salvar Este Dispositivo na Nuvem'.", "info");
      }
    } catch (e) {
      console.error(e);
      onToast("Erro ao conectar com a nuvem", "err");
    } finally {
      setSyncing(false);
    }
  };

  // General force sync (auto-detects direction)
  const forceSync = async () => {
    // If local has servers and cloud is empty, push. Otherwise, pull and merge.
    const localHasData = (stateRef.current.servidores?.length || 0) > 0 || 
      Object.values(stateRef.current.filaAvulsa?.listas || {}).some((l: any) => (l?.fila?.length || 0) > 0);

    if (localHasData && !hasLoadedFromCloudRef.current) {
      await forcePushThisDeviceToCloud();
    } else {
      await forcePullFromCloud();
    }
  };

  // 1. Initial pull on startup to load cloud state on ANY device / browser
  useEffect(() => {
    let isMounted = true;

    const initialFetch = async () => {
      try {
        let cachedState: AppState | null = null;
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (raw) cachedState = JSON.parse(raw);
        } catch (_) {}

        const localHasData = cachedState && (
          (cachedState.servidores?.length || 0) > 0 ||
          Object.values(cachedState.filaAvulsa?.listas || {}).some(l => (l.fila?.length || 0) > 0)
        );

        // Fetch from Firestore
        const cloudData = await fetchFirestoreState();

        if (cloudData && cloudData.state && isMounted) {
          const serverTime = Number(cloudData.updatedAt || 0);
          const serverState: Partial<AppState> = cloudData.state;

          const cloudHasData = (serverState.servidores?.length || 0) > 0 || 
            Boolean(serverState.filaAvulsa?.listas && Object.keys(serverState.filaAvulsa.listas).length > 0);

          let mergedState: AppState;
          if (!localHasData) {
            // Brand new device / browser: adopt Firestore cloud state directly
            mergedState = {
              ...defaultState,
              ...serverState
            };
          } else {
            // Existing device with data: merge safely
            mergedState = {
              ...defaultState,
              ...serverState,
              servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (cachedState?.servidores || []),
              historico: (serverState.historico && serverState.historico.length > 0) ? serverState.historico : (cachedState?.historico || []),
              respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (cachedState?.respostas || []),
              faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (cachedState?.faq || []),
              produtividade: mergeProdutividade(cachedState?.produtividade || {}, serverState.produtividade || {}),
              filaAvulsa: serverState.filaAvulsa || cachedState?.filaAvulsa || defaultState.filaAvulsa,
              balcaoAtendimentos: { ...(cachedState?.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) },
              config: { gmov_data: "", ...(cachedState?.config || {}), ...(serverState.config || {}) }
            };
          }

          setStateState(mergedState);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
          saveLocalSnapshot(mergedState);
          setLastUpdated(serverTime || Date.now());
          localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(serverTime || Date.now()));
          setCloudSynced(true);
          hasLoadedFromCloudRef.current = true;
          isDirtyRef.current = false;
          console.log("Successfully initialized state from Firestore across devices");

          // If local has data that was missing in cloud, push merged back to cloud
          if (localHasData && !cloudHasData) {
            console.log("Pushing local data to initialize Firestore cloud");
            await pushStateToFirestore(mergedState);
          }
          return;
        }

        // If Firestore is empty but this device HAS data:
        if (!cloudData && localHasData && cachedState) {
          console.log("Firestore empty: Auto-seeding cloud with this computer's data!");
          await pushStateToFirestore(cachedState);
          setCloudSynced(true);
          hasLoadedFromCloudRef.current = true;
        }

        // Fallback: Node server /api/state if not static
        if (!isStaticMode) {
          const res = await fetch("/api/state");
          if (res.ok) {
            const data = await res.json();
            if (data.status === "ok" && isMounted) {
              const serverTime = Number(data.updatedAt);
              const serverState: AppState = data.state || {};

              let mergedState: AppState = {
                ...defaultState,
                ...serverState,
                ...(cachedState || {})
              };

              setStateState(mergedState);
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
              setLastUpdated(serverTime);
              setCloudSynced(true);
              hasLoadedFromCloudRef.current = true;
            }
          }
        }
      } catch (err) {
        console.warn("Could not connect to cloud on startup, using offline cache", err);
      }
    };

    initialFetch();

    return () => {
      isMounted = false;
    };
  }, [isStaticMode]);

  // 2. Real-time multi-device subscription via Firestore
  useEffect(() => {
    const unsubscribe = subscribeToFirestore((incomingPartial, updatedAt) => {
      // If we are currently typing/mutating locally, don't clobber
      if (isDirtyRef.current) return;

      setStateState(prev => {
        const merged: AppState = {
          ...prev,
          ...incomingPartial,
          filaAvulsa: incomingPartial.filaAvulsa 
            ? incomingPartial.filaAvulsa
            : prev.filaAvulsa,
          servidores: incomingPartial.servidores
            ? incomingPartial.servidores
            : prev.servidores,
          produtividade: incomingPartial.produtividade
            ? mergeProdutividade(prev.produtividade, incomingPartial.produtividade)
            : prev.produtividade
        };

        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
        saveLocalSnapshot(merged);
        latestStateRef.current = merged;
        stateRef.current = merged;
        return merged;
      });

      if (updatedAt) {
        setLastUpdated(updatedAt);
        localStorage.setItem(LOCAL_TIMESTAMP_KEY, String(updatedAt));
      }
      setCloudSynced(true);
      hasLoadedFromCloudRef.current = true;
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 3. Setup instantaneous zero-latency Inter-Window / Inter-Tab synchronization
  useEffect(() => {
    if (typeof window === "undefined") return;

    let bc: BroadcastChannel | null = null;

    const handleBroadcast = (event: MessageEvent) => {
      if (event.data && event.data.type === "INTERTAB_STATE_UPDATE" && event.data.state) {
        const incomingState = event.data.state;
        setStateState(incomingState);
        latestStateRef.current = incomingState;
        stateRef.current = incomingState;
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          setStateState(parsed);
          latestStateRef.current = parsed;
          stateRef.current = parsed;
        } catch (_) {}
      }
    };

    if ("BroadcastChannel" in window) {
      try {
        bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
        bc.onmessage = handleBroadcast;
      } catch (_) {}
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      if (bc) {
        try {
          bc.close();
        } catch (_) {}
      }
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Export state to JSON file
  const exportBackupJson = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(stateRef.current, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `NGPESP_Backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      onToast("Backup baixado com sucesso!", "ok");
    } catch (e) {
      onToast("Erro ao exportar arquivo de backup", "err");
    }
  };

  // Import state from JSON file
  const importBackupJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed) {
          updateState(parsed);
          await pushStateToFirestore(parsed);
          onToast("Backup restaurado e sincronizado com a nuvem!", "ok");
        }
      } catch (err) {
        onToast("Arquivo de backup inválido", "err");
      }
    };
    reader.readAsText(file);
  };

  return {
    state,
    updateState,
    syncing,
    forceSync,
    forcePushThisDeviceToCloud,
    forcePullFromCloud,
    isStaticMode,
    cloudSynced,
    exportBackupJson,
    importBackupJson
  };
}
