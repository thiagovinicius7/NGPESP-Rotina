import React, { useState } from "react";
import { AppState } from "../types.js";
import { 
  PhoneCall, Play, Check, BookOpen, Plus, Search, 
  Trash2, Save, X, HelpCircle, Edit, ChevronDown
} from "lucide-react";

interface BalcaoPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

export default function BalcaoPanel({ state, updateState, onToast }: BalcaoPanelProps) {
  // Desk notes
  const [balcaoDate, setBalcaoDate] = useState(new Date().toISOString().split("T")[0]);
  const [isAttendanceActive, setIsAttendanceActive] = useState(false);

  // FAQ doubts
  const [faqBusca, setFaqBusca] = useState("");
  const [faqForm, setFaqForm] = useState<{ idx: number; titulo: string; resposta: string } | null>(null);
  const [expandedFaqIdx, setExpandedFaqIdx] = useState<number | null>(null);

  const activeNotes = state.balcaoAtendimentos[balcaoDate] || "";

  const handleNotesChange = (val: string) => {
    updateState(prev => {
      const nextAtendimentos = { ...prev.balcaoAtendimentos };
      if (val.trim()) {
        nextAtendimentos[balcaoDate] = val;
      } else {
        delete nextAtendimentos[balcaoDate];
      }
      return { balcaoAtendimentos: nextAtendimentos };
    });
  };

  const startAttendance = () => {
    setIsAttendanceActive(true);
    onToast("Sessão de atendimento de balcão iniciada!", "ok");
  };

  const finishAttendance = () => {
    setIsAttendanceActive(false);
    onToast("Atendimento de balcão finalizado e salvo na nuvem!", "ok");
  };

  // FAQ CRUD
  const salvarFAQ = () => {
    if (!faqForm?.titulo || !faqForm?.resposta) {
      onToast("Preencha título e procedimento para salvar", "err");
      return;
    }

    updateState(prev => {
      const nextArr = [...prev.faq];
      const obj = { titulo: faqForm.titulo.trim(), resposta: faqForm.resposta.trim() };
      if (faqForm.idx >= 0) {
        nextArr[faqForm.idx] = obj;
      } else {
        nextArr.unshift(obj);
      }
      return { faq: nextArr };
    });

    onToast("Dúvida de balcão atualizada!", "ok");
    setFaqForm(null);
  };

  const excluirFAQ = (idx: number) => {
    if (!confirm("Remover esta dúvida do banco do FAQ?")) return;
    updateState(prev => ({
      faq: prev.faq.filter((_, i) => i !== idx)
    }));
    onToast("Item removido do FAQ", "info");
  };

  const filteredFaq = state.faq.filter(f => 
    f.titulo.toLowerCase().includes(faqBusca.toLowerCase()) || 
    f.resposta.toLowerCase().includes(faqBusca.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      
      {/* 1. ATENDIMENTO DE BALCÃO */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <PhoneCall size={16} /> Atendimento de Balcão
        </div>

        <div className="flex gap-4 items-center flex-wrap mb-4">
          <div className="flex-1 min-w-[150px]">
            <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Data do Atendimento</label>
            <input 
              type="date" 
              value={balcaoDate}
              onChange={(e) => {
                setBalcaoDate(e.target.value);
                setIsAttendanceActive(false);
              }}
              className="p-2.5 rounded-xl font-bold bg-[var(--bg)]"
            />
          </div>
          
          <div className="pt-4 flex-shrink-0">
            {!isAttendanceActive && !activeNotes ? (
              <button 
                onClick={startAttendance}
                className="px-4 py-2.5 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm transition"
              >
                <Play size={14} /> Iniciar Atendimento
              </button>
            ) : (
              <button 
                onClick={finishAttendance}
                className="px-4 py-2.5 bg-[var(--green-mid)] hover:bg-[var(--green)] text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm transition"
              >
                <Check size={14} /> Finalizar Atendimento
              </button>
            )}
          </div>
        </div>

        {(isAttendanceActive || activeNotes) && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <label className="text-xs font-bold text-[var(--text2)] block mb-1.5">Anotações Gerais do Atendimento</label>
            <textarea 
              value={activeNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Escreva livremente as demandas trazidas ao balcão hoje..."
              className="w-full min-h-36 p-3 text-sm rounded-xl outline-none"
            />
          </div>
        )}
      </div>

      {/* 2. BANCO DE DÚVIDAS / FAQ */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen size={16} /> Banco de Dúvidas (FAQ)
          </div>
          <button 
            onClick={() => setFaqForm({ idx: -1, titulo: "", resposta: "" })}
            className="px-3.5 py-1.5 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg flex items-center gap-0.5 shadow-sm"
          >
            <Plus size={14} /> Nova Dúvida
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" size={16} />
          <input 
            type="text" 
            value={faqBusca}
            onChange={(e) => setFaqBusca(e.target.value)}
            placeholder="Pesquisar dúvidas no banco..."
            className="w-full p-2.5 pl-9 text-xs rounded-xl"
          />
        </div>

        {/* Edit FAQ Form Overlay */}
        {faqForm && (
          <div className="border border-[var(--border)] bg-[var(--bg)]/10 p-4 rounded-xl mb-4 flex flex-col gap-3">
            <div className="text-xs font-bold text-[var(--text)] uppercase flex items-center gap-1">
              <Save size={14} /> {faqForm.idx >= 0 ? "Editar Dúvida FAQ" : "Criar FAQ de Atendimento"}
            </div>
            <div>
              <label className="text-[10px] font-bold text-[var(--text2)]">Título / Dúvida Comum</label>
              <input 
                type="text" 
                value={faqForm.titulo}
                onChange={(e) => setFaqForm(prev => prev ? { ...prev, titulo: e.target.value } : null)}
                placeholder="Ex: Novo servidor - o que fazer?"
                className="w-full p-2 bg-[var(--surface)] text-xs rounded-lg"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[var(--text2)]">Procedimento / Passo a passo</label>
              <textarea 
                value={faqForm.resposta}
                onChange={(e) => setFaqForm(prev => prev ? { ...prev, resposta: e.target.value } : null)}
                placeholder="Digite as instruções..."
                className="w-full p-2 bg-[var(--surface)] text-xs rounded-lg min-h-24 resize-y"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setFaqForm(null)} className="px-3 py-1 bg-white text-xs border rounded-lg">Cancelar</button>
              <button onClick={salvarFAQ} className="px-4 py-1 bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg">Salvar</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3.5 mt-2">
          {filteredFaq.map((f, i) => {
            const listIdx = state.faq.indexOf(f);
            const isExpanded = expandedFaqIdx === listIdx;
            return (
              <div 
                key={listIdx}
                className="border border-[var(--border)] bg-[var(--bg)]/5 rounded-xl hover:bg-[var(--bg)]/10 transition overflow-hidden"
              >
                <div 
                  onClick={() => setExpandedFaqIdx(isExpanded ? null : listIdx)}
                  className="p-4 flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <HelpCircle className="text-[var(--blue-mid)] flex-shrink-0" size={18} />
                    <span className="font-bold text-sm text-[var(--text)] truncate">{f.titulo}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setFaqForm({ idx: listIdx, titulo: f.titulo, resposta: f.resposta });
                        }} 
                        className="p-1.5 border border-[var(--border)] bg-white rounded hover:bg-[var(--bg)] text-[var(--text2)]"
                      >
                        <Edit size={11} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          excluirFAQ(listIdx);
                        }} 
                        className="p-1.5 border border-[var(--border)] bg-white rounded hover:bg-[var(--red-light)] text-[var(--red)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <ChevronDown size={16} className={`text-[var(--text2)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 text-xs font-semibold leading-relaxed text-[var(--text2)] border-t border-dashed border-[var(--border)] bg-white/50 whitespace-pre-wrap">
                    {f.resposta}
                  </div>
                )}
              </div>
            );
          })}
          {filteredFaq.length === 0 && (
            <div className="text-center p-8 text-xs text-[var(--text2)] font-semibold">
              Nenhuma dúvida registrada no banco de dados.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
