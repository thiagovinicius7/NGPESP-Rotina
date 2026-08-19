import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  CheckCircle, Database, DownloadCloud, LogOut, Moon, 
  RefreshCw, Sun, LayoutDashboard, ClipboardCheck, 
  CalendarDays, TrendingUp, HelpCircle, BarChart3, 
  Contact, Wrench, AlertTriangle, ShieldCheck, Droplet,
  Cloud, UploadCloud, FileDown, FileUp, Laptop, CheckCircle2,
  X, ArrowRight
} from "lucide-react";
import { AppState, Server } from "./types.js";
import { useSyncState } from "./hooks/useSyncState.js";
import Dashboard from "./components/Dashboard.js";
import SisrefPanel from "./components/SisrefPanel.js";
import SigrhPanel from "./components/SigrhPanel.js";
import RotinaPanel from "./components/RotinaPanel.js";
import BalcaoPanel from "./components/BalcaoPanel.js";
import RelatorioPanel from "./components/RelatorioPanel.js";
import LancamentoApp from "./components/LancamentoApp.js";
import { loginWithGoogle, logoutFirebase, onAuthChange } from "./lib/firebaseAuth.js";
import { syncToGoogleSheets, loadFullStateFromBackup, DEFAULT_SPREADSHEET_ID } from "./lib/googleSheetsSync.js";
import { mergeProdutividade, mergeFilaAvulsa } from "./lib/utils.js";

const normalizeMatricula = (m: any): string => {
  if (!m) return "";
  let clean = String(m).trim().replace(/[^a-zA-Z0-9]/g, "");
  if (/^\d+$/.test(clean) && clean.length > 0 && clean.length < 8) {
    clean = clean.padStart(8, "0");
  }
  return clean.toLowerCase();
};

