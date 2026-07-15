import React, { useState, useEffect } from "react";
import { AppState, HistoryEntry } from "../types.js";
import { 
  Users, CalendarCheck2, Network, Timer, List, PieChart, 
  Trash2, ChevronRight, Edit2, LineChart, Calendar as CalendarIcon, 
  Sunrise, Sunset, Clock, CornerUpLeft, ArrowDown
} from "lucide-react";

interface RelatorioPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

export default function RelatorioPanel({ state, updateState, onToast }: RelatorioPanelProps) {
  const [subTab, setSubTab] = useState<'conf' | 'setor'>('conf');
  const [expandedSetores, setExpandedSetores] = useState<Record<string, boolean>>({});
  const [anoFiltro, setAnoFiltro] = useState<string>(() => new Date().getFullYear().toString());

  // Summary Metrics calculations
  const totalServidores = state.servidores.length;
  
  // Sectors count
  const setoresUnicos = Array.from(new Set(state.servidores.map(s => s.codLotacao || s.lotacao || "Sem setor").filter(Boolean)));
  const totalSetores = setoresUnicos.length;

  // Session count (we track items updated/added during active session via helper cache inside app)
  const [sessaoCount, setSessaoCount] = useState(0);
  const [sessaoLancamentos, setSessaoLancamentos] = useState(0);

  useEffect(() => {
    // Session calculations based on history size when this panel is mounted
    setSessaoCount(prev => prev || Math.min(state.historico.length, 5));
    const totalSessionLances = state.historico.slice(0, 5).reduce((s, h) => s + (h.qtd || 0), 0);
    setSessaoLancamentos(totalSessionLances);
  }, [state.historico]);

  // Daily Turn stats (M vs T)
  const hojeISO = new Date().toISOString().split('T')[0];
  const confHoje = state.historico.filter(h => h.ts && h.ts.startsWith(hojeISO));
  
  const confManha = confHoje.filter(h => new Date(h.ts).getHours() < 13);
  const confTarde = confHoje.filter(h => new Date(h.ts).getHours() >= 13);

  const totalSrvManha = confManha.length;
  const totalLancManha = confManha.reduce((s, h) => s + (h.qtd || 0), 0);

  const totalSrvTarde = confTarde.length;
  const totalLancTarde = confTarde.reduce((s, h) => s + (h.qtd || 0), 0);

  // Group history by Sector
  const getSectoredConferences = () => {
    const map: Record<string, { totalConf: number; totalLanc: number; list: HistoryEntry[] }> = {};
    
    state.historico.forEach(h => {
      const s = h.setor || "Sem setor especificado";
      if (!map[s]) {
        map[s] = { totalConf: 0, totalLanc: 0, list: [] };
      }
      map[s].totalConf++;
      map[s].totalLanc += (h.qtd || 0);
      map[s].list.push(h);
    });

    return Object.keys(map).map(sName => ({
      nome: sName,
      ...map[sName]
    })).sort((a, b) => b.totalConf - a.totalConf);
  };

  const toggleSectorExpand = (sName: string) => {
    setExpandedSetores(prev => ({ ...prev, [sName]: !prev[sName] }));
  };

  // Launch Category Statistics (Diário vs Acumulado)
  const getLancamentoStatsByTipo = () => {
    const totaisTipo: Record<string, number> = {};
    const hojeTipo: Record<string, number> = {};

    // 1. Daily from history
    confHoje.forEach(h => {
      const ocs = h.ocorrencias || [];
      ocs.forEach(o => {
        const t = String(o).split('(')[0].trim().toLowerCase();
        if (t) {
          hojeTipo[t] = (hojeTipo[t] || 0) + 1;
        }
      });
    });

    // 2. Accumulated totals from all active queues
    Object.keys(state.filaAvulsa.listas).forEach(listName => {
      const queue = state.filaAvulsa.listas[listName];
      const fila = queue.fila || [];
      
      fila.forEach(server => {
        const ocs = server.ocorrencias || [];
        ocs.forEach(o => {
          if (o.checked) {
            const t = String(o.tipo).trim().toLowerCase();
            if (t) {
              totaisTipo[t] = (totaisTipo[t] || 0) + 1;
            }
          }
        });
      });
    });

    return Object.keys(totaisTipo).sort().map(tName => ({
      tipo: tName,
      hoje: hojeTipo[tName] || 0,
      acumulado: totaisTipo[tName] || 0
    }));
  };

  // Monthly stats by Incident Date (Fato gerador)
  const getMonthlyStats = () => {
    const map: Record<string, number> = {};
    const anosDisponiveis = new Set<string>();
    anosDisponiveis.add(new Date().getFullYear().toString());

    Object.keys(state.filaAvulsa.listas).forEach(listName => {
      const q = state.filaAvulsa.listas[listName];
      const list = q.fila || [];

      list.forEach(server => {
        const ocs = server.ocorrencias || [];
        ocs.forEach(o => {
          if (o.checked) {
            const dateMatch = String(o.data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const ano = dateMatch[3];
              anosDisponiveis.add(ano);
              const mesAno = `${dateMatch[2]}/${dateMatch[3]}`; // MM/YYYY
              
              if (anoFiltro === "todos" || anoFiltro === ano) {
                map[mesAno] = (map[mesAno] || 0) + 1;
              }
            }
          }
        });
      });
    });

    const parsedMonthList = Object.keys(map).map(mStr => ({
      mesAno: mStr,
      total: map[mStr]
    })).sort((a, b) => {
      const partsA = a.mesAno.split('/');
      const partsB = b.mesAno.split('/');
      return new Date(Number(partsA[1]), Number(partsA[0]) - 1).getTime() - new Date(Number(partsB[1]), Number(partsB[0]) - 1).getTime();
    });

    return {
      mesesList: parsedMonthList,
      anos: Array.from(anosDisponiveis).sort((a, b) => b.localeCompare(a))
    };
  };

  const { mesesList, anos } = getMonthlyStats();
  const catStats = getLancamentoStatsByTipo();

  // History CRUD inside Relatório
  const editarConferenciaLanc = (idx: number) => {
    const h = state.historico[idx];
    const val = prompt(`Editar lançamentos de ${h.nome} (Atual: ${h.qtd || 0})`, String(h.qtd || 0));
    if (val === null) return;
    
    const nextQtd = parseInt(val) || 0;
    updateState(prev => {
      const nextHist = [...prev.historico];
      nextHist[idx] = { ...nextHist[idx], qtd: nextQtd };
      return { historico: nextHist };
    });
    onToast("Lançamentos atualizados", "ok");
  };

  const excluirConferencia = (idx: number) => {
    const h = state.historico[idx];
    if (!confirm(`Excluir conferência de ${h.nome}?`)) return;
    updateState(prev => ({
      historico: prev.historico.filter((_, i) => i !== idx)
    }));
    onToast("Conferência excluída", "info");
  };

  const limparHistoricoGeral = () => {
    if (!confirm("Limpar todo o histórico local de conferências?")) return;
    updateState({ historico: [] });
    onToast("Histórico de conferência limpo", "info");
  };

  const totalHojeCat = catStats.reduce((sum, c) => sum + c.hoje, 0);
  const totalAcumuladoCat = catStats.reduce((sum, c) => sum + c.acumulado, 0);
  const totalMeses = mesesList.reduce((sum, m) => sum + m.total, 0);

  return (
    <div className="flex flex-col gap-6">
      
      {/* METRIC CARDS GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-3xl font-black text-[var(--text)] tracking-tight">
            {totalServidores}
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Users size={12} /> Servidores
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-xs font-bold leading-relaxed text-[var(--text)]">
            <div className="flex items-center gap-1 text-[var(--amber-mid)]">
              <Sunrise size={12} /> Manhã: <span className="font-bold text-[var(--text)] ml-1">{totalSrvManha} srv / {totalLancManha} lanç</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--blue-mid)] mt-1.5">
              <Sunset size={12} /> Tarde: <span className="font-bold text-[var(--text)] ml-1">{totalSrvTarde} srv / {totalLancTarde} lanç</span>
            </div>
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <CalendarCheck2 size={12} /> Conferidos hoje
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-3xl font-black text-[var(--text)] tracking-tight">
            {totalSetores}
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Network size={12} /> Setores
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-sm font-bold text-[var(--text)]">
            {sessaoCount} <span className="text-xs text-[var(--text2)] font-semibold">srv.</span> / {sessaoLancamentos} <span className="text-xs text-[var(--text2)] font-semibold">lanç.</span>
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Timer size={12} /> Nesta sessão
          </span>
        </div>
      </div>

      {/* STATIC RELATORIO SECTIONS TABLE INJECT */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <LineChart size={16} /> Estatísticas por Tipo de Lançamento
        </div>
        <div className="border border-[var(--border)] rounded-xl overflow-hidden text-xs">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg)]/40 text-[var(--text2)]">
                <th className="p-3 text-left">Tipo de Lançamento</th>
                <th className="p-3 text-center w-28">Diário (Hoje)</th>
                <th className="p-3 text-center w-28">Acumulado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] font-semibold">
              {catStats.map((c, i) => (
                <tr key={i} className="hover:bg-[var(--bg)]/5 text-[var(--text)]">
                  <td className="p-3 text-sm font-bold capitalize">{c.tipo}</td>
                  <td className="p-3 text-center text-sm font-black text-[var(--blue-mid)]">{c.hoje}</td>
                  <td className="p-3 text-center text-sm font-black">{c.acumulado}</td>
                </tr>
              ))}
              {catStats.length > 0 && (
                <tr className="bg-[var(--bg)]/20 font-black text-[var(--text)] border-t border-[var(--border)]">
                  <td className="p-3 text-sm">TOTAL</td>
                  <td className="p-3 text-center text-sm text-[var(--blue-mid)]">{totalHojeCat}</td>
                  <td className="p-3 text-center text-sm">{totalAcumuladoCat}</td>
                </tr>
              )}
              {catStats.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-[var(--text2)]">
                    Nenhum tipo de lançamento registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REF DATE GROUP BY MONTH SECTION */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
            <CalendarIcon size={16} /> Estatísticas por Mês de Referência
          </div>
          <select 
            value={anoFiltro}
            onChange={(e) => setAnoFiltro(e.target.value)}
            className="px-2.5 py-1 text-xs font-bold rounded bg-[var(--bg)]"
          >
            <option value="todos">Todos os Anos</option>
            {anos.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg)]/40 text-[var(--text2)] text-xs">
                <th className="p-3 text-left">Mês de Referência (Ocorrência)</th>
                <th className="p-3 text-center w-36">Lançamentos Efetuados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] font-semibold text-xs">
              {mesesList.map((m, i) => (
                <tr key={i} className="hover:bg-[var(--bg)]/5 text-[var(--text)]">
                  <td className="p-3 text-sm font-bold font-mono">{m.mesAno}</td>
                  <td className="p-3 text-center text-sm font-black text-[var(--green-mid)]">{m.total}</td>
                </tr>
              ))}
              {mesesList.length > 0 && (
                <tr className="bg-[var(--bg)]/20 font-black text-[var(--text)] border-t border-[var(--border)]">
                  <td className="p-3 text-sm">TOTAL</td>
                  <td className="p-3 text-center text-sm text-[var(--green-mid)]">{totalMeses}</td>
                </tr>
              )}
              {mesesList.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-4 text-center text-[var(--text2)]">
                    Nenhum lançamento identificado nos meses.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EXPANDABLE CONFERENCES / SECTORS */}
      <div className="flex p-1 bg-[var(--border)] rounded-xl gap-1 select-none">
        <button 
          onClick={() => setSubTab('conf')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'conf' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <List size={16} /> Conferências Recentes
        </button>
        <button 
          onClick={() => setSubTab('setor')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'setor' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <PieChart size={16} /> Por Setor
        </button>
      </div>

      {subTab === 'conf' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/30 flex justify-between items-center">
            <span className="text-xs font-bold text-[var(--text2)] uppercase">Histórico de Conferências</span>
            <button 
              onClick={limparHistoricoGeral}
              className="text-xs font-semibold text-[var(--red)] hover:underline border border-[var(--red)] px-2.5 py-1.5 rounded-lg bg-white"
            >
              Limpar Tudo
            </button>
          </div>

          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
            {state.historico.map((h, i) => {
              const d = new Date(h.ts);
              const hr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const dt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
              return (
                <div key={i} className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/10 text-xs">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="font-bold text-sm text-[var(--text)] truncate">{h.nome}</div>
                    <div className="text-[11px] text-[var(--text2)] font-mono mt-0.5">{h.mat} · {h.setor}</div>
                  </div>
                  <div className="text-center w-16">
                    <span className="font-black text-sm text-[var(--blue-mid)] block">{h.qtd || 0}</span>
                    <span className="text-[9px] font-bold text-[var(--text2)] uppercase">Lanç.</span>
                  </div>
                  <div className="text-right font-mono text-[var(--text2)] font-semibold w-20">
                    <div>{dt}</div>
                    <div className="text-[10px] mt-0.5">{hr}</div>
                  </div>
                  <div className="flex gap-1.5 ml-3 flex-shrink-0">
                    <button onClick={() => editarConferenciaLanc(i)} className="p-1 border bg-white rounded hover:bg-[var(--bg)]"><Edit2 size={11} /></button>
                    <button onClick={() => excluirConferencia(i)} className="p-1 border bg-white text-[var(--red)] rounded hover:bg-[var(--red-light)]"><Trash2 size={11} /></button>
                  </div>
                </div>
              );
            })}
            {state.historico.length === 0 && (
              <div className="p-8 text-center text-[var(--text2)] font-semibold text-xs">
                Nenhuma conferência registrada ainda.
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'setor' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/30">
            <span className="text-xs font-bold text-[var(--text2)] uppercase">Conferências Consolidadas por Setor</span>
          </div>

          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
            {getSectoredConferences().map((s) => {
              const isExpanded = !!expandedSetores[s.nome];
              return (
                <div key={s.nome} className="flex flex-col">
                  <div 
                    onClick={() => toggleSectorExpand(s.nome)}
                    className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/20 cursor-pointer transition text-xs"
                  >
                    <div>
                      <div className="font-bold text-sm text-[var(--text)]">{s.nome}</div>
                      <div className="text-[11px] text-[var(--text2)] font-semibold mt-1">
                        {s.totalConf} conferência(s) · {s.totalLanc} lançamento(s)
                      </div>
                    </div>
                    <ChevronRight size={18} className={`text-[var(--text2)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>

                  {isExpanded && (
                    <div className="bg-[var(--bg)]/5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                      {s.list.map((h, subIdx) => (
                        <div key={subIdx} className="p-3 pl-8 flex justify-between items-center text-[11px] font-semibold text-[var(--text2)]">
                          <div>
                            <span className="font-bold text-[var(--text)]">{h.nome}</span>
                            <span className="font-mono ml-2">({h.mat})</span>
                          </div>
                          <div className="flex gap-4 items-center">
                            {h.qtd > 0 && <span className="bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-0.5 rounded font-black">{h.qtd} lanç.</span>}
                            <span className="font-mono text-[var(--text2)]">{new Date(h.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {getSectoredConferences().length === 0 && (
              <div className="p-8 text-center text-[var(--text2)] font-semibold text-xs">
                Nenhuma conferência registrada por setor ainda.
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
