import { useState, useEffect, useRef } from "react";
import { marcarBackupFeito } from "../lib/backupLembrete.js";
import { AppState } from "../types.js";
import { mergeProdutividade, mergeFilaAvulsa, mergeHistorico, saveLocalSnapshot } from "../lib/utils";
import { 
  fetchFirestoreState, pushStateToFirestore, subscribeToFirestore,
  firestoreQuotaExceeded, oldVersionDetected, isCloudLoaded, restorePersistedBase
} from "../lib/firestoreSync";
import { safeLocalStorageSet, saveStateToIndexedDB, loadStateFromIndexedDB } from "../lib/idbStorage";

const LOCAL_STORAGE_KEY = "ngpesp_local_state";
const LOCAL_TIMESTAMP_KEY = "ngpesp_local_updated_at";
// Marca (por aba) que há alterações ainda não enviadas à nuvem
const PENDING_PREFIX = "ngpesp_cloud_pending_";
const TAB_ID = Math.random().toString(36).slice(2, 10);

function pendingKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PENDING_PREFIX)) keys.push(k);
    }
  } catch (_) {}
  return keys;
}
function hasPendingLocalChanges(): boolean {
  return pendingKeys().length > 0;
}
function setPendingLocalChanges(v: boolean) {
  try {
    if (v) localStorage.setItem(PENDING_PREFIX + TAB_ID, String(Date.now()));
    else localStorage.removeItem(PENDING_PREFIX + TAB_ID);
  } catch (_) {}
}
/** Depois de enviar os dados locais já mesclados (que incluem as edições das outras abas), limpa todas as marcas. */
function clearAllPendingLocalChanges() {
  try { pendingKeys().forEach(k => localStorage.removeItem(k)); } catch (_) {}
}
/**
 * Depois de um envio bem-sucedido do estado compartilhado (o mesmo cache para todas as abas),
 * limpa as marcas criadas antes do início do envio — essas edições já estão na nuvem.
 */
function clearPendingOlderThan(ts: number) {
  try {
    pendingKeys().forEach(k => {
      if (Number(localStorage.getItem(k) || 0) <= ts) localStorage.removeItem(k);
    });
  } catch (_) {}
}

/**
 * Fila ao juntar dados locais com os da nuvem: se este computador tem alterações
 * não enviadas, junta (para não perdê-las); senão a nuvem vale como está
 * (assim listas/itens apagados em outro computador não voltam).
 * forceMerge: computador que vinha da versão antiga (sem marcas de pendência) — sempre junta.
 */
/**
 * Histórico vindo da nuvem: a nuvem guarda os dias mais recentes (até ~2000 registros).
 * Dentro desse período a nuvem vale como está (o que foi apagado em outro computador
 * não volta); registros locais mais antigos que o período da nuvem são mantidos.
 */
