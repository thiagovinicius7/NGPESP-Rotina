import React, { useState, useEffect, useCallback } from "react";
import { useSyncState } from "./hooks/useSyncState.js";
import Dashboard from "./components/Dashboard.js";
import SisrefPanel from "./components/SisrefPanel.js";
import SigrhPanel from "./components/SigrhPanel.js";
import RotinaPanel from "./components/RotinaPanel.js";
import BalcaoPanel from "./components/BalcaoPanel.js";
import RelatorioPanel from "./components/RelatorioPanel.js";
import { 
  ClipboardCheck, CalendarDays, Briefcase, BarChart3, HelpCircle, 
  Layers, Moon, Sun, Droplet, RefreshCw, Check, X, LogIn, LogOut, Key,
  DownloadCloud, LayoutDashboard, UploadCloud, Contact, TrendingUp
} from "lucide-react";
import { initAuth, googleSignIn, logout } from "./lib/firebaseAuth.js";
import { syncToGoogleSheets, searchGoogleDriveForBackup, loadFullStateFromBackup, DEFAULT_SPREADSHEET_ID } from "./lib/googleSheetsSync.js";

export default function App() {
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
    setToastTimer(prev => {
      if (prev) clearTimeout(prev);
      return setTimeout(() => {
        setToast(null);
      }, 3200);
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

  const { state, updateState, forceSync, syncing, isStaticMode } = useSyncState(showToast);

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
        await syncToGoogleSheets(googleToken, state, state.config.spreadsheetId, () => {});
        setGoogleDirty(false);
        console.log("Auto-backup sincronizado no Google Sheets com sucesso.");
      } catch (err) {
        console.warn("Erro no auto-backup em segundo plano para Google Sheets:", err);
      } finally {
        setGoogleSyncing(false);
      }
    }, 8000); // Debounce de 8 segundos sem alterações para não sobrecarregar a API

    return () => clearTimeout(timer);
  }, [googleDirty, googleToken, state.config.spreadsheetId, state, googleSyncing]);

  // Alerta ao usuário antes de fechar a página se houver sincronização pendente
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (googleDirty) {
        e.preventDefault();
        e.returnValue = "Existem dados pendentes que estão sendo salvos no Google Sheets. Tem certeza de que deseja sair?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [googleDirty]);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async (): Promise<string | null> => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setGoogleToken(result.accessToken);
        showToast(`Conectado como ${result.user.email}!`, "ok");

        const targetSheetId = state.config.spreadsheetId || DEFAULT_SPREADSHEET_ID;
        try {
          showToast("Sincronizando dados com a planilha de backup do Google Drive...", "info");
          const fullData = await loadFullStateFromBackup(result.accessToken, targetSheetId, () => {});

          updateState(prev => {
            const existingMap = new Map();
            prev.servidores.forEach(s => {
              const norm = s.matricula ? String(s.matricula).trim().replace(/[^a-zA-Z0-9]/g, "").replace(/^0+/, "") : "";
              if (norm) existingMap.set(norm, s);
            });

            (fullData.servidores || []).forEach(srv => {
              const norm = srv.matricula ? String(srv.matricula).trim().replace(/[^a-zA-Z0-9]/g, "").replace(/^0+/, "") : "";
              if (norm) {
                if (existingMap.has(norm)) {
                  const existingSrv = existingMap.get(norm);
                  existingMap.set(norm, { ...existingSrv, ...srv, matricula: existingSrv.matricula });
                } else {
                  existingMap.set(norm, srv);
                }
              }
            });

            const histSet = new Set(prev.historico.map(h => `${h.mat}_${h.ts}`));
            const newHist = [...prev.historico];
            (fullData.historico || []).forEach(h => {
              const key = `${h.mat}_${h.ts}`;
              if (!histSet.has(key)) {
                histSet.add(key);
                newHist.push(h);
              }
            });

            const respMap = new Map(prev.respostas.map(r => [r.nome, r.texto]));
            (fullData.respostas || []).forEach(r => { if (r.nome) respMap.set(r.nome, r.texto); });

            const afastSet = new Set(prev.afastamentos.map(a => `${a.dia}_${a.mes}_${a.tipo}_${a.sisref}`));
            const newAfast = [...prev.afastamentos];
            (fullData.afastamentos || []).forEach(a => {
              const key = `${a.dia}_${a.mes}_${a.tipo}_${a.sisref}`;
              if (!afastSet.has(key)) { afastSet.add(key); newAfast.push(a); }
            });

            const faqMap = new Map(prev.faq.map(f => [f.titulo, f.resposta]));
            (fullData.faq || []).forEach(f => { if (f.titulo) faqMap.set(f.titulo, f.resposta); });

            const codMap = new Map(prev.codigos.map(c => [c.num, c]));
            (fullData.codigos || []).forEach(c => { if (c.num) codMap.set(c.num, c); });

            const seiMap = new Map(prev.sei.map(s => [s.num, s]));
            (fullData.sei || []).forEach(s => { if (s.num) seiMap.set(s.num, s); });

            const importedMatriculas = (fullData.servidores || []).map(s => s.matricula ? String(s.matricula).trim().replace(/[^a-zA-Z0-9]/g, "").replace(/^0+/, "") : "").filter(Boolean);
            const importedCount = (fullData.servidores || []).length;
            const dateStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

            return {
              servidores: Array.from(existingMap.values()),
              historico: newHist,
              respostas: Array.from(respMap.entries()).map(([nome, texto]) => ({ nome, texto })),
              afastamentos: newAfast,
              faq: Array.from(faqMap.entries()).map(([titulo, resposta]) => ({ titulo, resposta })),
              produtividade: Object.keys(fullData.produtividade || {}).length ? fullData.produtividade : prev.produtividade,
              filaAvulsa: (fullData.filaAvulsa && fullData.filaAvulsa.listas && Object.keys(fullData.filaAvulsa.listas).length) ? fullData.filaAvulsa : prev.filaAvulsa,
              codigos: Array.from(codMap.values()),
              sei: Array.from(seiMap.values()),
              ferias: Object.keys(fullData.ferias || {}).length ? fullData.ferias : prev.ferias,
              abonos: Object.keys(fullData.abonos || {}).length ? fullData.abonos : prev.abonos,
              balcaoAtendimentos: Object.keys(fullData.balcaoAtendimentos || {}).length ? fullData.balcaoAtendimentos : prev.balcaoAtendimentos,
              config: {
                ...prev.config,
                ...(fullData.config || {}),
                spreadsheetId: targetSheetId,
                backupEnabled: true,
                ultimoUpdateServidores: importedCount ? `${dateStr} (${importedCount} servidores)` : prev.config.ultimoUpdateServidores,
                lastImportedMatriculas: importedMatriculas.length ? importedMatriculas : prev.config.lastImportedMatriculas,
                lastImportCount: importedCount || prev.config.lastImportCount
              }
            };
          });

          showToast(`Dados da planilha vinculada restaurados com sucesso!`, "ok");
        } catch (autoErr) {
          console.warn("Auto-restore warning:", autoErr);
        }

        return result.accessToken;
      }
    } catch (err: any) {
      console.error(err);
      showToast("Erro ao conectar com Google", "err");
    } finally {
      setIsLoggingIn(false);
    }
    return null;
  };

  const handleGoogleLogout = async () => {
    try {
      if (googleToken && state.config.spreadsheetId) {
        showToast("Sincronizando dados finais no Google Sheets...", "info");
        try {
          await syncToGoogleSheets(googleToken, state, state.config.spreadsheetId, () => {});
          showToast("Dados finais sincronizados!", "ok");
        } catch (err: any) {
          console.error("Erro ao sincronizar dados finais:", err);
          showToast(`Erro na sincronização: ${err.message || err}`, "err");
          if (!confirm("Não foi possível realizar o backup final. Deseja desconectar mesmo assim?")) {
            return;
          }
        }
      }
      await logout();
      setGoogleUser(null);
      setGoogleToken(null);
      setGoogleDirty(false);
      showToast("Conexão Google encerrada", "info");
    } catch (err) {
      showToast("Falha ao desconectar", "err");
    }
  };

  // Apply theme to document documentElement element
  useEffect(() => {
    document.documentElement.setAttribute("data-tema", theme);
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ss_tema", theme);
  }, [theme]);

  // System Passcode Authorization State
  const [isAuthorized, setIsAuthorized] = useState(() => {
    return sessionStorage.getItem("ngpesp_authorized") === "true";
  });
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const systemPassword = state.config.appPassword || "456321";
    if (passwordInput === systemPassword) {
      sessionStorage.setItem("ngpesp_authorized", "true");
      setIsAuthorized(true);
      setLoginError("");
      showToast("Acesso autorizado com sucesso!", "ok");
    } else {
      setLoginError("Senha incorreta. Tente novamente.");
      showToast("Senha incorreta!", "err");
    }
  };

  const handleLockSystem = async () => {
    if (googleToken && state.config.spreadsheetId && googleDirty) {
      showToast("Sincronizando dados no Google Sheets antes de bloquear...", "info");
      try {
        await syncToGoogleSheets(googleToken, state, state.config.spreadsheetId, () => {});
        setGoogleDirty(false);
      } catch (err: any) {
        console.error("Erro ao sincronizar antes de bloquear:", err);
      }
    }
    sessionStorage.removeItem("ngpesp_authorized");
    setIsAuthorized(false);
    setPasswordInput("");
    showToast("Sistema bloqueado com sucesso.", "info");
  };

  const handleDownloadBackupDirectly = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dt = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `sisref_backup_${dt}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup baixado para a máquina local!", "ok");
  };

  const toggleTheme = () => {
    setTheme(prev => {
      if (prev === "claro") return "escuro";
      if (prev === "escuro") return "petroleo";
      return "claro";
    });
  };

  const triggerModalOpen = (nome: string, mat: string, setor: string, onConfirm: (qtd: number) => void, defaultQtd: number = 0) => {
    setInputVal(defaultQtd > 0 ? String(defaultQtd) : "");
    setLaunchModal({
      show: true,
      nome,
      mat,
      setor,
      defaultQtd,
      onConfirm
    });
  };

  const handleModalConfirm = () => {
    if (!launchModal) return;
    const finalVal = parseInt(inputVal) || 0;
    launchModal.onConfirm(finalVal);
    setLaunchModal(null);
  };

  const handleModalSkip = () => {
    if (!launchModal) return;
    launchModal.onConfirm(0);
    setLaunchModal(null);
  };

  const getSheetIdDisplay = () => {
    if (!state.gasUrl) return "NÃO CONFIGURADO";
    const match = state.gasUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      const fullId = match[1];
      return `ID: ${fullId.substring(0, 8)}...${fullId.substring(fullId.length - 6)}`;
    }
    return "CONECTADO";
  };

  // If not authorized, show a secure, beautiful passcode login screen
  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] p-4 font-sans select-none transition-colors duration-300">
        
        {/* Ambient background glows */}
        <div className="absolute top-10 left-10 w-72 h-72 bg-blue-500/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-10 right-10 w-72 h-72 bg-emerald-500/10 dark:bg-emerald-600/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-[var(--surface)] border-2 border-[var(--border2)] rounded-3xl p-8 shadow-2xl relative z-10 animate-in fade-in slide-in-from-bottom-6 duration-300">
          
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 bg-[var(--blue-mid)] rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-md mb-4">
              NG
            </div>
            <h1 className="text-xl font-black text-[var(--text)] uppercase tracking-tight">
              NGPESP Rotina
            </h1>
            <p className="text-[10px] font-black text-[var(--text2)] uppercase tracking-widest mt-1 opacity-80">
              Painel de Gestão Operacional
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-[var(--text2)] uppercase tracking-wider mb-2 text-center">
                Digite a senha de acesso ao sistema
              </label>
              <div className="relative">
                <input
                  type={passwordVisible ? "text" : "password"}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="******"
                  className="w-full text-center text-xl font-black tracking-widest p-3 bg-[var(--bg)] border-2 border-[var(--border2)] rounded-xl outline-none focus:border-[var(--blue-mid)] transition-colors duration-200 text-[var(--text)]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible(!passwordVisible)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-[var(--text2)] hover:text-[var(--text)] cursor-pointer"
                >
                  {passwordVisible ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              {loginError && (
                <p className="text-xs text-red-500 font-extrabold mt-2 text-center">
                  {loginError}
                </p>
              )}
            </div>

            {/* Quick tactile keypad for tablet and mouse ease */}
            <div className="bg-[var(--bg)] p-3 rounded-2xl border border-[var(--border2)]">
              <div className="text-[9px] text-[var(--text2)] font-black text-center uppercase tracking-wider mb-2">
                Teclado Numérico de Acesso
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setPasswordInput(prev => prev + num)}
                    className="py-2.5 text-xs font-black bg-[var(--surface)] hover:bg-[var(--border)] border border-[var(--border2)] rounded-xl text-[var(--text)] transition-colors active:scale-95 duration-100 cursor-pointer"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPasswordInput("")}
                  className="py-2.5 text-[9px] font-black bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-500 transition-colors cursor-pointer"
                >
                  LIMPAR
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordInput(prev => prev + "0")}
                  className="py-2.5 text-xs font-black bg-[var(--surface)] hover:bg-[var(--border)] border border-[var(--border2)] rounded-xl text-[var(--text)] transition-colors cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordInput(prev => prev.slice(0, -1))}
                  className="py-2.5 text-[9px] font-black bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl text-amber-500 transition-colors cursor-pointer"
                >
                  APAGAR
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white font-extrabold text-xs uppercase tracking-widest rounded-xl shadow-md transition-all duration-200 cursor-pointer"
            >
              Entrar no Sistema
            </button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[9px] text-[var(--text2)] uppercase tracking-wider font-extrabold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Acesso Restrito · Criptografado Localmente
          </div>

        </div>

        {/* Footer info */}
        <p className="mt-6 text-[9px] text-[var(--text2)] font-black uppercase tracking-widest opacity-60">
          NGPESP ROTINA · SISTEMA DE GESTÃO v4.0.2
        </p>

        {/* Toast alerts for wrong password, etc. */}
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
                <span className={`w-2 h-2 rounded-full animate-pulse ${isStaticMode ? 'bg-blue-500' : 'bg-green-500'}`}></span>
                <p className="text-[10px] text-[var(--text2)] uppercase tracking-wider font-bold opacity-80">
                  {isStaticMode ? "Modo Local (GitHub Pages)" : "Sincronizado via Nuvem"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Google Authentication Pill */}
            {googleUser ? (
              <button
                onClick={() => {
                  setActiveTab('rotina');
                  // Since we are moving to Rotina, we'll let them view the Backup section
                }}
                className={`hidden sm:flex items-center gap-2 p-1.5 pr-3 rounded-xl transition-all text-xs font-bold cursor-pointer border ${
                  googleSyncing
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 animate-pulse"
                    : googleDirty
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                    : "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                }`}
                title={`Conectado como ${googleUser.email}. Clique para gerenciar backup.`}
              >
                {googleUser.photoURL ? (
                  <img src={googleUser.photoURL} alt={googleUser.displayName} referrerPolicy="no-referrer" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-[9px] font-black">
                    {googleUser.email?.[0]?.toUpperCase()}
                  </div>
                )}
                <span className="hidden md:inline">
                  {googleSyncing ? "Salvando Backup..." : googleDirty ? "Alterado (Pendente)" : "Backup em Dia"}
                </span>
              </button>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-xl text-gray-700 font-bold text-[11px] transition-all duration-200 cursor-pointer shadow-xs"
                title="Conectar com o Google para backup em tempo real"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                Conectar Google
              </button>
            )}

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

            {/* Manual syncing cloud indicator / static backup download */}
            {isStaticMode ? (
              <button 
                onClick={handleDownloadBackupDirectly}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Fazer download do backup de segurança de todos os dados"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                Baixar Backup
              </button>
            ) : (
              <button 
                onClick={forceSync}
                disabled={syncing}
                className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sincronizar
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. MAIN GRID LAYOUT CONTROLLER */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR TABS (sticky on desktop) */}
        <nav className="flex lg:flex-col lg:w-56 overflow-x-auto lg:overflow-x-visible gap-1.5 p-1 bg-[var(--border)]/40 border border-[var(--border)] rounded-2xl lg:self-start lg:sticky lg:top-24 select-none scrollbar-none flex-shrink-0">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'dashboard' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <LayoutDashboard size={18} /> Início
          </button>
          <button 
            onClick={() => setActiveTab('sisref')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'sisref' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <ClipboardCheck size={18} /> SISREF
          </button>
          <button 
            onClick={() => setActiveTab('sigrh')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'sigrh' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <CalendarDays size={18} /> SIGRH
          </button>
          <button 
            onClick={() => setActiveTab('importar')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'importar' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <UploadCloud size={18} /> Importar & Conexão
          </button>
          <button 
            onClick={() => setActiveTab('vida')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'vida' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <Contact size={18} /> Vida Funcional
          </button>
          <button 
            onClick={() => setActiveTab('produtividade')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'produtividade' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <TrendingUp size={18} /> Produtividade
          </button>
          <button 
            onClick={() => setActiveTab('balcao')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'balcao' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <HelpCircle size={18} /> Balcão
          </button>
          <button 
            onClick={() => setActiveTab('relatorio')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'relatorio' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <BarChart3 size={18} /> Relatório
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
          <span>SISTEMA NGPESP v4.0.2</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping"></div>
          <span>ESTADO: OPERACIONAL</span>
        </div>
      </footer>

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
                className="w-full text-center text-3xl font-black p-3 bg-[var(--bg)] border-2 border-[var(--border2)] rounded-xl outline-none"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                onClick={handleModalSkip}
                className="flex-1 py-3 text-xs font-bold border border-[var(--border2)] hover:bg-[var(--bg)] rounded-xl"
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
