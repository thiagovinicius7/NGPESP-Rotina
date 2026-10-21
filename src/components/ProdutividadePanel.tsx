import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, AtividadeLancamento, ProdutividadeDia } from "../types.js";
import { getLocalDateIso, toYmdDate, reconstructProdutividadeFromState } from "../lib/utils.js";
import { eventosDoDia } from "../lib/vidaFuncional.js";
import {
  SITUACOES, Turno, labelSituacao, situacaoTurno, situacaoGeral, diaVazio,
  novoIdAtividade, chaveAtividade, qtdNum
} from "../lib/produtividade.js";
import {
  Sunrise, Sunset, Plus, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight,
  Settings2, RefreshCw, History, Lock, PhoneCall, ArrowRight
} from "lucide-react";

interface Props {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: "ok" | "err" | "info") => void;
  dataInicial?: string;
}

interface Rascunho {
  chave: string;      // identifica o rascunho
  data: string;       // AAAA-MM-DD
  turno: Turno;
  alvo?: string;      // chave da atividade que está sendo editada (vazio = nova)
  qtd: string;
  tipo: string;
  sistema: string;
  desc: string;
  processosSei: string;
}

const LS_RASCUNHOS = "ngpesp_prod_rascunhos";

function lerRascunhos(): Record<string, Rascunho> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_RASCUNHOS) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch (_) {
    return {};
  }
}

function gravarRascunhos(r: Record<string, Rascunho>) {
  try {
    if (Object.keys(r).length) localStorage.setItem(LS_RASCUNHOS, JSON.stringify(r));
    else localStorage.removeItem(LS_RASCUNHOS);
  } catch (_) { /* sem armazenamento: rascunho fica só na memória */ }
}

function contarProcessos(txt: string): number {
  return (txt || "").split(/[,;\n]/).map(p => p.trim()).filter(Boolean).length;
}

function somarDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return getLocalDateIso(d);
}

/** Caixa de texto que cresce com o conteúdo e quebra linha. */
function TextoAuto(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, 38) + "px";
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} className={`resize-none overflow-hidden whitespace-pre-wrap break-words ${props.className || ""}`} />;
}

const corSituacao: Record<string, string> = {
  normal: "bg-[var(--blue-light)] text-[var(--blue-mid)] border-[var(--blue-mid)]/30",
  atestado: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  abono: "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/30",
  ferias: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  afastamento: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  folga: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  parcial: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
};

