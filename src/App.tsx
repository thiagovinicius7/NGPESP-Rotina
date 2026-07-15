import React, { useState, useEffect } from "react";
import { useSyncState } from "./hooks/useSyncState.js";
import SisrefPanel from "./components/SisrefPanel.js";
import SigrhPanel from "./components/SigrhPanel.js";
import RotinaPanel from "./components/RotinaPanel.js";
import BalcaoPanel from "./components/BalcaoPanel.js";
import RelatorioPanel from "./components/RelatorioPanel.js";
import { 
  ClipboardCheck, CalendarDays, Briefcase, BarChart3, HelpCircle, 
  Layers, Moon, Sun, Droplet, RefreshCw, Check, X 
} from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<'sisref' | 'sigrh' | 'rotina' | 'balcao' | 'relatorio'>('sisref');
  
  // Theme state: claro, escuro, petroleo
  const [theme, setTheme] = useState<'claro' | 'escuro' | 'petroleo'>(() => {
    return (localStorage.getItem("ss_tema") as any) || "claro";
  });

  // Global custom toasts list state
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null);
  const [toastTimer, setToastTimer] = useState<any>(null);

  const showToast = (msg: string, type: 'ok' | 'err' | 'info' = 'ok') => {
    if (toastTimer) clearTimeout(toastTimer);
    setToast({ msg, type });
    const timer = setTimeout(() => {
      setToast(null);
    }, 3200);
    setToastTimer(timer);
  };

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

  const { state, updateState, forceSync, syncing } = useSyncState(showToast);

  // Apply theme to document documentElement element
  useEffect(() => {
    document.documentElement.setAttribute("data-tema", theme);
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ss_tema", theme);
  }, [theme]);

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
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <p className="text-[10px] text-[var(--text2)] uppercase tracking-wider font-bold opacity-80">
                  Sincronizado via Nuvem
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme trigger button cycle */}
            <button 
              onClick={toggleTheme}
              className="p-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] hover:bg-[var(--bg)]/40 transition-all text-[var(--text)] cursor-pointer"
              title="Alternar tema de cores"
            >
              {theme === "claro" ? <Moon size={18} /> : 
               theme === "escuro" ? <Droplet className="text-[var(--blue-mid)]" size={18} /> : <Sun className="text-[var(--amber-mid)]" size={18} />}
            </button>

            {/* Manual syncing cloud indicator */}
            <button 
              onClick={forceSync}
              disabled={syncing}
              className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN GRID LAYOUT CONTROLLER */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR TABS (sticky on desktop) */}
        <nav className="flex lg:flex-col lg:w-56 overflow-x-auto lg:overflow-x-visible gap-1.5 p-1 bg-[var(--border)]/40 border border-[var(--border)] rounded-2xl lg:self-start lg:sticky lg:top-24 select-none scrollbar-none flex-shrink-0">
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
            onClick={() => setActiveTab('rotina')}
            className={`flex-1 lg:flex-none py-3 px-4 text-xs font-bold rounded-xl flex items-center justify-center lg:justify-start gap-2.5 transition-all cursor-pointer ${activeTab === 'rotina' ? 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] shadow-xs' : 'text-[var(--text2)] hover:bg-[var(--surface)]/30'}`}
          >
            <Briefcase size={18} /> Rotina
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
          {activeTab === 'sisref' && (
            <SisrefPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
              openModal={triggerModalOpen} 
            />
          )}
          {activeTab === 'sigrh' && (
            <SigrhPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
            />
          )}
          {activeTab === 'rotina' && (
            <RotinaPanel 
              state={state} 
              updateState={updateState} 
              onToast={showToast} 
              forceSync={forceSync} 
              syncing={syncing} 
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