export default function App() {
  // App Mode: 'full' (main dashboard) or 'lancamento' (dedicated fast launcher app)
  const [appMode, setAppMode] = useState<'full' | 'lancamento'>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("app") === "lancamento" || params.get("mode") === "lancador") {
        return "lancamento";
      }
    }
    return "full";
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'sisref' | 'sigrh' | 'importar' | 'vida' | 'produtividade' | 'balcao' | 'relatorio'>('dashboard');
  const [sisrefSubTab, setSisrefSubTab] = useState<'setores' | 'avulsa' | 'respostas'>('setores');
  const [rotinaSubTab, setRotinaSubTab] = useState<'importar' | 'vida' | 'produtividade'>('importar');
  const [sisrefShowPendencias, setSisrefShowPendencias] = useState(false);
  
  // Theme state: claro, escuro, petroleo
  const [theme, setTheme] = useState<'claro' | 'escuro' | 'petroleo'>(() => {
    return (localStorage.getItem("ss_tema") as any) || "claro";
  });

  // Global custom toasts list state
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null);
  const [toastTimer, setToastTimer] = useState<any>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err' | 'info' = 'ok') => {
    setToastTimer((prev: any) => {
      if (prev) clearTimeout(prev);
      return setTimeout(() => {
        setToast(null);
      }, 3500);
    });
    setToast({ msg, type });
  }, []);

  // Launch quantities active check modal state
  const [launchModal, setLaunchModal] = useState<{
    show: boolean;
    nome: string;
    mat: string;
    setor: string;
    defaultQtd: number;
    onConfirm: (qtd: number) => void;
  } | null>(null);

  const [inputVal, setInputVal] = useState("");
  const [showCloudModal, setShowCloudModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { 
    state, 
    updateState, 
    forceSync, 
    forcePushThisDeviceToCloud,
    forcePullFromCloud,
    syncing, 
    isStaticMode, 
    cloudSynced,
    exportBackupJson,
    importBackupJson
  } = useSyncState(showToast);

  // Google Authentication State
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Google Sheets Auto-Sync States
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleDirty, setGoogleDirty] = useState(false);

  // Mark Google Sheets as dirty when local state changes
  useEffect(() => {
    if (googleToken && state.config.spreadsheetId) {
      setGoogleDirty(true);
    }
  }, [state, googleToken, state.config.spreadsheetId]);

  // Debounced auto-sync to Google Sheets in the background
  useEffect(() => {
    if (!googleDirty || !googleToken || !state.config.spreadsheetId || googleSyncing) {
      return;
    }

    const timer = setTimeout(async () => {
      setGoogleSyncing(true);
      try {
        await syncToGoogleSheets(googleToken, state, state.config.spreadsheetId);
        setGoogleDirty(false);
      } catch (err) {
        console.warn("Background auto-sync failed:", err);
      } finally {
        setGoogleSyncing(false);
      }
    }, 4000);

    return () => clearTimeout(timer);
  }, [googleDirty, googleToken, state, googleSyncing]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setGoogleUser(user);
      if (!user) {
        setGoogleToken(null);
      }
    });
    return () => unsub();
  }, []);

  const handleGoogleLogin = async () => {
    if (isLoggingIn) return null;
    setIsLoggingIn(true);
    try {
      const { user, token } = await loginWithGoogle();
      setGoogleUser(user);
      setGoogleToken(token);
      showToast(`Conectado como ${user.displayName || user.email}!`, "ok");
      return token;
    } catch (err: any) {
      console.error("Login error:", err);
      showToast("Falha no login com Google. Tente novamente.", "err");
      return null;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await logoutFirebase();
      setGoogleUser(null);
      setGoogleToken(null);
      showToast("Desconectado do Google.", "info");
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  // Password-lock verification state
  const [authenticated, setAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem("ngpesp_auth") === "true";
  });
  const [enteredPass, setEnteredPass] = useState("");
  const [passError, setPassError] = useState(false);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    root.classList.remove("theme-claro", "theme-escuro", "theme-petroleo", "dark");
    document.body.classList.remove("theme-claro", "theme-escuro", "theme-petroleo", "dark");
    
    if (theme === "escuro") {
      root.classList.add("theme-escuro", "dark");
      document.body.classList.add("theme-escuro", "dark");
    } else if (theme === "petroleo") {
      root.classList.add("theme-petroleo", "dark");
      document.body.classList.add("theme-petroleo", "dark");
    } else {
      root.classList.add("theme-claro");
      document.body.classList.add("theme-claro");
    }
    localStorage.setItem("ss_tema", theme);
  }, [theme]);

  // Password verification logic
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPassword = state.config.appPassword || "456321";
    if (enteredPass.trim() === correctPassword) {
      setAuthenticated(true);
      sessionStorage.setItem("ngpesp_auth", "true");
      setPassError(false);
      showToast("Acesso concedido ao sistema!", "ok");
    } else {
      setPassError(true);
      showToast("Senha incorreta. Tente novamente.", "err");
    }
  };

  const handleLockSystem = () => {
    setAuthenticated(false);
    sessionStorage.removeItem("ngpesp_auth");
    setEnteredPass("");
    showToast("Sistema bloqueado por segurança.", "info");
  };

  // Modal confirm helper
  const handleModalConfirm = () => {
    if (!launchModal) return;
    const qtd = parseInt(inputVal, 10);
    launchModal.onConfirm(isNaN(qtd) ? 0 : qtd);
    setLaunchModal(null);
    setInputVal("");
  };

  const handleModalSkip = () => {
    if (!launchModal) return;
    launchModal.onConfirm(0);
    setLaunchModal(null);
    setInputVal("");
  };

  const triggerModalOpen = (nome: string, mat: string, setor: string, onConfirm: (qtd: number) => void, defaultQtd: number = 0) => {
    setInputVal(String(defaultQtd || 0));
    setLaunchModal({
      show: true,
      nome,
      mat,
      setor,
      defaultQtd,
      onConfirm
    });
  };

  const toggleTheme = () => {
    if (theme === "claro") setTheme("escuro");
    else if (theme === "escuro") setTheme("petroleo");
    else setTheme("claro");
  };

  const getSheetIdDisplay = () => {
    if (!state.config.spreadsheetId) return "Sem Planilha Vinculada";
    return `Planilha: ${state.config.spreadsheetId.substring(0, 8)}...`;
  };

  // Dedicated Launch App Mode
  if (appMode === 'lancamento') {
    return (
      <LancamentoApp 
        state={state} 
        updateState={updateState} 
        onToast={showToast}
        openModal={triggerModalOpen}
        onSwitchToFullApp={() => {
          setAppMode('full');
          const url = new URL(window.location.href);
          url.searchParams.delete('app');
          url.searchParams.delete('mode');
          window.history.pushState({}, '', url.toString());
        }}
        theme={theme}
        setTheme={setTheme}
        forceSync={forceSync}
        forcePushThisDeviceToCloud={forcePushThisDeviceToCloud}
        forcePullFromCloud={forcePullFromCloud}
        syncing={syncing}
        cloudSynced={cloudSynced}
      />
    );
  }

  // 0. LOCK SCREEN COMPONENT
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4 font-sans transition-colors duration-300">
        <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-[var(--blue-mid)] rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-[var(--blue-mid)]/20 mb-4">
              NG
            </div>
            <h1 className="text-xl font-black text-[var(--text)] tracking-tight">
              NGPESP Rotina & Fila
            </h1>
            <p className="text-xs text-[var(--text2)] font-semibold mt-1 max-w-xs">
              Módulo de Gestão Funcional, SISREF, Balcão e Produtividade
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <div>
              <label className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider block mb-2">
                Senha de Acesso ao Sistema
              </label>
              <div className="relative">
                <input 
                  type="password" 
                  value={enteredPass}
                  onChange={(e) => {
                    setEnteredPass(e.target.value);
                    setPassError(false);
                  }}
                  placeholder="Digite a senha numérica (padrão: 456321)"
                  autoFocus
                  className={`w-full px-4 py-3.5 bg-[var(--bg)] border-2 rounded-xl text-center font-mono text-base font-bold outline-none transition-all text-[var(--text)]
                    ${passError ? 'border-red-500 bg-red-500/5 focus:border-red-600' : 'border-[var(--border2)] focus:border-[var(--blue-mid)]'}`}
                />
              </div>
              {passError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500 font-bold mt-2 animate-shake">
                  <AlertTriangle size={14} /> Senha incorreta.
                </div>
              )}
            </div>

            <button 
              type="submit"
              className="w-full py-3.5 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white font-bold text-sm rounded-xl shadow-lg shadow-[var(--blue-mid)]/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              <ShieldCheck size={18} /> Entrar no Sistema
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[var(--border2)] flex items-center justify-between text-[11px] text-[var(--text2)] font-semibold">
            <span>Segurança NGPESP</span>
            <span className="font-mono text-[var(--blue-mid)]">v4.0.2</span>
          </div>
        </div>

        {toast && (
          <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-3.5 bg-[var(--surface)] border border-[var(--border2)] rounded-full shadow-lg font-bold text-xs select-none transition-all duration-300 animate-bounce
            ${toast.type === 'ok' ? 'border-[var(--green-mid)] text-[var(--green-mid)]' : 
              toast.type === 'err' ? 'border-[var(--red)] text-[var(--red)]' : 
              'border-[var(--blue-mid)] text-[var(--blue-mid)]'}`}>
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-[var(--bg)] transition-colors duration-300">
      
      {/* 1. TOP HEADER NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-[var(--surface)] border-b border-[var(--border)] shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[var(--blue-mid)] rounded-xl flex items-center justify-center text-white font-black text-lg shadow-sm">
              NG
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-[var(--text)] uppercase tracking-tight leading-none">
                NGPESP Rotina
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full animate-pulse ${cloudSynced ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                <p className="text-[10px] text-[var(--text2)] uppercase tracking-wider font-bold opacity-80">
                  {cloudSynced ? "Nuvem Firestore Ativa (Multi-Dispositivo)" : "Sincronizando Nuvem..."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Direct Cloud Sync Center Button */}
            <button
              onClick={() => setShowCloudModal(true)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-xs ${
                cloudSynced
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 animate-pulse"
              }`}
              title="Central de Sincronização em Nuvem Multi-Dispositivo"
            >
              <Cloud size={15} />
              <span className="hidden sm:inline">Nuvem</span>
              {syncing && <RefreshCw size={12} className="animate-spin" />}
            </button>

            {/* Google Authentication Pill */}
            {googleUser ? (
              <button
                onClick={() => {
                  setActiveTab('importar');
                }}
                className={`hidden sm:flex items-center gap-2 p-1.5 pr-3 rounded-xl transition-all text-xs font-bold cursor-pointer border ${
                  googleSyncing
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 animate-pulse"
                    : googleDirty
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                    : "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                }`}
                title={`Conectado como ${googleUser.email}.`}
              >
                {googleUser.photoURL ? (
                  <img src={googleUser.photoURL} alt={googleUser.displayName} referrerPolicy="no-referrer" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-[9px] font-black">
                    {googleUser.email?.[0]?.toUpperCase()}
                  </div>
                )}
                <span className="hidden md:inline">
                  {googleSyncing ? "Salvando..." : googleDirty ? "Pendente" : "Planilha OK"}
                </span>
              </button>
            ) : null}

            {/* Theme trigger button cycle */}
            <button 
              onClick={toggleTheme}
              className="p-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] hover:bg-[var(--bg)]/40 transition-all text-[var(--text)] cursor-pointer"
              title="Alternar tema de cores"
            >
              {theme === "claro" ? <Moon size={18} /> : 
               theme === "escuro" ? <Droplet className="text-[var(--blue-mid)]" size={18} /> : <Sun className="text-[var(--amber-mid)]" size={18} />}
            </button>

            {/* Lock / Logout system button */}
            <button
              onClick={handleLockSystem}
              className="p-2 border border-red-200 hover:bg-red-500/10 text-red-500 rounded-xl bg-[var(--surface)] transition-all cursor-pointer"
              title="Bloquear / Sair do Sistema"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN GRID LAYOUT CONTROLLER */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR TABS */}
        <nav 
          onWheel={(e) => {
            if (e.deltaY !== 0 && window.innerWidth < 1024) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          className="flex lg:flex-col lg:w-56 overflow-x-auto whitespace-nowrap lg:whitespace-normal gap-1.5 p-2 bg-[var(--border)]/40 border border-[var(--border)] rounded-2xl lg:self-start lg:sticky lg:top-24 select-none flex-shrink-0 w-full lg:w-auto transition-all pb-3 lg:pb-2"
        >
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'dashboard' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <LayoutDashboard size={18} /> Início
          </button>
          <button 
            onClick={() => setActiveTab('sisref')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'sisref' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <ClipboardCheck size={18} /> SISREF
          </button>
          <button 
            onClick={() => setActiveTab('sigrh')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'sigrh' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <CalendarDays size={18} /> SIGRH
          </button>
          <button 
            onClick={() => setActiveTab('produtividade')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'produtividade' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <TrendingUp size={18} /> Produtividade
          </button>
          <button 
            onClick={() => setActiveTab('balcao')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'balcao' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <HelpCircle size={18} /> Balcão
          </button>
          <button 
            onClick={() => setActiveTab('relatorio')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'relatorio' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <BarChart3 size={18} /> Relatórios
          </button>
          <button 
            onClick={() => setActiveTab('vida')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'vida' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <Contact size={18} /> Vida Funcional
          </button>
          <button 
            onClick={() => setActiveTab('importar')}
            className={`flex-shrink-0 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'importar' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <Wrench size={18} /> Manutenção
          </button>
        </nav>

        {/* ACTIVE MAIN SUB-PANEL DISPLAY */}
        <main className="flex-1 min-w-0">
          {activeTab === 'dashboard' && (
            <Dashboard 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
              setActiveTab={setActiveTab} 
              setSisrefSubTab={setSisrefSubTab}
              setRotinaSubTab={setRotinaSubTab}
              setSisrefShowPendencias={setSisrefShowPendencias}
            />
          )}
          {activeTab === 'sisref' && (
            <SisrefPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
              openModal={triggerModalOpen} 
              subTab={sisrefSubTab}
              setSubTab={setSisrefSubTab}
              showPendencias={sisrefShowPendencias}
              setShowPendencias={setSisrefShowPendencias}
            />
          )}
          {activeTab === 'sigrh' && (
            <SigrhPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
            />
          )}
          {(activeTab === 'importar' || activeTab === 'vida' || activeTab === 'produtividade') && (
            <RotinaPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
              forceSync={forceSync} 
              syncing={syncing} 
              googleUser={googleUser}
              googleToken={googleToken}
              onGoogleLogin={handleGoogleLogin}
              onGoogleLogout={handleGoogleLogout}
              subTab={activeTab}
              setSubTab={(t) => setActiveTab(t as any)}
              forcePushThisDeviceToCloud={forcePushThisDeviceToCloud}
              forcePullFromCloud={forcePullFromCloud}
              exportBackupJson={exportBackupJson}
              importBackupJson={importBackupJson}
            />
          )}
          {activeTab === 'balcao' && (
            <BalcaoPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
            />
          )}
          {activeTab === 'relatorio' && (
            <RelatorioPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
            />
          )}
        </main>
      </div>

      {/* FOOTER BAR */}
      <footer className="h-12 bg-[var(--surface)] border-t border-[var(--border)] px-6 flex items-center justify-between text-[10px] text-[var(--text2)] opacity-80 font-bold flex-shrink-0 transition-colors duration-300">
        <div className="flex gap-4">
          <span>{getSheetIdDisplay().toUpperCase()}</span>
          <span className="text-[var(--border)]">|</span>
          <span>SISTEMA NGPESP v4.0.2 • Criado por Thiago Vinícius</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></div>
          <span>ESTADO: OPERACIONAL (NUVEM ATIVA)</span>
        </div>
      </footer>

      {/* CLOUD MULTI-DEVICE SYNC MODAL */}
      {showCloudModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-[var(--surface)] w-full max-w-lg rounded-3xl p-6 sm:p-7 shadow-2xl border border-[var(--border)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Cloud size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-[var(--text)] tracking-tight">
                    Central de Sincronização em Nuvem
                  </h3>
                  <p className="text-xs text-[var(--text2)] font-semibold">
                    Multi-Dispositivo em Tempo Real (Computadores & Celulares)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloudModal(false)}
                className="p-1.5 rounded-xl text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Current Device Stats */}
            <div className="p-4 rounded-2xl bg-[var(--bg)] border border-[var(--border2)] grid grid-cols-3 gap-2 text-center mb-5">
              <div>
                <div className="text-lg font-black text-[var(--blue-mid)]">
                  {state.servidores?.length || 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--text2)]">
                  Servidores
                </div>
              </div>
              <div>
                <div className="text-lg font-black text-amber-500">
                  {state.filaAvulsa?.listas?.[state.filaAvulsa?.ativa || "Padrão"]?.fila?.length || 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--text2)]">
                  Fila SISREF
                </div>
              </div>
              <div>
                <div className="text-lg font-black text-emerald-500">
                  {state.historico?.length || 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--text2)]">
                  Histórico
                </div>
              </div>
            </div>

            {/* Main Action 1: Upload from this machine */}
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <UploadCloud size={16} /> 1. Enviar Dados deste Computador para a Nuvem
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    Recomendado
                  </span>
                </div>
                <p className="text-xs text-[var(--text2)] leading-relaxed font-semibold">
                  Clique aqui no computador onde você tem todos os dados reais (servidores, pendências e histórico) para torná-los imediatamente disponíveis em qualquer outro aparelho ou celular.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await forcePushThisDeviceToCloud();
                  }}
                  disabled={syncing}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  <UploadCloud size={16} />
                  <span>{syncing ? "Gravando na Nuvem..." : "Salvar Este Computador na Nuvem Agora"}</span>
                </button>
              </div>

              {/* Main Action 2: Download on secondary machine */}
              <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/20 flex flex-col gap-2.5">
                <span className="text-xs font-black uppercase text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <RefreshCw size={15} /> 2. Baixar Dados Mais Recentes da Nuvem
                </span>
                <p className="text-xs text-[var(--text2)] leading-relaxed font-semibold">
                  Use esta opção no seu celular ou em outro computador secundário para carregar instantaneamente o estado completo salvo na nuvem.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await forcePullFromCloud();
                  }}
                  disabled={syncing}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
                  <span>{syncing ? "Buscando na Nuvem..." : "Baixar Dados da Nuvem para Este Dispositivo"}</span>
                </button>
              </div>

              {/* Direct JSON Backup Options */}
              <div className="pt-2 border-t border-[var(--border2)] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={exportBackupJson}
                  className="flex-1 py-2 px-3 bg-[var(--bg)] hover:bg-[var(--border2)] border border-[var(--border2)] text-[var(--text)] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <FileDown size={14} />
                  <span>Baixar Arquivo JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 px-3 bg-[var(--bg)] hover:bg-[var(--border2)] border border-[var(--border2)] text-[var(--text)] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <FileUp size={14} />
                  <span>Restaurar Arquivo JSON</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      importBackupJson(file);
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCloudModal(false)}
                className="px-5 py-2.5 bg-[var(--border2)] hover:bg-[var(--border)] text-[var(--text)] font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. MODAL FOR PROCESSED LAUNCH QUANTITY INPUTS */}
      {launchModal?.show && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-[var(--surface)] w-full max-w-sm rounded-2xl p-6 shadow-xl border border-[var(--border)] animate-in fade-in zoom-in duration-200">
            <h3 className="text-base font-black text-[var(--text)] tracking-tight">
              {launchModal.nome}
            </h3>
            <span className="text-xs font-semibold text-[var(--blue-mid)] font-mono block mt-1">
              Matrícula: {launchModal.mat} {launchModal.setor ? `· ${launchModal.setor}` : ""}
            </span>
            
            <div className="mt-5">
              <label className="text-xs font-bold text-[var(--text2)] block mb-1.5">
                Quantidade de lançamentos efetuados
              </label>
              <input 
                type="number" 
                min={0}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleModalConfirm();
                }}
                className="w-full text-center text-3xl font-black p-3 bg-[var(--bg)] border-2 border-[var(--border2)] rounded-xl outline-none text-[var(--text)]"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                onClick={handleModalSkip}
                className="flex-1 py-3 text-xs font-bold border border-[var(--border2)] hover:bg-[var(--bg)] rounded-xl text-[var(--text)]"
              >
                Pular
              </button>
              <button 
                onClick={handleModalConfirm}
                className="flex-2 py-3 text-xs font-bold bg-[var(--blue-mid)] text-white hover:bg-[var(--blue)] rounded-xl shadow-md"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. NOTIFICATION TOAST POPUP BANNER */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-3.5 bg-[var(--surface)] border border-[var(--border2)] rounded-full shadow-lg font-bold text-xs select-none transition-all duration-300 animate-bounce
          ${toast.type === 'ok' ? 'border-[var(--green-mid)] text-[var(--green-mid)]' : 
            toast.type === 'err' ? 'border-[var(--red)] text-[var(--red)]' : 
            'border-[var(--blue-mid)] text-[var(--blue-mid)]'}`}>
          {toast.msg}
        </div>
      )}

    </div>
  );
}