export function historicoFromCloud(local: any[] = [], cloud: any[] = []): any[] {
  if (!Array.isArray(cloud) || cloud.length === 0) return [];
  const dias = cloud.map(h => String(h?.ts || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dias.length === 0) return cloud;
  const maisAntigo = dias.reduce((a, b) => (a < b ? a : b));
  const antigosLocais = (local || []).filter(h => {
    const d = String(h?.ts || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < maisAntigo;
  });
  return [...cloud, ...antigosLocais].slice(0, 5000);
}

function chooseFila(localFila: any, serverFila: any, forceMerge: boolean = false): any {
  if (!serverFila || !serverFila.listas) return localFila;
  if (forceMerge || hasPendingLocalChanges()) return mergeFilaAvulsa(localFila, serverFila);
  const ativa = localFila?.ativa && serverFila.listas[localFila.ativa] ? localFila.ativa : serverFila.ativa;
  return { ...serverFila, ativa };
}

const DEFAULT_SPREADSHEET_ID = "1gk5MZYPDb3g5XM5y52OLMHMU0B0R2qbbZD79ryBizek";

// Broadcast channel for instant multi-window / multi-tab synchronization
const SYNC_CHANNEL_NAME = "ngpesp_intertab_sync";

// Tempo de espera para juntar várias alterações num único envio à nuvem
const CLOUD_PUSH_DEBOUNCE_MS = 1500;

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
    try {
      const cached = localStorage.getItem(LOCAL_TIMESTAMP_KEY);
      return cached ? Number(cached) : 0;
    } catch (_) {
      return 0;
    }
  });

  const onToastRef = useRef(onToast);
  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  const [syncing, setSyncing] = useState(false);
  // Há alteração feita neste computador que ainda não chegou à nuvem
  const [aguardandoNuvem, setAguardandoNuvem] = useState<boolean>(() => hasPendingLocalChanges());
  useEffect(() => {
    const t = setInterval(() => setAguardandoNuvem(hasPendingLocalChanges()), 4000);
    return () => clearInterval(t);
  }, []);
  const [cloudSynced, setCloudSynced] = useState(false);
  // Motivo de a nuvem não estar salvando (null = tudo certo)
  const [cloudError, setCloudError] = useState<null | "limite" | "sem-internet" | "erro">(null);
  const reportCloudFailure = () => {
    setCloudError(
      firestoreQuotaExceeded ? "limite"
        : (typeof navigator !== "undefined" && navigator.onLine === false) ? "sem-internet"
        : "erro"
    );
  };
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
  // Conta edições locais (para não marcar como "salvo" se houve edição durante o envio)
  const editCounterRef = useRef<number>(0);
  const hasLoadedFromCloudRef = useRef<boolean>(false);

  useEffect(() => {
    stateRef.current = state;
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    lastUpdatedRef.current = lastUpdated;
  }, [lastUpdated]);

  // Clean up any legacy oversized snapshots in localStorage to permanently prevent quota crashes
  useEffect(() => {
    try {
      const snapRaw = localStorage.getItem("ngpesp_local_snapshots");
      if (snapRaw && snapRaw.length > 300000) {
        localStorage.removeItem("ngpesp_local_snapshots");
      }
    } catch (_) {}

    // Also check IndexedDB on startup to restore full history and data if localStorage was trimmed or empty
    loadStateFromIndexedDB().then(idbState => {
      if (idbState) {
        setStateState(prev => {
          const mergedHist = mergeHistorico(prev.historico || [], idbState.historico || []);
          const hasMoreServ = (idbState.servidores?.length || 0) > (prev.servidores?.length || 0);
          const mergedFila = mergeFilaAvulsa(prev.filaAvulsa, idbState.filaAvulsa);
          const reconciled: AppState = {
            ...prev,
            servidores: hasMoreServ ? idbState.servidores : prev.servidores,
            historico: mergedHist,
            filaAvulsa: mergedFila,
            produtividade: mergeProdutividade(prev.produtividade || {}, idbState.produtividade || {}),
            lancamentosAnteriores: (idbState.lancamentosAnteriores?.length || 0) > (prev.lancamentosAnteriores?.length || 0) ? idbState.lancamentosAnteriores : prev.lancamentosAnteriores,
            config: {
              ...(prev.config || {}),
              ...(idbState.config || {}),
              lancamentosAnteriores: (idbState.config?.lancamentosAnteriores?.length || 0) > (prev.config?.lancamentosAnteriores?.length || 0) ? idbState.config?.lancamentosAnteriores : prev.config?.lancamentosAnteriores
            }
          };
          latestStateRef.current = reconciled;
          stateRef.current = reconciled;
          return reconciled;
        });
      }
    }).catch(() => {});
  }, []);

  const updateState = (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    const now = Date.now();
    setStateState(prev => {
      const partial = typeof newState === "function" ? newState(prev) : newState;
      const updated = { ...prev, ...partial };
      
      // 1. Save locally with safe storage (never throws QuotaExceededError)
      safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(now));
      saveStateToIndexedDB(updated).catch(() => {});
      saveLocalSnapshot(updated);
      latestStateRef.current = updated;
      stateRef.current = updated;
      lastUpdatedRef.current = now;
      setLastUpdated(now);
      
      // 2. Instantly broadcast update to any other open windows/tabs on this machine
      try {
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          const bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
          bc.postMessage({ type: "INTERTAB_STATE_UPDATE", state: updated, timestamp: now });
          bc.close();
        }
      } catch (_) {}

      // 3. Immediately persist to container backend (/api/state) with zero delay
      if (!isStaticMode) {
        fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: updated, updatedAt: now })
        }).catch(() => {});
      }

      return updated;
    });

    isDirtyRef.current = true;
    editCounterRef.current += 1;
    setPendingLocalChanges(true);
    setAguardandoNuvem(true);

    // 4. Debounce pushing to Firestore cloud
    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current);
    }
    // Junta alterações feitas em sequência num único envio (economiza cota do Firestore).
    // Os dados já ficam salvos na hora no navegador (localStorage/IndexedDB).
    pushTimeoutRef.current = setTimeout(() => {
      pushTimeoutRef.current = null;
      pushStateToCloud(latestStateRef.current);
    }, CLOUD_PUSH_DEBOUNCE_MS);
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
      const editsAtStart = editCounterRef.current;
      const pushStartedAt = Date.now();
      const firestoreOk = await pushStateToFirestore(currentState);
      if (firestoreOk) {
        safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(now));
        setLastUpdated(now);
        // Só considera "salvo" se não houve nova edição durante o envio
        if (editCounterRef.current === editsAtStart) {
          isDirtyRef.current = false;
          setPendingLocalChanges(false);
          setAguardandoNuvem(false);
        }
        clearPendingOlderThan(pushStartedAt);
        setCloudSynced(true);
        setCloudError(null);
      } else if (!isCloudLoaded()) {
        reportCloudFailure();
        // A nuvem não carregou ao abrir o app. Usa a última versão da nuvem conhecida por este
        // navegador para saber o que foi editado aqui; os dados locais NÃO são alterados.
        // Sem base guardado (ex.: primeiro dia da versão nova), carrega a nuvem e junta.
        const loaded = restorePersistedBase() || (await forcePullFromCloudRef.current(true));
        if (!pushTimeoutRef.current) {
          pushTimeoutRef.current = setTimeout(() => {
            pushTimeoutRef.current = null;
            pushStateToCloudRef.current(latestStateRef.current);
          }, loaded ? 3000 : 60 * 1000);
        }
      } else if (reportCloudFailure(), !pushTimeoutRef.current) {
        // Falhou: tenta de novo mais tarde (os dados continuam salvos neste computador)
        const delay = firestoreQuotaExceeded ? 10 * 60 * 1000 : 30 * 1000;
        pushTimeoutRef.current = setTimeout(() => {
          pushTimeoutRef.current = null;
          pushStateToCloudRef.current(latestStateRef.current);
        }, delay);
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
      reportCloudFailure();
    }
  };

  /** Tenta enviar agora (botão da faixa de aviso). */
  const retryCloudNow = () => {
    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current);
      pushTimeoutRef.current = null;
    }
    pushStateToCloudRef.current(latestStateRef.current);
  };

  // Se a aba for escondida/fechada com um envio pendente, envia na hora
  const pushStateToCloudRef = useRef(pushStateToCloud);
  pushStateToCloudRef.current = pushStateToCloud;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushPending = () => {
      if (pushTimeoutRef.current) {
        clearTimeout(pushTimeoutRef.current);
        pushTimeoutRef.current = null;
        pushStateToCloudRef.current(latestStateRef.current);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    // Voltou a internet: se há algo não enviado, envia
    const onOnline = () => {
      if (isDirtyRef.current || hasPendingLocalChanges()) {
        setTimeout(() => pushStateToCloudRef.current(latestStateRef.current), 1500);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Force Push THIS device's data to cloud immediately
  const forcePushThisDeviceToCloud = async () => {
    setSyncing(true);
    try {
      const currentState = stateRef.current;
      
      const fsPromise = pushStateToFirestore(currentState, true);
      const apiPromise = !isStaticMode ? fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: currentState, updatedAt: Date.now() })
      }).catch(() => null) : Promise.resolve(null);

      const [fsOk] = await Promise.all([fsPromise, apiPromise]);
      if (!fsOk && isStaticMode) {
        throw new Error("Não foi possível salvar na nuvem agora (o limite diário do banco pode ter sido atingido). Seus dados continuam salvos neste computador.");
      }

      const now = Date.now();
      setLastUpdated(now);
      safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(now));
      setCloudSynced(true);
      isDirtyRef.current = false;
      hasLoadedFromCloudRef.current = true;
      const totalServ = currentState.servidores?.length || 0;
      const activeList = currentState.filaAvulsa?.listas?.[currentState.filaAvulsa?.ativa || "Padrão"];
      const totalFila = activeList?.fila?.length || 0;
      onToast(`Nuvem atualizada com sucesso! (${totalServ} servidores, ${totalFila} itens na fila)`, "ok");
    } catch (e: any) {
      console.error("Erro ao enviar dados para a nuvem:", e);
      onToast(e?.message || "Falha ao salvar dados na nuvem", "err");
    } finally {
      setSyncing(false);
    }
  };

  // Force Pull latest data from cloud
  const forcePullFromCloud = async (quiet: boolean = false): Promise<boolean> => {
    if (!quiet) setSyncing(true);
    let loaded = false;
    try {
      let serverState: Partial<AppState> | null = null;
      let serverTime = 0;

      try {
        const cloudResult = await fetchFirestoreState();
        if (cloudResult && cloudResult.state) {
          serverState = cloudResult.state;
          serverTime = cloudResult.updatedAt;
        }
      } catch (fsErr) {
        console.warn("Firestore fetch error, trying backend fallback:", fsErr);
      }

      // Backend fallback if Firestore was empty or failed
      if (!serverState && !isStaticMode) {
        try {
          const res = await fetch("/api/state");
          if (res.ok) {
            const data = await res.json();
            if (data.state && (data.state.servidores?.length > 0 || Object.keys(data.state.filaAvulsa?.listas || {}).length > 0)) {
              serverState = data.state;
              serverTime = data.updatedAt || Date.now();
            }
          }
        } catch (_) {}
      }

      if (serverState) {
        const juntar = hasPendingLocalChanges();
        const mergedFila = chooseFila(stateRef.current.filaAvulsa, serverState.filaAvulsa);
        const mergedHist = juntar
          ? mergeHistorico(stateRef.current.historico || [], serverState.historico || [])
          : historicoFromCloud(stateRef.current.historico || [], serverState.historico || []);
        const mergedState: AppState = {
          ...defaultState,
          ...serverState,
          servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (stateRef.current.servidores || []),
          historico: mergedHist,
          respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (stateRef.current.respostas || []),
          faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (stateRef.current.faq || []),
          produtividade: juntar
            ? mergeProdutividade(stateRef.current.produtividade || {}, serverState.produtividade || {})
            : (serverState.produtividade || {}),
          filaAvulsa: mergedFila,
          balcaoAtendimentos: juntar
            ? { ...(stateRef.current.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) }
            : (serverState.balcaoAtendimentos || {}),
          config: { ...(stateRef.current.config || {}), ...(serverState.config || {}) }
        };

        setStateState(mergedState);
        latestStateRef.current = mergedState;
        stateRef.current = mergedState;
        safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
        saveStateToIndexedDB(mergedState).catch(() => {});
        saveLocalSnapshot(mergedState);
        const nextTime = Math.max(serverTime || 0, Date.now());
        setLastUpdated(nextTime);
        safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(nextTime));
        // Se havia alterações locais não enviadas, continuam marcadas para envio
        isDirtyRef.current = hasPendingLocalChanges();
        hasLoadedFromCloudRef.current = true;
        setCloudSynced(true);
        loaded = true;
        if (!quiet) {
          const totalServ = mergedState.servidores?.length || 0;
          const totalFila = mergedState.filaAvulsa?.listas?.[mergedState.filaAvulsa?.ativa || "Padrão"]?.fila?.length || 0;
          onToast(`Sincronização concluída! (${totalServ} servidores, ${totalFila} na fila)`, "ok");
          if (hasPendingLocalChanges() && !pushTimeoutRef.current) {
            pushTimeoutRef.current = setTimeout(() => {
              pushTimeoutRef.current = null;
              pushStateToCloudRef.current(latestStateRef.current);
            }, 1500);
          }
        }
      } else if (!quiet) {
        onToast("Nenhum dado encontrado na nuvem ainda. Clique em 'Salvar Este Computador na Nuvem Agora'.", "info");
      }
    } catch (e: any) {
      console.error(e);
      if (!quiet) onToast(e?.message || "Erro ao conectar com a nuvem", "err");
    } finally {
      if (!quiet) setSyncing(false);
    }
    return loaded;
  };
  const forcePullFromCloudRef = useRef(forcePullFromCloud);
  forcePullFromCloudRef.current = forcePullFromCloud;

  // General force sync (saves current computer state to cloud and server)
  const forceSync = async () => {
    await forcePushThisDeviceToCloud();
  };

  // 1. Initial pull on startup to load cloud state on ANY device / browser
  useEffect(() => {
    let isMounted = true;

    const initialFetch = async () => {
      // Computador que nunca sincronizou no formato novo (vinha da versão antiga):
      // pode ter alterações locais não enviadas sem marca de pendência.
      let vindoDaVersaoAntiga = false;
      try { vindoDaVersaoAntiga = !localStorage.getItem("ngpesp_v2_base"); } catch (_) {}
      try {
        let cachedState: AppState | null = null;
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (raw) cachedState = JSON.parse(raw);
        } catch (_) {}

        if (!cachedState) {
          cachedState = await loadStateFromIndexedDB();
        }

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
            // Existing device with data: merge safely without regressing queue progress
            const mergedFila = chooseFila(cachedState?.filaAvulsa, serverState.filaAvulsa, vindoDaVersaoAntiga);
            // Com alterações locais não enviadas: junta. Sem elas: a nuvem vale como está.
            const juntar = hasPendingLocalChanges() || vindoDaVersaoAntiga;
            const mergedHist = juntar
              ? mergeHistorico(cachedState?.historico || [], serverState.historico || [])
              : historicoFromCloud(cachedState?.historico || [], serverState.historico || []);
            mergedState = {
              ...defaultState,
              ...serverState,
              servidores: (serverState.servidores && serverState.servidores.length > 0) ? serverState.servidores : (cachedState?.servidores || []),
              historico: mergedHist,
              respostas: (serverState.respostas && serverState.respostas.length > 0) ? serverState.respostas : (cachedState?.respostas || []),
              faq: (serverState.faq && serverState.faq.length > 0) ? serverState.faq : (cachedState?.faq || []),
              produtividade: juntar
                ? mergeProdutividade(cachedState?.produtividade || {}, serverState.produtividade || {})
                : (serverState.produtividade || {}),
              filaAvulsa: mergedFila,
              balcaoAtendimentos: juntar
                ? { ...(cachedState?.balcaoAtendimentos || {}), ...(serverState.balcaoAtendimentos || {}) }
                : (serverState.balcaoAtendimentos || {}),
              config: { gmov_data: "", ...(cachedState?.config || {}), ...(serverState.config || {}) }
            };
          }

          setStateState(mergedState);
          safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
          saveStateToIndexedDB(mergedState).catch(() => {});
          saveLocalSnapshot(mergedState);
          const effectiveTime = Math.max(serverTime || 0, Number(localStorage.getItem(LOCAL_TIMESTAMP_KEY) || 0), Date.now());
          setLastUpdated(effectiveTime);
          safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(effectiveTime));
          setCloudSynced(true);
          hasLoadedFromCloudRef.current = true;
          isDirtyRef.current = false;
          console.log("Successfully initialized state from Firestore across devices");

          // Sync back to container backend (/api/state) immediately
          if (!isStaticMode) {
            fetch("/api/state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ state: mergedState, updatedAt: effectiveTime })
            }).catch(() => {});
          }

          // If local has data that was missing in cloud, push merged back to cloud
          if (localHasData && !cloudHasData) {
            console.log("Pushing local data to initialize Firestore cloud");
            await pushStateToFirestore(mergedState, true);
          } else if ((hasPendingLocalChanges() || vindoDaVersaoAntiga) && localHasData) {
            // Alterações feitas aqui que não chegaram à nuvem (ex.: aba fechada antes de enviar)
            isDirtyRef.current = true;
            const ok = await pushStateToFirestore(mergedState);
            if (ok) {
              isDirtyRef.current = false;
              clearAllPendingLocalChanges();
            } else if (!pushTimeoutRef.current) {
              pushTimeoutRef.current = setTimeout(() => {
                pushTimeoutRef.current = null;
                pushStateToCloudRef.current(latestStateRef.current);
              }, 30 * 1000);
            }
          } else if (oldVersionDetected) {
            // Alterações feitas numa aba com a versão antiga foram recuperadas: salva no formato novo
            onToastRef.current("Um computador está com a versão antiga do app aberta. Recarregue a página (F5) nos outros computadores.", "info");
            await pushStateToFirestore(mergedState);
          }
          return;
        }

        // If Firestore is empty but this device HAS data:
        if (!cloudData && localHasData && cachedState) {
          console.log("Firestore empty: Auto-seeding cloud with this computer's data!");
          await pushStateToFirestore(cachedState, true);
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
              safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(mergedState));
              saveStateToIndexedDB(mergedState).catch(() => {});
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
      // If we are currently typing/mutating locally (nesta ou em outra aba), don't clobber
      if (isDirtyRef.current || hasPendingLocalChanges()) return false;

      setStateState(prev => {
        const merged: AppState = {
          ...prev,
          ...incomingPartial,
          // Sem edição local pendente, a fila da nuvem é a correta: aplica como está,
          // mantendo apenas a lista que este computador tem aberta.
          filaAvulsa: incomingPartial.filaAvulsa
            ? {
                ...incomingPartial.filaAvulsa,
                ativa: prev.filaAvulsa?.ativa && incomingPartial.filaAvulsa.listas?.[prev.filaAvulsa.ativa]
                  ? prev.filaAvulsa.ativa
                  : incomingPartial.filaAvulsa.ativa
              }
            : prev.filaAvulsa,
          servidores: incomingPartial.servidores
            ? incomingPartial.servidores
            : prev.servidores,
          historico: incomingPartial.historico
            ? historicoFromCloud(prev.historico, incomingPartial.historico)
            : prev.historico,
          produtividade: incomingPartial.produtividade
            ? incomingPartial.produtividade
            : prev.produtividade
        };

        safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(merged));
        saveStateToIndexedDB(merged).catch(() => {});
        saveLocalSnapshot(merged);
        latestStateRef.current = merged;
        stateRef.current = merged;
        return merged;
      });

      if (updatedAt) {
        setLastUpdated(updatedAt);
        safeLocalStorageSet(LOCAL_TIMESTAMP_KEY, String(updatedAt));
      }
      setCloudSynced(true);
      hasLoadedFromCloudRef.current = true;
      return true;
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
      marcarBackupFeito();
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
          await pushStateToFirestore(parsed, true);
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
    forcePullFromCloud: async () => { await forcePullFromCloud(false); },
    isStaticMode,
    cloudSynced,
    cloudError,
    retryCloudNow,
    aguardandoNuvem,
    salvoNaNuvemEm: lastUpdated,
    exportBackupJson,
    importBackupJson
  };
}
