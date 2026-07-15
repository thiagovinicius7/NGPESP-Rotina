import React, { useState, useEffect } from "react";
import { AppState } from "../types.js";
import { 
  Users, Building2, Clock, UserCheck, TrendingUp, PlusCircle, 
  Search, ListTodo, AlertOctagon, PlayCircle, Palmtree, CalendarCheck, Stethoscope, CheckCircle2, Gift
} from "lucide-react";

interface DashboardProps {
  state: AppState;
  updateState: any;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  setActiveTab: (tab: 'dashboard' | 'sisref' | 'sigrh' | 'rotina' | 'balcao' | 'relatorio') => void;
  setSisrefSubTab?: (tab: 'setores' | 'avulsa' | 'respostas') => void;
}

export default function Dashboard({ state, updateState, onToast, setActiveTab, setSisrefSubTab }: DashboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

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
        <div className="bento-card p-6">
          <Users size={32} className="text-blue-500 mb-3" />
          <div className="text-5xl font-black text-[var(--text)]">{totalServidores}</div>
          <div className="text-[var(--text2)]">Servidores</div>
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
              {/* Férias list */}
              <div className="p-4 bg-[var(--bg)]/10 border border-[var(--border2)] rounded-2xl">
                <div className="flex items-center gap-2 mb-3 text-xs font-black text-amber-600 uppercase tracking-wide">
                  <Palmtree size={14} /> Férias Programadas
                </div>
                {allFerias.length > 0 ? (
                  <div className="space-y-2">
                    {allFerias.map((p, idx) => {
                      const isNow = p.inicio && p.fim && new Date(hoje).getTime() >= new Date(p.inicio).getTime() && new Date(hoje).getTime() <= new Date(p.fim).getTime();
                      return (
                        <div key={idx} className={`p-2.5 rounded-xl text-xs border ${isNow ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/20' : 'bg-[var(--surface)] border-[var(--border)]'}`}>
                          <div className="font-bold text-[var(--text)] flex justify-between">
                            <span>Exercício {p.exercicio}</span>
                            {isNow && <span className="text-[9px] font-black uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Vigente</span>}
                          </div>
                          <div className="text-[var(--text2)] font-mono mt-1">
                            {p.inicio ? new Date(p.inicio + "T12:00:00").toLocaleDateString('pt-BR') : '—'} a {p.fim ? new Date(p.fim + "T12:00:00").toLocaleDateString('pt-BR') : '—'}
                          </div>
                          {p.processo && <div className="text-[10px] text-[var(--text2)] font-semibold mt-0.5">SEI: {p.processo}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text2)] italic py-3 text-center">Nenhum período de férias programado.</div>
                )}
              </div>

              {/* Abonos list */}
              <div className="p-4 bg-[var(--bg)]/10 border border-[var(--border2)] rounded-2xl">
                <div className="flex items-center gap-2 mb-3 text-xs font-black text-blue-600 uppercase tracking-wide">
                  <CalendarCheck size={14} /> Abonos Autorizados
                </div>
                {allAbonos.length > 0 ? (
                  <div className="space-y-2">
                    {allAbonos.map((a, idx) => {
                      const isToday = a.data === hoje;
                      return (
                        <div key={idx} className={`p-2.5 rounded-xl text-xs border ${isToday ? 'bg-blue-50 border-blue-300 dark:bg-blue-950/20' : 'bg-[var(--surface)] border-[var(--border)]'}`}>
                          <div className="font-bold text-[var(--text)] flex justify-between">
                            <span>Exercício {a.exercicio}</span>
                            {isToday && <span className="text-[9px] font-black uppercase text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Hoje</span>}
                          </div>
                          <div className="text-[var(--text2)] font-mono mt-1">
                            {new Date(a.data + "T12:00:00").toLocaleDateString('pt-BR')}
                          </div>
                          {a.processo && <div className="text-[10px] text-[var(--text2)] font-semibold mt-0.5">SEI: {a.processo}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text2)] italic py-3 text-center">Nenhum abono agendado ou autorizado.</div>
                )}
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
              <button onClick={iniciarConferenciaAvulsaRapida} className="mt-4 w-full text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50 py-3 rounded-2xl font-bold transition-all">
                Resolver Pendências
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

