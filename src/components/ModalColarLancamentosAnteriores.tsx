import React, { useState, useMemo } from "react";
import { 
  X, ClipboardPaste, CheckCircle2, AlertTriangle, Trash2, 
  Search, FileSpreadsheet, Plus, RefreshCw, Layers, Database,
  ArrowRight, Info, Check, HelpCircle, UserCheck
} from "lucide-react";
import { Server, LancamentoAnteriorItem } from "../types.js";
import { parseLancamentosAnterioresText } from "../lib/parserLancamentosAnteriores.js";
import { normalizeMatricula } from "../lib/utils.js";

interface ModalColarLancamentosAnterioresProps {
  isOpen: boolean;
  onClose: () => void;
  servidores: Server[];
  lancamentosSalvos: LancamentoAnteriorItem[];
  onSalvar: (itens: LancamentoAnteriorItem[], modo: 'adicionar' | 'substituir') => void;
  onExcluirItem: (id: string) => void;
  onLimparTodos: () => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

export default function ModalColarLancamentosAnteriores({
  isOpen,
  onClose,
  servidores,
  lancamentosSalvos,
  onSalvar,
  onExcluirItem,
  onLimparTodos,
  onToast
}: ModalColarLancamentosAnterioresProps) {
  const [modalTab, setModalTab] = useState<'colar' | 'salvos'>('colar');
  const [inputText, setInputText] = useState("");
  const [modoGravacao, setModoGravacao] = useState<'adicionar' | 'substituir'>('adicionar');
  const [filtroSalvos, setFiltroSalvos] = useState("");

  // Map of known servers for quick status check
  const servSet = useMemo(() => {
    const set = new Set<string>();
    servidores.forEach(s => {
      const n = normalizeMatricula(s.matricula);
      if (n) set.add(n);
    });
    return set;
  }, [servidores]);

  // Parse items from input text
  const previewItems = useMemo(() => {
    return parseLancamentosAnterioresText(inputText, servidores);
  }, [inputText, servidores]);

  // Statistics about parsed items
  const statsPreview = useMemo(() => {
    if (previewItems.length === 0) return null;
    const servidoresUnicos = new Set(previewItems.map(p => normalizeMatricula(p.matricula)));
    const meses = Array.from(new Set(previewItems.map(p => p.mesAnoOcorrencia).filter(Boolean))).sort() as string[];
    const aprovados = previewItems.filter(p => p.status?.toLowerCase().includes("aprovado")).length;
    const rejeitados = previewItems.filter(p => p.status?.toLowerCase().includes("rejeitado")).length;
    const outros = previewItems.length - aprovados - rejeitados;

    let periodoStr = "Mês(es) identificados";
    if (meses.length === 1) {
      periodoStr = formatarYmdParaMesAno(meses[0]);
    } else if (meses.length > 1) {
      periodoStr = `${formatarYmdParaMesAno(meses[0])} até ${formatarYmdParaMesAno(meses[meses.length - 1])}`;
    }

    return {
      totalItens: previewItems.length,
      totalServidores: servidoresUnicos.size,
      periodoStr,
      aprovados,
      rejeitados,
      outros
    };
  }, [previewItems]);

  // Filter saved items
  const salvosFiltrados = useMemo(() => {
    if (!filtroSalvos.trim()) return lancamentosSalvos;
    const q = filtroSalvos.toLowerCase().trim();
    return lancamentosSalvos.filter(item => 
      item.matricula.toLowerCase().includes(q) ||
      item.nome.toLowerCase().includes(q) ||
      item.tipo.toLowerCase().includes(q) ||
      item.dataOcorrencia.toLowerCase().includes(q) ||
      item.mesAnoOcorrencia.toLowerCase().includes(q)
    );
  }, [lancamentosSalvos, filtroSalvos]);

  if (!isOpen) return null;

  const handleAplicar = () => {
    if (previewItems.length === 0) {
      onToast("Nenhum lançamento foi identificado no texto colado.", "err");
      return;
    }
    onSalvar(previewItems, modoGravacao);
    setInputText("");
    onClose();
  };

  const handleExemplo = () => {
    setInputText(`05/2025	
05/05/2025
Licença Médica / Odontológica	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Rejeitado		
05/2025	
16/05/2025
Atest. Comparec. (Dec. 34023)	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Aprovado	Aprovado	
06/2025	
17/06/2025
Licença Médica / Odontológica	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Aprovado	Aprovado	
12/2025	
16/12/2025
Atest. Comparec. (Dec. 34023)	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Aprovado	Aprovado	
02/2026	
05/02/2026
Atestado Médico (até 3 dias)	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Aprovado	Aprovado	
03/2026	
03/03/2026
Atest. Comparec. (Dec. 34023)	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Aprovado	Aprovado	
04/2026	
07/04/2026
Atestado Médico (até 3 dias)	16802179 - Adriana de Fatima Holanda Fialho	Anexado	Rejeitado`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div 
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--blue-mid)]/15 text-[var(--blue-mid)] flex items-center justify-center shrink-0">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-[var(--text)] flex items-center gap-2">
                Importar Lançamentos Anteriores ao Sistema
                <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  SISREF / Histórico Manual
                </span>
              </h3>
              <p className="text-xs text-[var(--text2)] mt-0.5">
                Identifica afastamentos ocorridos antes do sistema para regularizar o relatório de servidores sem lançamento.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* TABS SELECTOR */}
        <div className="flex border-b border-[var(--border)] px-6 pt-2 bg-[var(--surface)] shrink-0 gap-3">
          <button
            onClick={() => setModalTab('colar')}
            className={`pb-2.5 px-3 text-xs md:text-sm font-black flex items-center gap-2 border-b-2 transition ${modalTab === 'colar' ? 'border-[var(--blue-mid)] text-[var(--blue-mid)]' : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'}`}
          >
            <ClipboardPaste size={16} /> Colar Novos Lançamentos
            {previewItems.length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-black rounded-full bg-[var(--blue-mid)] text-white">
                {previewItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setModalTab('salvos')}
            className={`pb-2.5 px-3 text-xs md:text-sm font-black flex items-center gap-2 border-b-2 transition ${modalTab === 'salvos' ? 'border-[var(--blue-mid)] text-[var(--blue-mid)]' : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'}`}
          >
            <Database size={16} /> Lançamentos Salvos no Sistema
            <span className={`px-2 py-0.5 text-[10px] font-black rounded-full ${lancamentosSalvos.length > 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-[var(--bg)] text-[var(--text2)]"}`}>
              {lancamentosSalvos.length}
            </span>
          </button>
        </div>

        {/* TAB 1: COLAR / IMPORTAR */}
        {modalTab === 'colar' && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
            {/* INSTRUCTIONS */}
            <div className="bg-[var(--bg)]/60 border border-[var(--border)] rounded-xl p-4 text-xs text-[var(--text2)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Info size={18} className="text-[var(--blue-mid)] shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-[var(--text)]">Como funciona: </span>
                  Cole abaixo o relatório ou linhas do SISREF/SIGRH contendo mês (ex: <code className="font-mono text-[var(--blue-mid)]">05/2025</code>), data(s) e a linha com afastamento e <code className="font-mono text-[var(--blue-mid)]">matrícula - nome</code>. O sistema considera esses lançamentos para que os servidores saiam automaticamente da lista de sem lançamento no período!
                </div>
              </div>
              <button
                onClick={handleExemplo}
                className="self-start sm:self-auto text-xs font-bold text-[var(--blue-mid)] hover:underline flex items-center gap-1 shrink-0 bg-[var(--surface)] px-2.5 py-1.5 rounded-lg border border-[var(--border)]"
              >
                <HelpCircle size={13} /> Colar Exemplo
              </button>
            </div>

            {/* TEXTAREA */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardPaste size={14} /> Cole os dados aqui:
                </label>
                {inputText && (
                  <button
                    onClick={() => setInputText("")}
                    className="text-[11px] font-bold text-[var(--red)] hover:underline flex items-center gap-1"
                  >
                    <Trash2 size={12} /> Limpar texto
                  </button>
                )}
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`05/2025\t
05/05/2025
Licença Médica / Odontológica\t16802179 - Adriana de Fatima Holanda Fialho\tAnexado\tRejeitado\t\t
05/2025\t
16/05/2025
Atest. Comparec. (Dec. 34023)\t16802179 - Adriana de Fatima Holanda Fialho\tAnexado\tAprovado\tAprovado...`}
                rows={7}
                className="w-full p-3 font-mono text-xs rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue-mid)]/40 resize-y"
              />
            </div>

            {/* PREVIEW OF PARSED ITEMS */}
            {statsPreview && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs">
                  <div className="flex items-center gap-2 font-black text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 size={18} className="text-emerald-500" />
                    <span>{statsPreview.totalItens} lançamento(s) identificado(s) com sucesso!</span>
                  </div>
                  <div className="flex items-center gap-3 text-emerald-900 dark:text-emerald-200 font-semibold">
                    <span><strong>{statsPreview.totalServidores}</strong> servidor(es)</span>
                    <span>•</span>
                    <span>Período: <strong>{statsPreview.periodoStr}</strong></span>
                    <span>•</span>
                    <span className="text-emerald-600 font-bold">{statsPreview.aprovados} aprovados</span>
                    {statsPreview.rejeitados > 0 && (
                      <span className="text-amber-600 font-bold">• {statsPreview.rejeitados} rejeitados</span>
                    )}
                  </div>
                </div>

                {/* PREVIEW TABLE */}
                <div className="border border-[var(--border)] rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-[var(--bg)]/80 text-[var(--text2)] sticky top-0 font-bold">
                      <tr>
                        <th className="p-2.5 text-center w-24">Mês/Ano</th>
                        <th className="p-2.5 text-left w-36">Data Ocorrência</th>
                        <th className="p-2.5 text-left">Servidor</th>
                        <th className="p-2.5 text-left">Afastamento</th>
                        <th className="p-2.5 text-center w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                      {previewItems.map((item, idx) => {
                        const inBase = servSet.has(normalizeMatricula(item.matricula));
                        const isAprovado = item.status?.toLowerCase().includes("aprovado");
                        const isRejeitado = item.status?.toLowerCase().includes("rejeitado");
                        return (
                          <tr key={idx} className="hover:bg-[var(--bg)]/20">
                            <td className="p-2.5 text-center font-mono font-bold text-[var(--blue-mid)]">
                              {formatarYmdParaMesAno(item.mesAnoOcorrencia)}
                            </td>
                            <td className="p-2.5 font-mono text-[var(--text)]">
                              {item.dataOcorrencia}
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-[var(--text)] flex items-center gap-1.5">
                                {item.nome}
                                {inBase ? (
                                  <span title="Servidor cadastrado na base de dados" className="text-emerald-500">
                                    <UserCheck size={13} />
                                  </span>
                                ) : (
                                  <span title="Matrícula não encontrada na lista geral de servidores" className="text-amber-500 text-[10px]">
                                    (não listado)
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-[var(--text2)]">
                                Matrícula: {item.matricula}
                              </div>
                            </td>
                            <td className="p-2.5 font-semibold text-[var(--text)]">
                              {item.tipo}
                            </td>
                            <td className="p-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${isAprovado ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : isRejeitado ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-[var(--bg)] text-[var(--text2)]'}`}>
                                {item.status || "Identificado"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* GRAVAÇÃO MODE */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[var(--bg)]/40 rounded-xl border border-[var(--border)] text-xs">
                  <div className="font-bold text-[var(--text)]">Modo de Inclusão:</div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="modoGravacao"
                        checked={modoGravacao === 'adicionar'}
                        onChange={() => setModoGravacao('adicionar')}
                        className="text-[var(--blue-mid)]"
                      />
                      <span className="font-semibold text-[var(--text)]">
                        Acrescentar aos existentes (não duplica)
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="modoGravacao"
                        checked={modoGravacao === 'substituir'}
                        onChange={() => setModoGravacao('substituir')}
                        className="text-[var(--blue-mid)]"
                      />
                      <span className="font-semibold text-[var(--text)]">
                        Substituir todos os anteriores
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LANÇAMENTOS SALVOS */}
        {modalTab === 'salvos' && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
                <input
                  type="text"
                  placeholder="Buscar por nome, matrícula, tipo..."
                  value={filtroSalvos}
                  onChange={(e) => setFiltroSalvos(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)]"
                />
              </div>

              {lancamentosSalvos.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm("Deseja realmente excluir TODOS os lançamentos anteriores ao sistema cadastrados?")) {
                      onLimparTodos();
                    }
                  }}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold rounded-xl text-xs flex items-center gap-1.5 transition border border-rose-500/20"
                >
                  <Trash2 size={13} /> Limpar Todos os Salvos ({lancamentosSalvos.length})
                </button>
              )}
            </div>

            {/* TABLE OF SAVED LAUNCHES */}
            <div className="border border-[var(--border)] rounded-xl overflow-hidden flex-1 min-h-[220px]">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-[var(--bg)]/80 text-[var(--text2)] font-bold sticky top-0">
                  <tr>
                    <th className="p-3 text-center w-24">Mês/Ano</th>
                    <th className="p-3 text-left w-36">Data Ocorrência</th>
                    <th className="p-3 text-left">Servidor</th>
                    <th className="p-3 text-left">Afastamento</th>
                    <th className="p-3 text-center w-24">Status</th>
                    <th className="p-3 text-center w-16">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {salvosFiltrados.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--bg)]/20">
                      <td className="p-3 text-center font-mono font-bold text-[var(--blue-mid)]">
                        {formatarYmdParaMesAno(item.mesAnoOcorrencia)}
                      </td>
                      <td className="p-3 font-mono text-[var(--text)]">
                        {item.dataOcorrencia}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-[var(--text)]">
                          {item.nome}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text2)]">
                          Matrícula: {item.matricula}
                        </div>
                      </td>
                      <td className="p-3 font-semibold text-[var(--text)]">
                        {item.tipo}
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[var(--bg)] text-[var(--text2)]">
                          {item.status || "Salvo"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onExcluirItem(item.id)}
                          className="p-1 text-[var(--text2)] hover:text-[var(--red)] rounded hover:bg-[var(--bg)] transition"
                          title="Excluir este lançamento"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {salvosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[var(--text2)]">
                        {lancamentosSalvos.length === 0 
                          ? "Nenhum lançamento anterior ao sistema foi salvo ainda. Vá para a aba 'Colar Novos Lançamentos' para importar."
                          : "Nenhum lançamento corresponde ao filtro de busca."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between bg-[var(--bg)]/40 shrink-0">
          <div className="text-xs text-[var(--text2)]">
            {modalTab === 'colar' && previewItems.length > 0 && (
              <span>Pronto para salvar <strong>{previewItems.length}</strong> registro(s).</span>
            )}
            {modalTab === 'salvos' && (
              <span>Total no sistema: <strong>{lancamentosSalvos.length}</strong> lançamento(s) anterior(es).</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition"
            >
              Fechar
            </button>

            {modalTab === 'colar' && (
              <button
                onClick={handleAplicar}
                disabled={previewItems.length === 0}
                className="px-5 py-2.5 bg-[var(--blue-mid)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl text-xs flex items-center gap-2 shadow-sm transition"
              >
                <Check size={16} /> Salvar e Atualizar Relatório
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatarYmdParaMesAno(ymd: string): string {
  if (!ymd || !ymd.includes("-")) return ymd;
  const [y, m] = ymd.split("-");
  return `${m}/${y}`;
}
