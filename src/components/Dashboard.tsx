import React, { useState, useEffect } from "react";
import { AppState } from "../types.js";
import { 
  Users, Building2, Clock, UserCheck, TrendingUp, PlusCircle, 
  Search, ListTodo, AlertOctagon, PlayCircle, Palmtree, CalendarCheck, Stethoscope, CheckCircle2, Gift,
  X, Trash2, AlertTriangle, FileSpreadsheet
} from "lucide-react";

interface DashboardProps {
  state: AppState;
  updateState: any;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  setActiveTab: (tab: 'dashboard' | 'sisref' | 'sigrh' | 'rotina' | 'balcao' | 'relatorio') => void;
  setSisrefSubTab?: (tab: 'setores' | 'avulsa' | 'respostas') => void;
  setRotinaSubTab?: (tab: 'importar' | 'vida' | 'produtividade') => void;
  setSisrefShowPendencias?: (show: boolean) => void;
}

export default function Dashboard({ state, updateState, onToast, setActiveTab, setSisrefSubTab, setRotinaSubTab, setSisrefShowPendencias }: DashboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [modalSearchTerm, setModalSearchTerm] = useState("");

  const normalizeMatricula = (m: any): string => {
    return String(m || "").trim().replace(/[^a-zA-Z0-9]/g, "").replace(/^0+/, "");
  };

  const lastImportedMatriculas = state.config?.lastImportedMatriculas || [];
  const hasImportedHistory = !!state.config?.ultimoUpdateServidores;

  const absentServers = state.servidores.filter(s => {
    if (!hasImportedHistory || lastImportedMatriculas.length === 0) return false;
    const norm = normalizeMatricula(s.matricula);
    return !lastImportedMatriculas.includes(norm);
  });

  const removerServidor = (matricula: string) => {
    if (confirm(`Deseja realmente remover o servidor com matrícula ${matricula} do aplicativo?`)) {
      updateState((prev: AppState) => {
        const novosServidores = prev.servidores.filter(s => s.matricula !== matricula);
        return { servidores: novosServidores };
      });
      onToast(`Servidor ${matricula} removido com sucesso.`, "ok");
    }
  };

  const removerTodosAusentes = () => {
    if (confirm(`ATENÇÃO! Você está prestes a remover todos os ${absentServers.length} servidores ausentes do aplicativo.\n\nEsta ação sincronizará sua lista de servidores, deixando apenas os servidores que estavam presentes no último arquivo importado.\n\nDeseja continuar?`)) {
      updateState((prev: AppState) => {
        const novosServidores = prev.servidores.filter(s => {
          const norm = normalizeMatricula(s.matricula);
          return lastImportedMatriculas.includes(norm);
        });
        return { servidores: novosServidores };
      });
      onToast(`Todos os ${absentServers.length} servidores ausentes foram removidos com sucesso!`, "ok");
      setShowCompareModal(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000); // atualiza a cada 30s
    return () => clearInterval(timer);
  }, []);

  const totalServidores = state.servidores.length;
  const totalSetores = new Set(state.servidores.map(s => s.codLotacao || s.lotacao)).size;

  const totalLancamentos = state.historico.length;
  const hoje = new Date().toISOString().split('T')[0];
  const lancamentosHoje = state.historico.filter(h => h.ts?.startsWith(hoje)).length;

  const pendenciasAvulsa = state.filaAvulsa?.pendencias?.length || 0;
  const filaAtiva = state.filaAvulsa?.listas?.[state.filaAvulsa?.ativa || "Padrão"] || { fila: [], idx: 0 };
  const servidoresNaFila = filaAtiva.fila.length;

  const diaSemana = currentTime.toLocaleDateString('pt-BR', { weekday: 'long' });
  const horaFormatada = currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Fila Avulsa Progress
  const filaNome = state.filaAvulsa?.ativa || "Padrão";
  const filaIdx = filaAtiva.idx || 0;
  const progressPct = servidoresNaFila > 0 ? Math.min(100, Math.round((filaIdx / servidoresNaFila) * 100)) : 0;

  // Vida Funcional computations
  const currentYear = currentTime.getFullYear().toString();
  const afastamentos = state.afastamentos || [];

  const currentDayStr = currentTime.getDate().toString().padStart(2, "0");
  const currentMonthStr = (currentTime.getMonth() + 1).toString().padStart(2, "0");

  // Gather ALL férias across all years (exercícios)
  const allFerias: { inicio?: string; fim?: string; processo?: string; exercicio: string }[] = [];
  Object.keys(state.ferias || {}).forEach(yr => {
    const list = state.ferias[yr] || [];
    list.forEach(p => {
      if (p.inicio || p.fim) {
        allFerias.push({ ...p, exercicio: yr });
      }
    });
  });
  // Sort them by starting date ascending
  allFerias.sort((a, b) => (a.inicio || "").localeCompare(b.inicio || ""));

  // Gather ALL abonos across all years (exercícios)
  const allAbonos: { data?: string; processo?: string; exercicio: string }[] = [];
  Object.keys(state.abonos || {}).forEach(yr => {
    const list = state.abonos[yr] || [];
    list.forEach(a => {
      if (a.data) {
        allAbonos.push({ ...a, exercicio: yr });
      }
    });
  });
  // Sort them by date ascending
  allAbonos.sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  // Only next upcoming vacation and abono (posterior to today's system date)
  const proximaFeria = allFerias.find(p => p.inicio && p.inicio >= hoje);
  const proximoAbono = allAbonos.find(a => a.data && a.data >= hoje);

  // Check what is active today based on the dates across all years
  const activeFerias = allFerias.filter(p => {
    if (!p.inicio || !p.fim) return false;
    const todayTime = new Date(hoje + "T00:00:00").getTime();
    const startTime = new Date(p.inicio + "T00:00:00").getTime();
    const endTime = new Date(p.fim + "T00:00:00").getTime();
    return todayTime >= startTime && todayTime <= endTime;
  });

  const activeAbono = allAbonos.filter(a => a.data === hoje);

  const activeAfastamento = afastamentos.filter(a => {
    const matchDay = a.dia.padStart(2, "0") === currentDayStr;
    const matchMonth = a.mes.padStart(2, "0") === currentMonthStr || a.mes.toLowerCase().includes(currentMonthStr);
    return matchDay && matchMonth;
  });

  // Only filter servers if the search term is NOT empty (removed default server list "examples")
  const filteredServers = searchTerm.trim() === ""
    ? []
    : state.servidores
        .filter(s => 
          s.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
          s.matricula.includes(searchTerm)
        )
        .slice(0, 6);

  const iniciarConferenciaAvulsaRapida = () => {
    if (setSisrefSubTab) {
      setSisrefSubTab('avulsa');
    }
    setActiveTab('sisref');
    onToast("Abrindo Fila Avulsa no SISREF...", "info");
  };

  const resolverPendenciasAvulsa = () => {
    if (setSisrefSubTab) {
      setSisrefSubTab('avulsa');
    }
    if (setSisrefShowPendencias) {
      setSisrefShowPendencias(true);
    }
    setActiveTab('sisref');
    onToast("Direcionando para as Pendências no SISREF...", "info");
  };

  const irParaVidaFuncional = () => {
    if (setRotinaSubTab) {
      setRotinaSubTab('vida');
    }
    setActiveTab('rotina');
    onToast("Abrindo histórico de Vida Funcional...", "info");
  };

  const irParaAbonoAniversario = () => {
    setActiveTab('sigrh');
    onToast("Abrindo Abono Natalício...", "info");
    setTimeout(() => {
      const el = document.getElementById("abono-natalicio");
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);
  };

  const irParaSigrh = () => {
    setActiveTab('sigrh');
    onToast("Abrindo painel SIGRH...", "info");
  };

  return (
    <div className="space-y-8 pb-12 animate-fade-in">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[var(--blue-mid)] to-indigo-700 text-white rounded-3xl p-10 flex flex-col md:flex-row items-center justify-between shadow-lg">
        <div>
          <h1 className="text-5xl font-black tracking-tighter">NGPESP Rotina</h1>
          <p className="text-xl mt-2 opacity-90">Gestão Operacional • Hospital Regional de Samambaia</p>
        </div>
        <div className="text-right mt-6 md:mt-0">
          <div className="text-6xl font-mono font-black tabular-nums">{horaFormatada}</div>
          <div className="text-lg capitalize opacity-90">{diaSemana}</div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bento-card p-6 flex flex-col justify-between">
          <div>
            <Users size={32} className="text-blue-500 mb-3" />
            <div className="text-5xl font-black text-[var(--text)]">{totalServidores}</div>
            <div className="text-[var(--text2)]">Servidores</div>
          </div>
          {state.config?.ultimoUpdateServidores && (
            <button 
              onClick={() => setShowCompareModal(true)}
              className="w-full text-left text-[10px] text-[var(--text2)] hover:text-[var(--blue-mid)] hover:bg-slate-50 dark:hover:bg-slate-900/40 p-1.5 -mx-1.5 rounded-lg mt-2 font-mono border-t border-[var(--border)] flex items-center justify-between transition-all cursor-pointer group"
              title="Clique para comparar com o último extrator importado"
            >
              <span className="truncate">Ref: {state.config.ultimoUpdateServidores}</span>
              {absentServers.length > 0 ? (
                <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 px-1.5 py-0.5 rounded-full text-[8px] font-bold flex-shrink-0 ml-1">
                  {absentServers.length} ausentes
                </span>
              ) : (
                <span className="opacity-0 group-hover:opacity-100 transition-opacity font-bold text-[8px] text-[var(--blue-mid)] flex-shrink-0 ml-1">
                  Ver detalhes →
                </span>
              )}
            </button>
          )}
        </div>

        <div className="bento-card p-6">
          <Building2 size={32} className="text-teal-500 mb-3" />
          <div className="text-5xl font-black text-[var(--text)]">{totalSetores}</div>
          <div className="text-[var(--text2)]">Setores Ativos</div>
        </div>

        <div className="bento-card p-6 relative overflow-hidden">
          <TrendingUp size={32} className="text-green-500 mb-3" />
          <div className="text-5xl font-black text-[var(--text)]">{totalLancamentos}</div>
          <div className="text-[var(--text2)]">Lançamentos Totais</div>
          <div className="absolute bottom-4 right-4 text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-3 py-1 rounded-full font-bold">
            +{lancamentosHoje} hoje
          </div>
        </div>

        {/* Fila Avulsa Progress (Replaces the old startup block) */}
        <div className="bento-card p-6 flex flex-col justify-between bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20">
          <div>
            <div className="flex justify-between items-start mb-3">
              <ListTodo size={32} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full">
                Fila: {filaNome}
              </span>
            </div>
            <div className="text-4xl font-black text-[var(--text)]">{filaIdx}/{servidoresNaFila}</div>
            <div className="text-xs text-[var(--text2)] font-medium mt-1">Fila Avulsa Conferida</div>
            
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-800 h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[10px] text-right font-semibold text-indigo-600 dark:text-indigo-400 mt-1">
              {progressPct}% concluído
            </div>
          </div>
          <button 
            onClick={iniciarConferenciaAvulsaRapida}
            className="mt-3 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-xs"
          >
            <PlayCircle size={16} /> Continuar Conferência
          </button>
        </div>
      </div>

      {/* Ações Rápidas + Busca */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Busca por Servidor */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xs">
            <h2 className="text-lg font-black mb-4 flex items-center gap-2">
              <Search size={20} className="text-[var(--blue-mid)]" /> Pesquisa de Servidores
            </h2>
            <div className="flex items-center gap-4 bg-[var(--bg)]/10 border border-[var(--border2)] rounded-2xl p-4">
              <Search size={22} className="text-[var(--text2)]" />
              <input 
                type="text" 
                placeholder="Digite o nome ou matrícula do servidor..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 bg-transparent text-lg outline-none placeholder:text-[var(--text2)]"
              />
            </div>

            {/* Match Results only display when searchTerm has values */}
            {searchTerm.trim() !== "" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {filteredServers.length > 0 ? (
                  filteredServers.map(s => (
                    <div key={s.matricula} className="p-4 border border-[var(--border)] rounded-2xl hover:border-blue-400 bg-[var(--surface)] transition-colors flex justify-between items-center group">
                      <div>
                        <div className="font-semibold group-hover:text-[var(--blue-mid)]">{s.nome}</div>
                        <div className="text-xs font-mono text-[var(--text2)]">{s.matricula}</div>
                      </div>
                      <button 
                        onClick={() => {
                          onToast(`Abrindo ${s.nome}...`, "info");
                          setActiveTab('rotina');
                        }}
                        className="text-xs px-5 py-2 bg-[var(--blue-light)] text-[var(--blue-mid)] rounded-xl hover:bg-[var(--blue-mid)] hover:text-white transition-all font-bold"
                      >
                        Conferir
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-center py-6 text-sm text-[var(--text2)]">
                    Nenhum servidor encontrado para "{searchTerm}"
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-[var(--text2)] font-medium">
                Insira o nome ou a matrícula para buscar servidores.
              </div>
            )}
          </div>

          {/* Vida Funcional do Dia Panel */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-xs">
            <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-[var(--text)]">
              <Palmtree size={20} className="text-emerald-500" /> Vida Funcional (Exercícios)
            </h2>

            {/* Current day status indicator */}
            <div className="mb-6 p-4 rounded-2xl border bg-[var(--bg)]/5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
                <CheckCircle2 size={24} />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider">Status Hoje ({currentDayStr}/{currentMonthStr})</div>
                <div className="font-bold text-sm">
                  {activeFerias.length > 0 ? (
                    <span className="text-amber-600 flex items-center gap-1">🌴 Férias Ativas: {activeFerias[0].inicio} a {activeFerias[0].fim} (Ex. {activeFerias[0].exercicio})</span>
                  ) : activeAbono.length > 0 ? (
                    <span className="text-blue-600 flex items-center gap-1">📅 Abono gozado hoje ({activeAbono[0].processo || "Sem processo"}) (Ex. {activeAbono[0].exercicio})</span>
                  ) : activeAfastamento.length > 0 ? (
                    <span className="text-red-500 flex items-center gap-1">🩺 Ausência: {activeAfastamento[0].tipo} ({activeAfastamento[0].sisref || "Sisref"})</span>
                  ) : (
                    <span className="text-emerald-600">Escala normal.</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Próximas Férias card */}
              <div 
                onClick={irParaVidaFuncional}
                className="group p-5 bg-[var(--bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] hover:border-amber-400 rounded-2xl cursor-pointer transition-all duration-200 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs font-black text-amber-600 uppercase tracking-wide">
                      <Palmtree size={16} /> Próximas Férias
                    </div>
                    <span className="text-[10px] text-[var(--text2)] group-hover:text-amber-600 transition-colors">Ver todas →</span>
                  </div>
                  {proximaFeria ? (
                    <div>
                      <div className="font-bold text-[var(--text)] text-sm">
                        Exercício {proximaFeria.exercicio}
                      </div>
                      <div className="text-[var(--text2)] text-xs font-mono mt-1">
                        {proximaFeria.inicio ? new Date(proximaFeria.inicio + "T12:00:00").toLocaleDateString('pt-BR') : '—'} a {proximaFeria.fim ? new Date(proximaFeria.fim + "T12:00:00").toLocaleDateString('pt-BR') : '—'}
                      </div>
                      {proximaFeria.processo && (
                        <div className="text-[10px] text-[var(--text2)] font-semibold mt-1">
                          SEI: {proximaFeria.processo}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--text2)] italic py-2">
                      Nenhuma programação futura encontrada.
                    </div>
                  )}
                </div>
              </div>

              {/* Próximo Abono card */}
              <div 
                onClick={irParaVidaFuncional}
                className="group p-5 bg-[var(--bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] hover:border-blue-400 rounded-2xl cursor-pointer transition-all duration-200 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-wide">
                      <CalendarCheck size={16} /> Próximo Abono
                    </div>
                    <span className="text-[10px] text-[var(--text2)] group-hover:text-blue-600 transition-colors">Ver todos →</span>
                  </div>
                  {proximoAbono ? (
                    <div>
                      <div className="font-bold text-[var(--text)] text-sm">
                        Exercício {proximoAbono.exercicio}
                      </div>
                      <div className="text-[var(--text2)] text-xs font-mono mt-1">
                        {new Date(proximoAbono.data + "T12:00:00").toLocaleDateString('pt-BR')}
                      </div>
                      {proximoAbono.processo && (
                        <div className="text-[10px] text-[var(--text2)] font-semibold mt-1">
                          SEI: {proximoAbono.processo}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--text2)] italic py-2">
                      Nenhum agendamento futuro encontrado.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar de Ações */}
        <div className="lg:col-span-5 space-y-5">
          <button 
            onClick={() => setActiveTab('balcao')}
            className="w-full bento-card p-8 flex items-center gap-6 hover:scale-[1.02] active:scale-95 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/50 rounded-2xl flex items-center justify-center group-hover:rotate-12 transition-transform flex-shrink-0">
              <UserCheck size={36} className="text-blue-600" />
            </div>
            <div className="text-left">
              <div className="font-bold text-2xl">Atendimento Balcão</div>
              <div className="text-[var(--text2)]">Iniciar novo atendimento</div>
            </div>
          </button>

          <button 
            onClick={() => setActiveTab('rotina')}
            className="w-full bento-card p-8 flex items-center gap-6 hover:scale-[1.02] active:scale-95 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/50 rounded-2xl flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
              <TrendingUp size={36} className="text-emerald-600" />
            </div>
            <div className="text-left">
              <div className="font-bold text-2xl">Produtividade</div>
              <div className="text-[var(--text2)]">Lançar atividades do dia</div>
            </div>
          </button>

          <button 
            onClick={irParaAbonoAniversario}
            className="w-full bento-card p-8 flex items-center gap-6 hover:scale-[1.02] active:scale-95 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <Gift size={36} className="text-amber-600" />
            </div>
            <div className="text-left">
              <div className="font-bold text-2xl">Abono Aniversário</div>
              <div className="text-[var(--text2)]">Análise de abono natalício</div>
            </div>
          </button>

          <button 
            onClick={irParaSigrh}
            className="w-full bento-card p-8 flex items-center gap-6 hover:scale-[1.02] active:scale-95 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center group-hover:rotate-6 transition-transform flex-shrink-0">
              <Building2 size={36} className="text-indigo-600" />
            </div>
            <div className="text-left">
              <div className="font-bold text-2xl">Conferir SEI</div>
              <div className="text-[var(--text2)]">Verificar no SIGRH</div>
            </div>
          </button>

          {pendenciasAvulsa > 0 && (
            <div className="bento-card p-6 border-red-300 bg-red-50/50 dark:bg-red-950/30">
              <div className="flex items-center gap-3 text-red-600">
                <AlertOctagon size={28} />
                <div>
                  <div className="font-bold">Pendências Avulsa</div>
                  <div className="text-3xl font-black">{pendenciasAvulsa}</div>
                </div>
              </div>
              <button onClick={resolverPendenciasAvulsa} className="mt-4 w-full text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50 py-3 rounded-2xl font-bold transition-all cursor-pointer">
                Resolver Pendências
              </button>
            </div>
          )}
        </div>
      </div>

      {showCompareModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-[var(--surface)] w-full max-w-2xl rounded-2xl p-6 shadow-xl border border-[var(--border)] flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="text-[var(--blue-mid)]" size={24} />
                <h3 className="text-xl font-black text-[var(--text)] tracking-tight">
                  Comparação do Último Lote Importado
                </h3>
              </div>
              <button 
                onClick={() => {
                  setShowCompareModal(false);
                  setModalSearchTerm("");
                }}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <X size={20} className="text-[var(--text2)]" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              {/* Stats & Explanation */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-[var(--border)] text-center">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase">No Aplicativo</div>
                  <div className="text-2xl font-black text-[var(--text)] mt-1">{totalServidores}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-[var(--border)] text-center">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase">No Último Extrator</div>
                  <div className="text-2xl font-black text-[var(--text)] mt-1">
                    {state.config?.lastImportCount || lastImportedMatriculas.length || 0}
                  </div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 text-center">
                  <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase">Divergentes (Ausentes)</div>
                  <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                    {absentServers.length}
                  </div>
                </div>
              </div>

              {!hasImportedHistory || lastImportedMatriculas.length === 0 ? (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 p-5 rounded-xl text-sm text-[var(--text)] leading-relaxed space-y-3">
                  <div className="flex gap-2 items-center text-blue-600 dark:text-blue-400 font-bold">
                    <AlertTriangle size={18} />
                    <span>Nenhum controle de lote ativo</span>
                  </div>
                  <p>
                    Não foram encontrados registros do controle de matrículas do último arquivo importado no banco de dados local.
                  </p>
                  <p className="text-xs text-[var(--text2)]">
                    Para habilitar esta comparação e visualizar quais servidores estão no aplicativo mas não no extrator, realize uma nova importação de servidores pela aba <strong className="font-bold">"Rotina" &gt; "Importador de servidores"</strong> ou restaure do backup.
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-[var(--border)] text-xs text-[var(--text2)] leading-relaxed flex gap-3 items-start">
                    <AlertTriangle size={24} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-[var(--text)]">Por que estes servidores estão ausentes?</strong>
                      <p className="mt-1">
                        Estes servidores constam no banco de dados do aplicativo, mas não estavam presentes no último arquivo importado (extrator de SISREF/SIGRH ou planilha de backup). Isso geralmente indica servidores desligados, transferidos, aposentados ou que não pertencem mais a este lote de servidores.
                      </p>
                    </div>
                  </div>

                  {absentServers.length === 0 ? (
                    <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 p-6 rounded-xl text-center space-y-2">
                      <div className="text-green-600 dark:text-green-400 font-bold text-lg">Excelente!</div>
                      <p className="text-sm text-[var(--text2)]">
                        Todos os servidores atualmente no aplicativo estão presentes no último extrator importado. Sem divergências encontradas!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="relative flex-1">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
                          <input 
                            type="text" 
                            placeholder="Buscar entre os servidores ausentes..."
                            value={modalSearchTerm}
                            onChange={(e) => setModalSearchTerm(e.target.value)}
                            className="w-full text-xs pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl outline-none focus:border-[var(--blue-mid)] transition-all"
                          />
                        </div>
                        <button 
                          onClick={removerTodosAusentes}
                          className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm shadow-red-500/10"
                        >
                          <Trash2 size={14} />
                          Remover Todos
                        </button>
                      </div>

                      {/* Scrollable list */}
                      <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg)]">
                        <div className="grid grid-cols-12 bg-slate-50 dark:bg-slate-900/60 p-2.5 text-[10px] font-bold text-[var(--text2)] uppercase border-b border-[var(--border)]">
                          <div className="col-span-3">Matrícula</div>
                          <div className="col-span-5">Nome / Cargo</div>
                          <div className="col-span-3">Lotação</div>
                          <div className="col-span-1 text-center">Ações</div>
                        </div>
                        <div className="max-h-[250px] overflow-y-auto divide-y divide-[var(--border)]">
                          {absentServers
                            .filter(s => 
                              s.nome.toLowerCase().includes(modalSearchTerm.toLowerCase()) || 
                              s.matricula.includes(modalSearchTerm) ||
                              s.cargo.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                              s.lotacao.toLowerCase().includes(modalSearchTerm.toLowerCase())
                            )
                            .map(s => (
                              <div key={s.matricula} className="grid grid-cols-12 p-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors items-center">
                                <div className="col-span-3 font-mono font-bold text-[var(--text)]">{s.matricula}</div>
                                <div className="col-span-5 pr-2">
                                  <div className="font-bold text-[var(--text)] uppercase truncate">{s.nome}</div>
                                  <div className="text-[10px] text-[var(--text2)] uppercase truncate">{s.cargo || "Não Informado"}</div>
                                </div>
                                <div className="col-span-3 text-[10px] text-[var(--text2)] uppercase truncate pr-2" title={s.lotacao}>
                                  {s.lotacao || "Sem lotação"}
                                </div>
                                <div className="col-span-1 flex justify-center">
                                  <button 
                                    onClick={() => removerServidor(s.matricula)}
                                    className="p-1 hover:bg-red-50 hover:text-red-500 rounded transition-colors text-[var(--text2)] cursor-pointer"
                                    title={`Remover ${s.nome} do aplicativo`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}

                          {absentServers.filter(s => 
                            s.nome.toLowerCase().includes(modalSearchTerm.toLowerCase()) || 
                            s.matricula.includes(modalSearchTerm) ||
                            s.cargo.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                            s.lotacao.toLowerCase().includes(modalSearchTerm.toLowerCase())
                          ).length === 0 && (
                            <div className="p-8 text-center text-xs text-[var(--text2)]">
                              Nenhum servidor ausente corresponde aos termos da pesquisa.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-4 flex justify-end">
              <button 
                onClick={() => {
                  setShowCompareModal(false);
                  setModalSearchTerm("");
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer text-[var(--text)]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