export default function ProdutividadePanel({ state, updateState, onToast, dataInicial }: Props) {
  const [prodData, setProdData] = useState(dataInicial || getLocalDateIso());
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>(lerRascunhos);
  const [confirmarExcluir, setConfirmarExcluir] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgTipos, setCfgTipos] = useState("");
  const [cfgSistemas, setCfgSistemas] = useState("");
  const [histMes, setHistMes] = useState(getLocalDateIso().slice(0, 7));
  const [histAberto, setHistAberto] = useState<string | null>(null);
  const [obsLocal, setObsLocal] = useState<string | null>(null);

  useEffect(() => { if (dataInicial) setProdData(dataInicial); }, [dataInicial]);
  useEffect(() => { gravarRascunhos(rascunhos); }, [rascunhos]);
  useEffect(() => { setConfirmarExcluir(null); setObsLocal(null); }, [prodData]);

  const tipos = state.filaAvulsa?.configProd?.tipos?.length ? state.filaAvulsa.configProd.tipos : ["Documento", "Processo", "Atendimento", "Outro"];
  const sistemas = state.filaAvulsa?.configProd?.sistemas?.length ? state.filaAvulsa.configProd.sistemas : ["SISREF", "SEI", "SIGRH", "Outro"];

  // A data pode ter sido gravada como AAAA-MM-DD ou DD/MM/AAAA em versões antigas
  const chaveDoDia = (prod: Record<string, ProdutividadeDia>, iso: string): string => {
    if (prod[iso]) return iso;
    const m = Object.keys(prod || {}).find(k => toYmdDate(k) === iso);
    return m || iso;
  };

  const prod = state.produtividade || {};
  const dia: ProdutividadeDia = prod[chaveDoDia(prod, prodData)] || diaVazio();

  const alterarDia = (fn: (d: ProdutividadeDia) => ProdutividadeDia) => {
    updateState(prev => {
      const p = { ...(prev.produtividade || {}) };
      const k = chaveDoDia(p, prodData);
      p[k] = fn(p[k] ? { ...p[k] } : diaVazio());
      return { produtividade: p };
    });
  };

  // ---------- situação por turno ----------
  const setSituacao = (turno: Turno | "dia", sit: string) => {
    alterarDia(d => {
      const m = turno === "tarde" ? situacaoTurno(d, "manha") : sit;
      const t = turno === "manha" ? situacaoTurno(d, "tarde") : sit;
      return { ...d, situacaoManha: m, situacaoTarde: t, situacao: situacaoGeral(m, t), sitEm: Date.now() };
    });
  };

  const salvarObs = (txt: string) => {
    if (txt === (dia.sitObs || "")) return;
    alterarDia(d => ({ ...d, sitObs: txt, sitEm: Date.now() }));
  };

  // ---------- rascunhos (nada vai para a nuvem antes de "Salvar") ----------
  const rascunhosDoTurno = (turno: Turno) =>
    (Object.values(rascunhos) as Rascunho[]).filter(r => r.data === prodData && r.turno === turno);
  const rascunhoDe = (turno: Turno, alvo: string) =>
    (Object.values(rascunhos) as Rascunho[]).find(r => r.data === prodData && r.turno === turno && r.alvo === alvo);

  const novaAtividade = (turno: Turno) => {
    const chave = `${prodData}|${turno}|novo-${Date.now()}`;
    setRascunhos(r => ({ ...r, [chave]: { chave, data: prodData, turno, qtd: "", tipo: tipos[0], sistema: sistemas[0], desc: "", processosSei: "" } }));
  };

  const editarAtividade = (turno: Turno, a: AtividadeLancamento) => {
    const alvo = chaveAtividade(a);
    if (rascunhoDe(turno, alvo)) return;
    const chave = `${prodData}|${turno}|${alvo}`;
    setRascunhos(r => ({
      ...r,
      [chave]: { chave, data: prodData, turno, alvo, qtd: String(a.qtd ?? ""), tipo: a.tipo || tipos[0], sistema: a.sistema || sistemas[0], desc: a.desc || "", processosSei: a.processosSei || "" }
    }));
  };

  const mudarRascunho = (chave: string, campo: keyof Rascunho, valor: string) =>
    setRascunhos(r => (r[chave] ? { ...r, [chave]: { ...r[chave], [campo]: valor } } : r));

  const descartarRascunho = (chave: string) =>
    setRascunhos(r => { const n = { ...r }; delete n[chave]; return n; });

  const salvarRascunho = (rs: Rascunho) => {
    const ehSei = rs.sistema === "SEI";
    const qtd = ehSei && contarProcessos(rs.processosSei) > 0 ? contarProcessos(rs.processosSei) : (parseInt(rs.qtd, 10) || 0);
    if (!qtd && !rs.desc.trim() && !rs.processosSei.trim()) {
      onToast("Preencha a quantidade ou os detalhes antes de salvar.", "err");
      return;
    }
    updateState(prev => {
      const p = { ...(prev.produtividade || {}) };
      const k = chaveDoDia(p, rs.data);
      const d: ProdutividadeDia = p[k] ? { ...p[k] } : diaVazio();
      const lista = [...(d[rs.turno] || [])];
      const pos = rs.alvo ? lista.findIndex(a => chaveAtividade(a) === rs.alvo) : -1;
      const antiga = pos >= 0 ? lista[pos] : undefined;
      const item: AtividadeLancamento = {
        ...(antiga || {}),
        qtd,
        tipo: rs.tipo,
        sistema: rs.sistema,
        desc: rs.desc.trim(),
        processosSei: ehSei ? rs.processosSei.trim() : "",
        id: antiga?.id || novoIdAtividade(),
        atualizadoEm: Date.now()
      };
      if (!ehSei) delete item.processosSei;
      if (pos >= 0) lista[pos] = item; else lista.push(item);
      const removidos = [...(d.removidos || [])];
      // atividade antiga (sem id) editada: a versão anterior não deve voltar ao juntar com outro computador
      if (antiga && !antiga.id) removidos.push(chaveAtividade(antiga));
      p[k] = { ...d, [rs.turno]: lista, ...(removidos.length ? { removidos } : {}) };
      return { produtividade: p };
    });
    descartarRascunho(rs.chave);
    onToast(rs.alvo ? "Atividade atualizada." : "Atividade salva.", "ok");
  };

  const excluirAtividade = (turno: Turno, a: AtividadeLancamento) => {
    const alvo = chaveAtividade(a);
    alterarDia(d => ({
      ...d,
      [turno]: (d[turno] || []).filter(x => chaveAtividade(x) !== alvo),
      removidos: [...(d.removidos || []), alvo]
    }));
    setConfirmarExcluir(null);
    onToast("Atividade excluída.", "info");
  };

  // ---------- outros ----------
  const recuperar = () => {
    if (!confirm("Recriar atividades a partir dos lançamentos do histórico e da fila? As atividades já registradas são mantidas.")) return;
    const reconstructed = reconstructProdutividadeFromState(state);
    updateState({ produtividade: reconstructed });
    onToast(`Produtividade conferida em ${Object.keys(reconstructed).length} dia(s).`, "ok");
  };

  const abrirCfg = () => {
    setCfgTipos(tipos.join(", "));
    setCfgSistemas(sistemas.join(", "));
    setCfgOpen(true);
  };

  const salvarCfg = () => {
    const t = cfgTipos.split(",").map(x => x.trim()).filter(Boolean);
    const s = cfgSistemas.split(",").map(x => x.trim()).filter(Boolean);
    if (!t.length || !s.length) { onToast("Preencha os tipos e os sistemas.", "err"); return; }
    updateState(prev => ({ filaAvulsa: { ...prev.filaAvulsa, configProd: { tipos: t, sistemas: s } } }));
    setCfgOpen(false);
    onToast("Configuração salva.", "ok");
  };

  // O que a Vida Funcional registra para este dia (férias, abono, afastamento)
  const eventosVida = eventosDoDia(state, prodData);
  const vidaAlvo = (() => {
    let m = situacaoTurno(dia, "manha"), t = situacaoTurno(dia, "tarde");
    eventosVida.forEach(e => {
      if (!e.turno || e.turno === "manha") m = e.situacao;
      if (!e.turno || e.turno === "tarde") t = e.situacao;
    });
    return { m, t };
  })();
  const precisaAplicarVida = eventosVida.length > 0 && (vidaAlvo.m !== situacaoTurno(dia, "manha") || vidaAlvo.t !== situacaoTurno(dia, "tarde"));
  const aplicarVida = () => {
    alterarDia(d => ({ ...d, situacaoManha: vidaAlvo.m, situacaoTarde: vidaAlvo.t, situacao: situacaoGeral(vidaAlvo.m, vidaAlvo.t), sitEm: Date.now() }));
    onToast("Situação do dia atualizada.", "ok");
  };

  // ---------- números ----------
  const todas = [...(dia.manha || []), ...(dia.tarde || [])];
  const totalItens = todas.reduce((s, a) => s + qtdNum(a), 0);
  const sistemasUsados = Array.from(new Set(todas.map(a => a.sistema).filter(Boolean))).join(", ") || "—";
  const pendentesNoDia = (Object.values(rascunhos) as Rascunho[]).filter(r => r.data === prodData).length;
  const pendentesOutros = (Object.values(rascunhos) as Rascunho[]).filter(r => r.data !== prodData);

  const dataObj = new Date(prodData + "T12:00:00");
  const diaSemana = dataObj.toLocaleDateString("pt-BR", { weekday: "long" });
  const ehEscala = [1, 3].includes(dataObj.getDay());
  const hoje = getLocalDateIso();

  const mesesOpc = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const base = new Date();
    for (let m = 0; m < 12; m++) {
      const d = new Date(base.getFullYear(), base.getMonth() - m, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ value: v, label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) });
    }
    return out;
  }, []);

  const diasHist = Object.keys(prod)
    .map(k => ({ k, iso: toYmdDate(k) }))
    .filter(x => x.iso.startsWith(histMes))
    .sort((a, b) => b.iso.localeCompare(a.iso));

  // ---------- pedaços de tela ----------
  const opcoes = (lista: string[], atual: string) => (lista.includes(atual) || !atual ? lista : [...lista, atual]);

  const FormRascunho = ({ rs }: { rs: Rascunho }) => {
    const ehSei = rs.sistema === "SEI";
    const nProc = contarProcessos(rs.processosSei);
    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvarRascunho(rs); }
      if (e.key === "Escape") { e.preventDefault(); descartarRascunho(rs.chave); }
    };
    return (
      <div className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2.5" onKeyDown={onKey}>
        <div className="grid grid-cols-[72px_1fr_1fr] gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-[var(--text2)]">Qtd</span>
            <input
              type="text"
              inputMode="numeric"
              value={ehSei && nProc > 0 ? String(nProc) : rs.qtd}
              onChange={e => mudarRascunho(rs.chave, "qtd", e.target.value.replace(/\D/g, ""))}
              disabled={ehSei && nProc > 0}
              placeholder="0"
              className="w-full p-2 text-center text-sm font-black rounded-lg border border-[var(--border2)] bg-[var(--surface)] disabled:opacity-60"
              autoFocus={!rs.alvo}
            />
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] font-bold text-[var(--text2)]">Tipo</span>
            <select value={rs.tipo} onChange={e => mudarRascunho(rs.chave, "tipo", e.target.value)} className="w-full p-2 text-xs rounded-lg border border-[var(--border2)] bg-[var(--surface)]">
              {opcoes(tipos, rs.tipo).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] font-bold text-[var(--text2)]">Sistema</span>
            <select value={rs.sistema} onChange={e => mudarRascunho(rs.chave, "sistema", e.target.value)} className="w-full p-2 text-xs rounded-lg border border-[var(--border2)] bg-[var(--surface)]">
              {opcoes(sistemas, rs.sistema).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-[var(--text2)]">Detalhes</span>
          <TextoAuto
            value={rs.desc}
            onChange={e => mudarRascunho(rs.chave, "desc", e.target.value)}
            placeholder="O que foi feito (ex.: lançamento de afastamentos de 40 servidores de JUL/26)"
            className="w-full p-2 text-sm leading-snug rounded-lg border border-[var(--border2)] bg-[var(--surface)]"
            autoFocus={!!rs.alvo}
            spellCheck
          />
        </label>
        {ehSei && (
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-[var(--text2)]">Processos SEI (um por linha ou separados por vírgula — a quantidade é contada sozinha)</span>
            <TextoAuto
              value={rs.processosSei}
              onChange={e => mudarRascunho(rs.chave, "processosSei", e.target.value)}
              placeholder="00060-00000000/2026-00 (assunto)"
              className="w-full p-2 font-mono text-xs leading-snug rounded-lg border border-[var(--border2)] bg-[var(--surface)]"
            />
          </label>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Ainda não salvo
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => descartarRascunho(rs.chave)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text2)]">
              Cancelar
            </button>
            <button type="button" onClick={() => salvarRascunho(rs)} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1" title="Ctrl+Enter">
              <Check size={14} /> Salvar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const LinhaAtividade = ({ turno, a }: { turno: Turno; a: AtividadeLancamento }) => {
    const chave = chaveAtividade(a);
    const pedindoExclusao = confirmarExcluir === `${turno}|${chave}`;
    const ehBalcao = a.origem === "balcao" || a.sistema === "Balcão";
    return (
      <div className="group flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="w-11 flex-shrink-0 text-center">
          <div className="text-base font-black text-[var(--blue-mid)] leading-none">{qtdNum(a) || "—"}</div>
          <div className="text-[9px] font-bold text-[var(--text2)] uppercase mt-0.5">qtd</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-bold">
            <span className="px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text)]">{a.tipo || "—"}</span>
            <span className={`px-1.5 py-0.5 rounded ${ehBalcao ? "bg-teal-500/10 text-teal-700 dark:text-teal-300" : "bg-[var(--bg)] text-[var(--text2)]"}`}>
              {ehBalcao && <PhoneCall size={10} className="inline mr-0.5 -mt-0.5" />}{a.sistema || "—"}
            </span>
            {a.inicio && <span className="text-[var(--text2)] font-semibold">{a.inicio}{a.fim ? `–${a.fim}` : ""}</span>}
            <Lock size={10} className="text-[var(--text2)] opacity-50" aria-label="Salva" />
          </div>
          {a.desc ? (
            <div className="text-sm text-[var(--text)] mt-1 whitespace-pre-wrap break-words leading-snug">{a.desc}</div>
          ) : !a.processosSei ? (
            <div className="text-xs text-[var(--text2)] italic mt-1">Sem detalhes</div>
          ) : null}
          {a.processosSei && (
            <div className="text-[11px] font-mono text-[var(--text2)] mt-1 whitespace-pre-wrap break-words leading-snug">{a.processosSei}</div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {pedindoExclusao ? (
            <>
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400 mr-1">Excluir?</span>
              <button type="button" onClick={() => excluirAtividade(turno, a)} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-red-600 text-white">Sim</button>
              <button type="button" onClick={() => setConfirmarExcluir(null)} className="px-2 py-1 text-[11px] font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]">Não</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => editarAtividade(turno, a)} className="p-2 rounded-lg text-[var(--text2)] hover:bg-[var(--bg)] hover:text-[var(--blue-mid)]" title="Editar">
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => setConfirmarExcluir(`${turno}|${chave}`)} className="p-2 rounded-lg text-[var(--text2)] opacity-60 hover:opacity-100 hover:bg-red-500/10 hover:text-red-600" title="Excluir">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const CartaoTurno = ({ turno }: { turno: Turno }) => {
    const sit = situacaoTurno(dia, turno);
    const lista = dia[turno] || [];
    const novos = rascunhosDoTurno(turno).filter(r => !r.alvo);
    const itens = lista.reduce((s, a) => s + qtdNum(a), 0);
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {turno === "manha" ? <Sunrise className="text-[var(--amber-mid)]" size={18} /> : <Sunset className="text-[var(--teal-mid)]" size={18} />}
            <span className="text-sm font-black text-[var(--text)]">{turno === "manha" ? "Manhã" : "Tarde"}</span>
            <span className="text-[11px] font-bold text-[var(--text2)]">{lista.length} atividade(s) · {itens} itens</span>
          </div>
          <select
            value={sit}
            onChange={e => setSituacao(turno, e.target.value)}
            className={`px-2.5 py-1 text-xs font-bold rounded-full border cursor-pointer ${corSituacao[sit] || corSituacao.normal}`}
            title="Situação deste turno"
          >
            {SITUACOES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        {sit !== "normal" && (
          <div className={`text-xs font-bold px-3 py-2 rounded-lg border ${corSituacao[sit]}`}>
            {turno === "manha" ? "Manhã" : "Tarde"} registrada como {labelSituacao(sit).toLowerCase()}.
            {lista.length > 0 ? " As atividades abaixo continuam salvas." : ""}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {lista.map(a => {
            const rs = rascunhoDe(turno, chaveAtividade(a));
            return rs ? <React.Fragment key={rs.chave}>{FormRascunho({ rs })}</React.Fragment> : <React.Fragment key={chaveAtividade(a)}>{LinhaAtividade({ turno, a })}</React.Fragment>;
          })}
          {/* edição de atividade que não está mais na lista (excluída em outro computador) */}
          {rascunhosDoTurno(turno).filter(r => r.alvo && !lista.some(a => chaveAtividade(a) === r.alvo)).map(rs => <React.Fragment key={rs.chave}>{FormRascunho({ rs })}</React.Fragment>)}
          {novos.map(rs => <React.Fragment key={rs.chave}>{FormRascunho({ rs })}</React.Fragment>)}
          {lista.length === 0 && novos.length === 0 && (
            <div className="text-center py-3 text-xs text-[var(--text2)]">Nenhuma atividade neste turno.</div>
          )}
        </div>

        <button
          type="button"
          onClick={() => novaAtividade(turno)}
          className="w-full py-2 border border-dashed border-[var(--blue-mid)]/40 text-[var(--blue-mid)] hover:bg-[var(--blue-light)] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
        >
          <Plus size={14} /> Adicionar atividade
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {/* DATA */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setProdData(somarDias(prodData, -1))} className="p-2 rounded-lg border border-[var(--border2)] hover:bg-[var(--bg)]" title="Dia anterior"><ChevronLeft size={16} /></button>
          <input type="date" value={prodData} onChange={e => e.target.value && setProdData(e.target.value)} className="p-2 rounded-xl font-bold bg-[var(--bg)] border border-[var(--border2)]" />
          <button type="button" onClick={() => setProdData(somarDias(prodData, 1))} className="p-2 rounded-lg border border-[var(--border2)] hover:bg-[var(--bg)]" title="Próximo dia"><ChevronRight size={16} /></button>
          {prodData !== hoje && (
            <button type="button" onClick={() => setProdData(hoje)} className="px-3 py-2 text-xs font-bold rounded-lg bg-[var(--blue-light)] text-[var(--blue-mid)]">Hoje</button>
          )}
          <div className="flex flex-col ml-1">
            <span className="text-sm font-black text-[var(--text)] capitalize">{diaSemana}</span>
            <span className={`text-[11px] font-bold ${ehEscala ? "text-[var(--green-mid)]" : "text-[var(--text2)]"}`}>
              {ehEscala ? "Dia de escala (7h–12h / 13h–18h)" : "Fora da escala regular"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={e => { if (e.target.value) setSituacao("dia", e.target.value); }}
            className="px-2.5 py-2 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text2)] cursor-pointer"
            title="Marcar o dia todo de uma vez"
          >
            <option value="">Dia todo…</option>
            {SITUACOES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" onClick={recuperar} className="p-2.5 rounded-lg border border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--bg)]" title="Recuperar atividades a partir dos lançamentos">
            <RefreshCw size={15} />
          </button>
          <button type="button" onClick={abrirCfg} className="p-2.5 rounded-lg border border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--bg)]" title="Configurar tipos e sistemas">
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      {eventosVida.length > 0 && (
        <div className="text-xs font-bold px-4 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 flex-wrap">
          <span>Na Vida Funcional: {eventosVida.map(e => e.texto).join(" · ")}</span>
          {precisaAplicarVida && (
            <button type="button" onClick={aplicarVida} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold">
              Marcar o dia assim
            </button>
          )}
        </div>
      )}

      {pendentesOutros.length > 0 && (
        <div className="text-xs font-bold px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-center gap-2 flex-wrap">
          Há {pendentesOutros.length} atividade(s) não salva(s) em outro dia:
          {Array.from(new Set(pendentesOutros.map(r => r.data))).map(d => (
            <button key={d} type="button" onClick={() => setProdData(d)} className="underline">{d.split("-").reverse().join("/")}</button>
          ))}
        </div>
      )}

      {cfgOpen && (
        <div className="bg-[var(--surface)] border border-[var(--border)] p-5 rounded-2xl shadow-sm flex flex-col gap-3">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5"><Settings2 size={14} /> Tipos e sistemas</div>
          <label className="text-xs font-semibold">Tipos de atividade (separados por vírgula)
            <TextoAuto value={cfgTipos} onChange={e => setCfgTipos(e.target.value)} className="w-full mt-1 p-2 border border-[var(--border2)] rounded-lg text-xs bg-[var(--bg)]" />
          </label>
          <label className="text-xs font-semibold">Sistemas (separados por vírgula)
            <TextoAuto value={cfgSistemas} onChange={e => setCfgSistemas(e.target.value)} className="w-full mt-1 p-2 border border-[var(--border2)] rounded-lg text-xs bg-[var(--bg)]" />
          </label>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCfgOpen(false)} className="px-3 py-1.5 text-xs font-bold border border-[var(--border2)] rounded-lg">Cancelar</button>
            <button type="button" onClick={salvarCfg} className="px-4 py-1.5 text-xs font-bold bg-[var(--blue-mid)] text-white rounded-lg">Salvar</button>
          </div>
        </div>
      )}

      {/* TURNOS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 items-start">
        {CartaoTurno({ turno: "manha" })}
        {CartaoTurno({ turno: "tarde" })}
      </div>

      {/* RESUMO DO DIA */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider">Resumo do dia</span>
          <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full border ${corSituacao[situacaoGeral(situacaoTurno(dia, "manha"), situacaoTurno(dia, "tarde"))]}`}>
            {situacaoTurno(dia, "manha") === situacaoTurno(dia, "tarde")
              ? labelSituacao(situacaoTurno(dia, "manha"))
              : `Manhã: ${labelSituacao(situacaoTurno(dia, "manha"))} · Tarde: ${labelSituacao(situacaoTurno(dia, "tarde"))}`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-[var(--bg)]"><div className="text-xl font-black text-[var(--blue-mid)]">{totalItens}</div><div className="text-[10px] font-bold text-[var(--text2)] uppercase">Itens</div></div>
          <div className="p-3 rounded-xl bg-[var(--bg)]"><div className="text-xl font-black text-[var(--text)]">{todas.length}</div><div className="text-[10px] font-bold text-[var(--text2)] uppercase">Atividades</div></div>
          <div className="p-3 rounded-xl bg-[var(--bg)] min-w-0"><div className="text-sm font-black text-[var(--text)] truncate" title={sistemasUsados}>{sistemasUsados}</div><div className="text-[10px] font-bold text-[var(--text2)] uppercase mt-1">Sistemas</div></div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-[var(--text2)]">Anotação do dia (opcional — ex.: atestado de comparecimento das 8h às 10h)</span>
          <TextoAuto
            value={obsLocal ?? dia.sitObs ?? ""}
            onChange={e => setObsLocal(e.target.value)}
            onBlur={() => { if (obsLocal !== null) { salvarObs(obsLocal); setObsLocal(null); } }}
            placeholder="Escreva e clique fora para salvar"
            className="w-full p-2 text-sm rounded-lg border border-[var(--border2)] bg-[var(--bg)]"
          />
        </label>
        {pendentesNoDia > 0 && (
          <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300">{pendentesNoDia} atividade(s) deste dia ainda não salva(s).</div>
        )}
      </div>

      {/* HISTÓRICO DO MÊS */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 lg:px-5 py-3 border-b border-[var(--border)] flex justify-between items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5"><History size={14} /> Dias registrados</span>
          <select value={histMes} onChange={e => setHistMes(e.target.value)} className="p-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] capitalize">
            {mesesOpc.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="divide-y divide-[var(--border)] max-h-[28rem] overflow-y-auto">
          {diasHist.map(({ k, iso }) => {
            const d = prod[k] || diaVazio();
            const sm = situacaoTurno(d, "manha"), st = situacaoTurno(d, "tarde");
            const its = [...(d.manha || []), ...(d.tarde || [])];
            const n = its.reduce((s, a) => s + qtdNum(a), 0);
            const aberto = histAberto === iso;
            return (
              <div key={k}>
                <div className={`px-4 lg:px-5 py-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer hover:bg-[var(--bg)] ${iso === prodData ? "bg-[var(--blue-light)]/50" : ""}`} onClick={() => setHistAberto(aberto ? null : iso)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[var(--text)] capitalize w-24">{new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
                    {sm === st ? (
                      <span className={`px-2 py-0.5 font-bold rounded-full border ${corSituacao[sm]}`}>{labelSituacao(sm)}</span>
                    ) : (
                      <>
                        <span className={`px-2 py-0.5 font-bold rounded-full border ${corSituacao[sm]}`}>M: {labelSituacao(sm)}</span>
                        <span className={`px-2 py-0.5 font-bold rounded-full border ${corSituacao[st]}`}>T: {labelSituacao(st)}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 font-bold text-[var(--text2)]">
                    {n > 0 && <span className="text-[var(--blue-mid)]">{n} itens</span>}
                    <button type="button" onClick={e => { e.stopPropagation(); setProdData(iso); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="px-2 py-1 rounded-lg border border-[var(--border2)] text-[var(--blue-mid)] flex items-center gap-0.5 hover:bg-[var(--blue-light)]">
                      Abrir <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
                {aberto && its.length > 0 && (
                  <div className="px-4 lg:px-5 pb-3 flex flex-col gap-1 text-xs text-[var(--text2)]">
                    {its.map((it, i) => (
                      <div key={i} className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1">
                        <span className="min-w-0 break-words"><b className="text-[var(--text)]">{it.tipo}</b> ({it.sistema}) — {it.desc || it.processosSei || "sem detalhes"}</span>
                        <span className="font-black text-[var(--text)] flex-shrink-0">{qtdNum(it)}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {diasHist.length === 0 && <div className="text-center p-8 text-xs font-bold text-[var(--text2)]">Nenhum dia registrado neste mês.</div>}
        </div>
      </div>
    </div>
  );
}
