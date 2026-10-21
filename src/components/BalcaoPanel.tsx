import React, { useEffect, useMemo, useState } from "react";
import { AppState, AtividadeLancamento, ProdutividadeDia } from "../types.js";
import { getLocalDateIso, getSaoPauloHour, toYmdDate } from "../lib/utils.js";
import { diaVazio, novoIdAtividade } from "../lib/produtividade.js";
import { 
  PhoneCall, Play, Check, BookOpen, Plus, Search, 
  Trash2, Save, X, HelpCircle, Edit, ChevronDown, ChevronLeft, ChevronRight, ArrowRight, Clock
} from "lucide-react";

interface BalcaoPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  onIrProdutividade?: (data: string) => void;
}

interface AtendimentoAtivo {
  inicio: string;   // ISO
  texto: string;
  servidor: string;
}

const LS_ATIVO = "ngpesp_balcao_ativo";

function lerAtivo(): AtendimentoAtivo | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_ATIVO) || "null");
    return v && v.inicio ? v : null;
  } catch (_) {
    return null;
  }
}

function gravarAtivo(v: AtendimentoAtivo | null) {
  try {
    if (v) localStorage.setItem(LS_ATIVO, JSON.stringify(v));
    else localStorage.removeItem(LS_ATIVO);
  } catch (_) { /* sem armazenamento: fica só na memória */ }
}

