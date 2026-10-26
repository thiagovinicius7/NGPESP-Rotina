import React, { useEffect, useMemo, useState } from "react";
import { AppState, AtividadeLancamento, ProdutividadeDia, SessaoBalcao, TopicoBalcao } from "../types.js";
import { getSnapshotsFromIDB } from "../lib/idbStorage.js";
import { sessaoAtual, gravarSessaoNoEstado, encerrarSessaoNoEstado } from "../lib/balcaoSessao.js";
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

const LS_ANTIGO = "ngpesp_balcao_ativo"; // versão anterior guardava o atendimento só no navegador

function horaSP(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function ehAtendimentoBalcao(a: AtividadeLancamento): boolean {
  return !!a && (a.origem === "balcao" || a.sistema === "Balcão");
}

interface ItemBalcao { data: string; turno: "manha" | "tarde"; a: AtividadeLancamento }

export default function BalcaoPanel({ state, updateState, onToast, onIrProdutividade }: BalcaoPanelProps) {
  const hoje = getLocalDateIso();
  const sessao: SessaoBalcao | null = sessaoAtual(state);
  const [agora, setAgora] = useState(Date.now());
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [diaSel, setDiaSel] = useState<string>(hoje);
  const [novoTopico, setNovoTopico] = useState("");
  const [editTopico, setEditTopico] = useState<{ id: string; texto: string } | null>(null);
  const [apagarTopico, setApagarTopico] = useState<string | null>(null);

  // FAQ doubts
  const [faqBusca, setFaqBusca] = useState("");
  const [faqForm, setFaqForm] = useState<{ idx: number; titulo: string; resposta: string } | null>(null);
  const [expandedFaqIdx, setExpandedFaqIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!sessao) return;
    const t = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(t);
  }, [sessao]);

  const gravarSessao = (fn: (s: SessaoBalcao | null) => SessaoBalcao | null) =>
    updateState(prev => gravarSessaoNoEstado(prev, fn));

  // Atendimento que estava guardado no lugar antigo (configuração): passa para a produtividade
  useEffect(() => {
    const antigo = state.config?.balcaoSessao;
    if (antigo?.inicio) {
      updateState(prev => {
        const r = gravarSessaoNoEstado(prev, s => {
          if (!s) return { inicio: antigo.inicio, topicos: antigo.topicos || [] };
          const ids = new Set(s.topicos.map(t => t.id));
          return { ...s, topicos: [...s.topicos, ...(antigo.topicos || []).filter(t => !ids.has(t.id))] };
        });
        return { ...r, config: { ...prev.config, balcaoSessao: null } };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.balcaoSessao?.inicio]);

  // Atendimento aberto na versão anterior (só neste navegador): vira o plantão atual
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_ANTIGO) || "null");
      if (v?.inicio && !sessao) {
        const texto = [v.servidor, v.texto].map((x: string) => (x || "").trim()).filter(Boolean).join(" — ");
        gravarSessao(() => ({ inicio: v.inicio, topicos: texto ? [{ id: novoIdAtividade(), hora: horaSP(v.inicio), texto }] : [] }));
      }
      localStorage.removeItem(LS_ANTIGO);
    } catch (_) { /* ok */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Todos os atendimentos (os novos ficam na produtividade; os antigos eram uma anotação por dia)
  const porDia = useMemo(() => {
    const m = new Map<string, ItemBalcao[]>();
    Object.entries<ProdutividadeDia>(state.produtividade || {}).forEach(([k, d]) => {
      const iso = toYmdDate(k);
      (["manha", "tarde"] as const).forEach(turno => (d?.[turno] || []).forEach(a => {
        if (!ehAtendimentoBalcao(a) || a.emAndamento) return;
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

  // ---------- recuperar tópicos a partir das cópias automáticas deste computador ----------
  const [achados, setAchados] = useState<{ inicio: string; topicos: TopicoBalcao[]; visto: string }[] | null>(null);
  const [procurando, setProcurando] = useState(false);
  const procurarNasCopias = async () => {
    setProcurando(true);
    try {
      const copias = await getSnapshotsFromIDB(500);
      // tópicos que já estão salvos (no atendimento aberto ou em atendimentos encerrados)
      const jaTem = new Set<string>();
      (sessao?.topicos || []).forEach(t => jaTem.add(t.id));
      porDia.forEach(l => l.forEach(x => (x.a.topicos || []).forEach(t => jaTem.add(t.id))));
      const porInicio = new Map<string, { inicio: string; topicos: Map<string, TopicoBalcao>; visto: number }>();
      copias.forEach(c => {
        const ses: any = (c.state as any)?.config?.balcaoSessao?.inicio ? (c.state as any).config.balcaoSessao : sessaoAtual(c.state as any);
        if (!ses?.inicio || !Array.isArray(ses.topicos)) return;
        const g = porInicio.get(ses.inicio) || { inicio: ses.inicio, topicos: new Map(), visto: 0 };
        ses.topicos.forEach((t: TopicoBalcao) => { if (t?.id && t.texto && !jaTem.has(t.id)) g.topicos.set(t.id, t); });
        g.visto = Math.max(g.visto, c.timestamp);
        porInicio.set(ses.inicio, g);
      });
      const lista = Array.from(porInicio.values())
        .filter(g => g.topicos.size > 0)
        .sort((a, b) => b.inicio.localeCompare(a.inicio))
        .map(g => ({ inicio: g.inicio, topicos: Array.from(g.topicos.values()).sort((a, b) => a.hora.localeCompare(b.hora)), visto: new Date(g.visto).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) }));
      setAchados(lista);
      if (lista.length === 0) onToast("Nenhum tópico perdido encontrado nas cópias deste computador.", "info");
    } catch (e: any) {
      onToast("Não foi possível ler as cópias: " + (e?.message || e), "err");
    } finally {
      setProcurando(false);
    }
  };
  const recuperarSessao = (g: { inicio: string; topicos: TopicoBalcao[] }) => {
    gravarSessao(s => {
      if (s) {
        const ids = new Set(s.topicos.map(t => t.id));
        const topicos = [...s.topicos, ...g.topicos.filter(t => !ids.has(t.id))].sort((a, b) => a.hora.localeCompare(b.hora));
        return { ...s, inicio: s.inicio < g.inicio ? s.inicio : g.inicio, topicos };
      }
      return { inicio: g.inicio, topicos: g.topicos };
    });
    setAchados(null);
    onToast(`${g.topicos.length} tópico(s) de volta no atendimento aberto. Confira e encerre quando terminar.`, "ok");
  };

  // ---------- plantão de balcão ----------
  const iniciar = () => {
    gravarSessao(() => ({ inicio: new Date().toISOString(), topicos: [] }));
    setAgora(Date.now());
    onToast("Atendimento de balcão aberto. Lance os assuntos conforme for atendendo.", "ok");
  };

  const adicionarTopico = () => {
    const texto = novoTopico.trim();
    if (!texto) return;
    gravarSessao(s => s ? { ...s, topicos: [...s.topicos, { id: novoIdAtividade(), hora: horaSP(new Date()), texto }] } : s);
    setNovoTopico("");
  };

  const salvarEdicaoTopico = () => {
    if (!editTopico) return;
    const texto = editTopico.texto.trim();
    if (!texto) { onToast("O tópico não pode ficar vazio.", "err"); return; }
    gravarSessao(s => s ? { ...s, topicos: s.topicos.map(t => t.id === editTopico.id ? { ...t, texto } : t) } : s);
    setEditTopico(null);
  };

  const removerTopico = (id: string) => {
    gravarSessao(s => s ? { ...s, topicos: s.topicos.filter(t => t.id !== id) } : s);
    setApagarTopico(null);
  };

  const cancelar = () => {
    if (sessao && sessao.topicos.length > 0 && !confirm(`Descartar este atendimento e os ${sessao.topicos.length} tópico(s) lançados? Nada vai para a produtividade.`)) return;
    gravarSessao(() => null);
  };

  const encerrar = () => {
    if (!sessao) return;
    const pendente = novoTopico.trim();
    const topicos = pendente ? [...sessao.topicos, { id: novoIdAtividade(), hora: horaSP(new Date()), texto: pendente }] : sessao.topicos;
    if (topicos.length === 0) {
      onToast("Lance pelo menos um tópico antes de encerrar (ou cancele o atendimento).", "err");
      return;
    }
    const data = getLocalDateIso(new Date(sessao.inicio));
    const turno: "manha" | "tarde" = getSaoPauloHour(sessao.inicio) >= 12 ? "tarde" : "manha";
    updateState(prev => encerrarSessaoNoEstado(prev, topicos.map(t => ({ ...t }))));
    setNovoTopico("");
    setMes(data.slice(0, 7));
    setDiaSel(data);
    onToast(`Atendimento encerrado: ${topicos.length} tópico(s) salvos na produtividade (${turno === "manha" ? "manhã" : "tarde"}).`, "ok");
  };

  const minutos = sessao ? Math.max(0, Math.floor((agora - new Date(sessao.inicio).getTime()) / 60000)) : 0;
  const duracao = minutos >= 60 ? `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}` : `${minutos} min`;

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
  const topicosMes = celulas.reduce((n, iso) => n + (iso ? (porDia.get(iso) || []).reduce((m, x) => m + (x.a.topicos?.length || 0), 0) : 0), 0);
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
        <div className={`bg-[var(--surface)] border rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3 ${sessao ? "border-emerald-500/60 ring-2 ring-emerald-500/20" : "border-[var(--border)]"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
              <PhoneCall size={16} /> Atendimento de balcão
            </div>
            {sessao && (
              <div className="px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-full flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Aberto desde {horaSP(sessao.inicio)}{getLocalDateIso(new Date(sessao.inicio)) !== hoje ? ` de ${getLocalDateIso(new Date(sessao.inicio)).split("-").reverse().slice(0, 2).join("/")}` : ""} · {duracao}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
            <span className="text-[var(--text2)] font-semibold">Sumiram tópicos? Procure nas cópias automáticas deste computador.</span>
            <button type="button" onClick={procurarNasCopias} disabled={procurando} className="px-2.5 py-1 font-bold rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">
              {procurando ? "Procurando…" : "Recuperar tópicos"}
            </button>
          </div>
          {achados && achados.length > 0 && (
            <div className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-3">
              {achados.map(g => (
                <div key={g.inicio} className="flex flex-col gap-1.5">
                  <div className="text-xs font-black text-[var(--text)]">
                    Atendimento aberto em {new Date(g.inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {g.topicos.length} tópico(s) que não estão salvos agora
                    <span className="block text-[10px] font-semibold text-[var(--text2)]">última cópia com eles: {g.visto}</span>
                  </div>
                  {g.topicos.map(t => (
                    <div key={t.id} className="text-sm text-[var(--text)] break-words"><span className="font-mono text-[11px] text-[var(--text2)] mr-1.5">{t.hora}</span>{t.texto}</div>
                  ))}
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => recuperarSessao(g)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white">
                      {sessao ? "Juntar ao atendimento aberto" : "Reabrir com estes tópicos"}
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setAchados(null)} className="self-end text-[11px] font-bold text-[var(--text2)]">Fechar</button>
            </div>
          )}

          {!sessao ? (
            <>
              <p className="text-xs text-[var(--text2)]">
                Abra no começo do plantão no balcão. Durante o atendimento, lance cada assunto como um tópico (fica salvo na hora, na nuvem). No final, encerre: vai para a produtividade como 1 atendimento com todos os tópicos.
              </p>
              <button 
                onClick={iniciar}
                className="w-full py-3 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Play size={16} /> Abrir atendimento de balcão
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={novoTopico}
                  onChange={e => setNovoTopico(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); adicionarTopico(); } }}
                  placeholder="Assunto atendido (ex.: Maria, dúvida sobre aposentadoria) — Enter para lançar"
                  className="flex-1 min-w-0 p-2.5 text-sm rounded-xl border border-[var(--border2)] bg-[var(--bg)] focus:border-[var(--blue-mid)] outline-none"
                  autoFocus
                />
                <button onClick={adicionarTopico} disabled={!novoTopico.trim()} className="px-4 py-2 bg-[var(--blue-mid)] disabled:opacity-40 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                  <Plus size={14} /> Lançar
                </button>
              </div>

              <div className="flex flex-col divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
                {sessao.topicos.map((t, i) => (
                  <div key={t.id} className="px-3 py-2 flex items-start gap-2">
                    <span className="text-[11px] font-mono font-bold text-[var(--text2)] w-12 flex-shrink-0 pt-0.5">{t.hora}</span>
                    {editTopico?.id === t.id ? (
                      <div className="flex-1 flex gap-1.5">
                        <input
                          type="text"
                          value={editTopico.texto}
                          onChange={e => setEditTopico(v => v && { ...v, texto: e.target.value })}
                          onKeyDown={e => { if (e.key === "Enter") salvarEdicaoTopico(); if (e.key === "Escape") setEditTopico(null); }}
                          className="flex-1 min-w-0 p-1.5 text-sm rounded-lg border border-[var(--border2)] bg-[var(--surface)]"
                          autoFocus
                        />
                        <button onClick={salvarEdicaoTopico} className="px-2 text-xs font-bold rounded-lg bg-emerald-600 text-white"><Check size={13} /></button>
                        <button onClick={() => setEditTopico(null)} className="px-2 text-xs font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]"><X size={13} /></button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 text-sm text-[var(--text)] break-words"><b className="text-[var(--text2)] mr-1">{i + 1}.</b>{t.texto}</span>
                        {apagarTopico === t.id ? (
                          <span className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => removerTopico(t.id)} className="px-2 py-0.5 text-[11px] font-bold rounded bg-red-600 text-white">Apagar</button>
                            <button onClick={() => setApagarTopico(null)} className="px-2 py-0.5 text-[11px] font-bold rounded border border-[var(--border2)] text-[var(--text2)]">Não</button>
                          </span>
                        ) : (
                          <span className="flex items-center flex-shrink-0">
                            <button onClick={() => setEditTopico({ id: t.id, texto: t.texto })} className="p-1 rounded text-[var(--text2)] hover:text-[var(--blue-mid)]" title="Editar"><Edit size={12} /></button>
                            <button onClick={() => setApagarTopico(t.id)} className="p-1 rounded text-[var(--text2)] opacity-60 hover:opacity-100 hover:text-red-600" title="Apagar"><Trash2 size={12} /></button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {sessao.topicos.length === 0 && <div className="px-3 py-4 text-center text-xs text-[var(--text2)]">Nenhum tópico ainda. Lance cada assunto conforme for atendendo.</div>}
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-[var(--text2)]">{sessao.topicos.length} tópico(s) · salvo na nuvem (pode fechar e voltar, até de outro computador)</span>
                <div className="flex gap-2">
                  <button onClick={cancelar} className="px-3 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--bg)]">
                    Cancelar
                  </button>
                  <button onClick={encerrar} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm">
                    <Check size={16} /> Encerrar atendimento
                  </button>
                </div>
              </div>
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
                <span className="text-teal-600 dark:text-teal-400 text-lg font-black align-middle">{totalMes}</span> atendimento(s) em {diasComAtendimento} dia(s){topicosMes > 0 ? ` · ${topicosMes} tópico(s)` : ""}
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
                {a.topicos?.length ? (
                  <div className="mt-1 flex flex-col gap-0.5">
                    <div className="text-[10px] font-bold text-[var(--text2)]">{a.topicos.length} tópico(s)</div>
                    {a.topicos.map((t, j) => (
                      <div key={t.id || j} className="text-sm text-[var(--text)] break-words"><span className="font-mono text-[11px] text-[var(--text2)] mr-1.5">{t.hora}</span>{t.texto}</div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text)] mt-0.5 whitespace-pre-wrap break-words">{a.desc || "Sem anotação"}</div>
                )}
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