function horaSP(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function ehAtendimentoBalcao(a: AtividadeLancamento): boolean {
  return !!a && (a.origem === "balcao" || a.sistema === "Balcão");
}

interface ItemBalcao { data: string; turno: "manha" | "tarde"; a: AtividadeLancamento }

export default function BalcaoPanel({ state, updateState, onToast, onIrProdutividade }: BalcaoPanelProps) {
  const hoje = getLocalDateIso();
  const [ativo, setAtivo] = useState<AtendimentoAtivo | null>(lerAtivo);
  const [agora, setAgora] = useState(Date.now());
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [diaSel, setDiaSel] = useState<string>(hoje);

  // FAQ doubts
  const [faqBusca, setFaqBusca] = useState("");
  const [faqForm, setFaqForm] = useState<{ idx: number; titulo: string; resposta: string } | null>(null);
  const [expandedFaqIdx, setExpandedFaqIdx] = useState<number | null>(null);

  useEffect(() => { gravarAtivo(ativo); }, [ativo]);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), 15000);
    return () => clearInterval(t);
  }, [ativo]);

  // Todos os atendimentos (os novos ficam na produtividade; os antigos eram uma anotação por dia)
  const porDia = useMemo(() => {
    const m = new Map<string, ItemBalcao[]>();
    Object.entries<ProdutividadeDia>(state.produtividade || {}).forEach(([k, d]) => {
      const iso = toYmdDate(k);
      (["manha", "tarde"] as const).forEach(turno => (d?.[turno] || []).forEach(a => {
        if (!ehAtendimentoBalcao(a)) return;
        if (!m.has(iso)) m.set(iso, []);
        m.get(iso)!.push({ data: iso, turno, a });
      }));
    });
    m.forEach(l => l.sort((x, y) => (x.a.inicio || "").localeCompare(y.a.inicio || "")));
    return m;
  }, [state.produtividade]);

  const anotacoesAntigas = (iso: string): string[] =>
    String(state.balcaoAtendimentos?.[iso] || "").split("\n").map(l => l.trim()).filter(Boolean);

  const contarDia = (iso: string) => (porDia.get(iso)?.length || 0) + anotacoesAntigas(iso).length;

  // ---------- atendimento em andamento ----------
  const iniciar = () => {
    setAtivo({ inicio: new Date().toISOString(), texto: "", servidor: "" });
    setAgora(Date.now());
  };

  const cancelar = () => {
    if (ativo && (ativo.texto.trim() || ativo.servidor.trim()) && !confirm("Descartar este atendimento sem salvar?")) return;
    setAtivo(null);
  };

  const finalizar = () => {
    if (!ativo) return;
    const texto = ativo.texto.trim();
    const servidor = ativo.servidor.trim();
    if (!texto && !servidor) {
      onToast("Escreva o que foi tratado antes de finalizar.", "err");
      return;
    }
    const data = getLocalDateIso(new Date(ativo.inicio));
    const turno: "manha" | "tarde" = getSaoPauloHour(ativo.inicio) >= 12 ? "tarde" : "manha";
    const item: AtividadeLancamento = {
      id: novoIdAtividade(),
      qtd: 1,
      tipo: "Atendimento",
      sistema: "Balcão",
      desc: servidor ? `${servidor} — ${texto}` : texto,
      origem: "balcao",
      inicio: horaSP(ativo.inicio),
      fim: horaSP(new Date()),
      atualizadoEm: Date.now()
    };
    updateState(prev => {
      const p = { ...(prev.produtividade || {}) };
      const k = p[data] ? data : (Object.keys(p).find(x => toYmdDate(x) === data) || data);
      const d: ProdutividadeDia = p[k] ? { ...p[k] } : diaVazio();
      p[k] = { ...d, [turno]: [...(d[turno] || []), item] };
      return { produtividade: p };
    });
    setAtivo(null);
    setMes(data.slice(0, 7));
    setDiaSel(data);
    onToast(`Atendimento salvo na produtividade (${turno === "manha" ? "manhã" : "tarde"}).`, "ok");
  };

  const minutos = ativo ? Math.max(0, Math.floor((agora - new Date(ativo.inicio).getTime()) / 60000)) : 0;

  // ---------- calendário do mês ----------
  const [ano, mesNum] = mes.split("-").map(Number);
  const primeiro = new Date(ano, mesNum - 1, 1);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const celulas: (string | null)[] = [];
  for (let i = 0; i < primeiro.getDay(); i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(`${mes}-${String(d).padStart(2, "0")}`);
  const totalMes = celulas.reduce((s, iso) => s + (iso ? contarDia(iso) : 0), 0);
  const diasComAtendimento = celulas.filter(iso => iso && contarDia(iso) > 0).length;
  const mudarMes = (n: number) => {
    const d = new Date(ano, mesNum - 1 + n, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nomeMes = primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const itensDiaSel = porDia.get(diaSel) || [];
  const antigasDiaSel = anotacoesAntigas(diaSel);

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
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-4 lg:gap-5 items-start">
        <div className={`bg-[var(--surface)] border rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3 ${ativo ? "border-emerald-500/60 ring-2 ring-emerald-500/20" : "border-[var(--border)]"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
              <PhoneCall size={16} /> Atendimento de balcão
            </div>
            {ativo && (
              <div className="px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-full flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Em atendimento desde {horaSP(ativo.inicio)} · {minutos} min
              </div>
            )}
          </div>

          {!ativo ? (
            <>
              <p className="text-xs text-[var(--text2)]">
                Clique em iniciar quando alguém chegar ao balcão. Ao finalizar, o atendimento é salvo na produtividade do dia (manhã ou tarde, pelo horário).
              </p>
              <button 
                onClick={iniciar}
                className="w-full py-3 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Play size={16} /> Iniciar atendimento
              </button>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-[var(--text2)]">Servidor atendido (opcional)</span>
                <input
                  type="text"
                  value={ativo.servidor}
                  onChange={e => setAtivo(v => v ? { ...v, servidor: e.target.value } : v)}
                  placeholder="Nome ou matrícula"
                  className="w-full p-2.5 text-sm rounded-xl border border-[var(--border2)] bg-[var(--bg)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-[var(--text2)]">O que foi tratado</span>
                <textarea
                  value={ativo.texto}
                  onChange={e => setAtivo(v => v ? { ...v, texto: e.target.value } : v)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finalizar(); } }}
                  placeholder="Ex.: dúvida sobre aposentadoria; orientado a abrir processo no SEI"
                  className="w-full min-h-28 p-3 text-sm rounded-xl border border-[var(--border2)] bg-[var(--bg)] focus:border-[var(--blue-mid)] outline-none resize-y whitespace-pre-wrap"
                  autoFocus
                />
              </label>
              <div className="flex gap-2 justify-end flex-wrap">
                <button onClick={cancelar} className="px-4 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--bg)]">
                  Cancelar
                </button>
                <button 
                  onClick={finalizar}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                  title="Ctrl+Enter"
                >
                  <Check size={16} /> Finalizar e salvar
                </button>
              </div>
              <p className="text-[10px] text-[var(--text2)]">O texto fica guardado neste navegador até você finalizar, mesmo se recarregar a página.</p>
            </>
          )}
        </div>

        {/* BALCÃO NO MÊS */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => mudarMes(-1)} className="p-1.5 rounded-lg border border-[var(--border2)] hover:bg-[var(--bg)]" title="Mês anterior"><ChevronLeft size={16} /></button>
            <div className="text-center">
              <div className="text-sm font-black text-[var(--text)] capitalize">{nomeMes}</div>
              <div className="text-xs font-bold text-[var(--text2)]">
                <span className="text-teal-600 dark:text-teal-400 text-lg font-black align-middle">{totalMes}</span> atendimento(s) em {diasComAtendimento} dia(s)
              </div>
            </div>
            <button onClick={() => mudarMes(1)} className="p-1.5 rounded-lg border border-[var(--border2)] hover:bg-[var(--bg)]" title="Próximo mês"><ChevronRight size={16} /></button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
              <div key={i} className="text-[10px] font-bold text-[var(--text2)] py-1">{d}</div>
            ))}
            {celulas.map((iso, i) => {
              if (!iso) return <div key={i} />;
              const n = contarDia(iso);
              const sel = iso === diaSel;
              return (
                <button
                  key={iso}
                  onClick={() => setDiaSel(iso)}
                  className={`relative h-10 rounded-lg text-xs font-bold transition border ${sel ? "border-[var(--blue-mid)] ring-2 ring-[var(--blue-mid)]/30" : "border-transparent"} ${n > 0 ? "bg-teal-500/15 text-teal-800 dark:text-teal-200 hover:bg-teal-500/25" : "text-[var(--text2)] hover:bg-[var(--bg)]"} ${iso === hoje ? "underline" : ""}`}
                >
                  {Number(iso.slice(8))}
                  {n > 0 && <span className="absolute top-0.5 right-1 text-[9px] font-black text-teal-700 dark:text-teal-300">{n}</span>}
                </button>
              );
            })}
          </div>

          <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-[var(--text)] capitalize">
                {new Date(diaSel + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
              </span>
              {onIrProdutividade && (
                <button onClick={() => onIrProdutividade(diaSel)} className="text-[11px] font-bold text-[var(--blue-mid)] flex items-center gap-0.5 hover:underline">
                  Abrir na produtividade <ArrowRight size={12} />
                </button>
              )}
            </div>
            {itensDiaSel.map(({ a, turno }, i) => (
              <div key={a.id || i} className="p-2.5 rounded-xl bg-[var(--bg)] text-xs">
                <div className="flex items-center gap-1.5 font-bold text-[var(--text2)]">
                  <Clock size={11} /> {a.inicio || (turno === "manha" ? "Manhã" : "Tarde")}{a.fim ? `–${a.fim}` : ""}
                </div>
                <div className="text-sm text-[var(--text)] mt-0.5 whitespace-pre-wrap break-words">{a.desc || "Sem anotação"}</div>
              </div>
            ))}
            {antigasDiaSel.length > 0 && (
              <div className="p-2.5 rounded-xl bg-[var(--bg)] text-xs">
                <div className="font-bold text-[var(--text2)] mb-1">Anotações do dia (versão anterior)</div>
                {antigasDiaSel.map((l, i) => <div key={i} className="text-sm text-[var(--text)]">• {l}</div>)}
              </div>
            )}
            {itensDiaSel.length === 0 && antigasDiaSel.length === 0 && (
              <div className="text-xs text-[var(--text2)] text-center py-2">Nenhum atendimento neste dia.</div>
            )}
          </div>
        </div>
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
            className="w-full p-2.5 !pl-9 text-xs rounded-xl"
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
              <button onClick={() => setFaqForm(null)} className="px-3 py-1 bg-[var(--surface)] text-xs border rounded-lg">Cancelar</button>
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
                        className="p-1.5 border border-[var(--border)] bg-[var(--surface)] rounded hover:bg-[var(--bg)] text-[var(--text2)]"
                      >
                        <Edit size={11} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          excluirFAQ(listIdx);
                        }} 
                        className="p-1.5 border border-[var(--border)] bg-[var(--surface)] rounded hover:bg-[var(--red-light)] text-[var(--red)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <ChevronDown size={16} className={`text-[var(--text2)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 text-xs font-semibold leading-relaxed text-[var(--text2)] border-t border-dashed border-[var(--border)] bg-[var(--surface)]/50 whitespace-pre-wrap">
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
