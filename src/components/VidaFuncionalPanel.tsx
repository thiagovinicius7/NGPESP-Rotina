import React, { useMemo, useState } from "react";
import { AppState, Absence, PeriodoFerias, AbonoData, SeiProcess } from "../types.js";
import { getLocalDateIso } from "../lib/utils.js";
import { periodoAfastamento, diasEntre, fmtBR } from "../lib/vidaFuncional.js";
import { copiarTexto } from "../lib/exportar.js";
import {
  Palmtree, CalendarCheck, Stethoscope, FolderOpen, BellRing, Pencil, Trash2, Plus, Check, Copy, Search, ChevronDown
} from "lucide-react";

interface Props {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: "ok" | "err" | "info") => void;
}

const TIPOS_AFAST = [
  "Atest. Comparec. (Dec. 34023)",
  "Atestado Médico (Até 3 Dias)",
  "Licença Médica / Odontológica",
  "Licença Doença Pessoa Família",
  "Folga Eleitoral (TRE)",
  "Doação de Sangue",
  "Reunião Escolar (Bimestral)",
  "Folga Anual Exames Prev/Periód"
];

const inp = "w-full px-2.5 py-2 text-xs rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--blue-mid)]";
const card = "bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm flex flex-col gap-3";
const tituloCls = "text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5";

function statusPeriodo(inicio?: string, fim?: string): { txt: string; cls: string } | null {
  if (!inicio) return null;
  const hoje = getLocalDateIso();
  const f = fim || inicio;
  if (f < hoje) return { txt: "Gozado", cls: "bg-slate-500/10 text-[var(--text2)]" };
  if (inicio <= hoje) return { txt: "Em andamento", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
  return { txt: `Em ${diasEntre(hoje, inicio) - 1} dia(s)`, cls: "bg-[var(--blue-light)] text-[var(--blue-mid)]" };
}

function rotuloSisref(v: string): { txt: string; cls: string } {
  if (v === "sim") return { txt: "Lançado", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
  if (v === "naoPrecisa") return { txt: "Não precisa", cls: "bg-slate-500/10 text-[var(--text2)]" };
  return { txt: v === "pendente" ? "Pendente" : "Não lançado", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
}

/** Botão de excluir que pede confirmação ali mesmo. */
function BotaoExcluir({ onConfirm, rotulo = "Excluir?" }: { onConfirm: () => void; rotulo?: string }) {
  const [pedindo, setPedindo] = useState(false);
  if (pedindo) return (
    <span className="flex items-center gap-1">
      <span className="text-[11px] font-bold text-red-600 dark:text-red-400">{rotulo}</span>
      <button type="button" onClick={() => { setPedindo(false); onConfirm(); }} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-red-600 text-white">Sim</button>
      <button type="button" onClick={() => setPedindo(false)} className="px-2 py-1 text-[11px] font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]">Não</button>
    </span>
  );
  return (
    <button type="button" onClick={() => setPedindo(true)} className="p-1.5 rounded-lg text-[var(--text2)] opacity-60 hover:opacity-100 hover:bg-red-500/10 hover:text-red-600" title="Excluir">
      <Trash2 size={13} />
    </button>
  );
}

function BotaoEditar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="p-1.5 rounded-lg text-[var(--text2)] hover:bg-[var(--bg)] hover:text-[var(--blue-mid)]" title="Editar">
      <Pencil size={13} />
    </button>
  );
}

function Rodape({ onCancel, onSave, extra }: { onCancel: () => void; onSave: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>{extra}</div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text2)]">Cancelar</button>
        <button type="button" onClick={onSave} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1"><Check size={14} /> Salvar</button>
      </div>
    </div>
  );
}

export default function VidaFuncionalPanel({ state, updateState, onToast }: Props) {
  const hoje = getLocalDateIso();
  const anoAtual = Number(hoje.slice(0, 4));

  const copiar = async (txt: string) => {
    const ok = await copiarTexto(txt);
    onToast(ok ? `Copiado: ${txt}` : "Não foi possível copiar.", ok ? "ok" : "err");
  };

  // ======================= FÉRIAS =======================
  const exerciciosComDados = Object.keys(state.ferias || {}).filter(k => (state.ferias[k] || []).some(p => p?.inicio));
  const exercicioPadrao = (() => {
    // exercício do próximo período (ou em andamento); senão o mais recente com dados
    const futuros = Object.entries(state.ferias || {}).flatMap(([ex, l]) => (l || []).filter(p => p?.inicio && (p.fim || p.inicio) >= hoje).map(p => ({ ex, ini: p.inicio! })));
    futuros.sort((a, b) => a.ini.localeCompare(b.ini));
    return futuros[0]?.ex || exerciciosComDados.sort().slice(-1)[0] || String(anoAtual);
  })();
  const [exercicio, setExercicio] = useState(exercicioPadrao);
  const [feriasEdit, setFeriasEdit] = useState<{ idx: number; inicio: string; fim: string; processo: string } | null>(null);
  const exercicios = Array.from(new Set([...exerciciosComDados, ...[-2, -1, 0, 1, 2].map(d => String(anoAtual + d))])).sort();
  const periodos: PeriodoFerias[] = [0, 1, 2].map(i => (state.ferias?.[exercicio] || [])[i] || {});
  const diasMarcados = periodos.reduce((s, p) => s + diasEntre(p.inicio, p.fim), 0);

  const salvarFerias = () => {
    if (!feriasEdit) return;
    const { idx, inicio, fim, processo } = feriasEdit;
    if (inicio && fim && fim < inicio) { onToast("O fim não pode ser antes do início.", "err"); return; }
    if ((inicio && !fim) || (!inicio && fim)) { onToast("Preencha o início e o fim.", "err"); return; }
    updateState(prev => {
      const f = { ...(prev.ferias || {}) };
      const lista = [...(f[exercicio] || [])];
      while (lista.length < 3) lista.push({});
      lista[idx] = { inicio, fim, processo: processo.trim() };
      f[exercicio] = lista;
      return { ferias: f };
    });
    setFeriasEdit(null);
    onToast("Período de férias salvo.", "ok");
  };

  const limparFerias = (idx: number) => {
    updateState(prev => {
      const f = { ...(prev.ferias || {}) };
      const lista = [...(f[exercicio] || [])];
      while (lista.length < 3) lista.push({});
      lista[idx] = {};
      f[exercicio] = lista;
      return { ferias: f };
    });
    onToast("Período removido.", "info");
  };

  // ======================= ABONOS =======================
  const [anoAbono, setAnoAbono] = useState(String(anoAtual));
  const [abonoEdit, setAbonoEdit] = useState<{ idx: number; data: string; processo: string } | null>(null);
  const anosAbono = Array.from(new Set([...Object.keys(state.abonos || {}), ...[-1, 0, 1].map(d => String(anoAtual + d))])).sort();
  const abonos: AbonoData[] = [0, 1, 2, 3, 4].map(i => (state.abonos?.[anoAbono] || [])[i] || {});
  const abonosUsados = abonos.filter(a => a.data && a.data < hoje).length;
  const abonosAgendados = abonos.filter(a => a.data && a.data >= hoje).length;

  const salvarAbono = () => {
    if (!abonoEdit) return;
    if (!abonoEdit.data) { onToast("Escolha a data do abono.", "err"); return; }
    updateState(prev => {
      const ab = { ...(prev.abonos || {}) };
      const lista = [...(ab[anoAbono] || [])];
      while (lista.length < 5) lista.push({});
      lista[abonoEdit.idx] = { data: abonoEdit.data, processo: abonoEdit.processo.trim() };
      ab[anoAbono] = lista;
      return { abonos: ab };
    });
    setAbonoEdit(null);
    onToast("Abono salvo.", "ok");
  };

  const limparAbono = (idx: number) => {
    updateState(prev => {
      const ab = { ...(prev.abonos || {}) };
      const lista = [...(ab[anoAbono] || [])];
      while (lista.length < 5) lista.push({});
      lista[idx] = {};
      ab[anoAbono] = lista;
      return { abonos: ab };
    });
    onToast("Abono removido.", "info");
  };

  // ======================= AFASTAMENTOS =======================
  type FormAfas = { idx: number; inicio: string; fim: string; turno: "dia" | "manha" | "tarde"; tipo: string; sisref: string; obs: string };
  const [afasEdit, setAfasEdit] = useState<FormAfas | null>(null);
  const [anoAfas, setAnoAfas] = useState<string>("todos");
  const afastamentos = useMemo(() => (state.afastamentos || [])
    .map((a, idx) => ({ a, idx, p: periodoAfastamento(a) }))
    .sort((x, y) => (y.p?.inicio || "").localeCompare(x.p?.inicio || "")), [state.afastamentos]);
  const anosAfas = Array.from(new Set(afastamentos.map(x => x.p?.inicio?.slice(0, 4)).filter(Boolean) as string[])).sort().reverse();
  const afasVisiveis = afastamentos.filter(x => anoAfas === "todos" || x.p?.inicio?.startsWith(anoAfas));
  const pendentesSisref = afastamentos.filter(x => x.a.sisref !== "sim" && x.a.sisref !== "naoPrecisa").length;

  const novoAfas = () => setAfasEdit({ idx: -1, inicio: hoje, fim: "", turno: "dia", tipo: "", sisref: "pendente", obs: "" });
  const editarAfas = (a: Absence, idx: number) => {
    const p = periodoAfastamento(a);
    setAfasEdit({ idx, inicio: p?.inicio || "", fim: p && p.fim !== p.inicio ? p.fim : "", turno: a.turno || "dia", tipo: a.tipo || "", sisref: a.sisref || "pendente", obs: a.obs || "" });
  };
  const salvarAfas = () => {
    if (!afasEdit) return;
    const { idx, inicio, fim, turno, tipo, sisref, obs } = afasEdit;
    if (!inicio || !tipo.trim()) { onToast("Preencha a data e o tipo.", "err"); return; }
    if (fim && fim < inicio) { onToast("O fim não pode ser antes do início.", "err"); return; }
    const obj: Absence = {
      dia: String(Number(inicio.slice(8))),
      mes: inicio.slice(0, 7),
      tipo: tipo.trim(),
      sisref,
      inicio,
      fim: fim || inicio,
      turno,
      ...(obs.trim() ? { obs: obs.trim() } : {})
    };
    updateState(prev => {
      const l = [...(prev.afastamentos || [])];
      if (idx >= 0 && idx < l.length) l[idx] = obj; else l.push(obj);
      return { afastamentos: l };
    });
    setAfasEdit(null);
    onToast("Afastamento salvo.", "ok");
  };
  const excluirAfas = (idx: number) => {
    updateState(prev => ({ afastamentos: (prev.afastamentos || []).filter((_, i) => i !== idx) }));
    onToast("Afastamento excluído.", "info");
  };
  const marcarLancado = (idx: number) => {
    updateState(prev => ({ afastamentos: (prev.afastamentos || []).map((a, i) => (i === idx ? { ...a, sisref: "sim" } : a)) }));
    onToast("Marcado como lançado no SISREF.", "ok");
  };

  // ======================= PROCESSOS SEI =======================
  const [seiEdit, setSeiEdit] = useState<{ idx: number; num: string; desc: string } | null>(null);
  const [seiBusca, setSeiBusca] = useState("");
  const seiLista = (state.sei || []).map((s, idx) => ({ s, idx }))
    .filter(({ s }) => !seiBusca.trim() || `${s.num} ${s.desc}`.toLowerCase().includes(seiBusca.trim().toLowerCase()));
  const salvarSei = () => {
    if (!seiEdit) return;
    if (!seiEdit.num.trim()) { onToast("Informe o número do processo.", "err"); return; }
    const obj: SeiProcess = { num: seiEdit.num.trim(), desc: seiEdit.desc.trim() };
    updateState(prev => {
      const l = [...(prev.sei || [])];
      if (seiEdit.idx >= 0 && seiEdit.idx < l.length) l[seiEdit.idx] = obj; else l.unshift(obj);
      return { sei: l };
    });
    setSeiEdit(null);
    onToast("Processo salvo.", "ok");
  };
  const excluirSei = (idx: number) => {
    updateState(prev => ({ sei: (prev.sei || []).filter((_, i) => i !== idx) }));
    onToast("Processo excluído.", "info");
  };

  // ======================= GMOV =======================
  const gmov = state.config?.gmov_data || "";
  const gmovProx = (() => {
    if (!gmov) return null;
    const d = new Date(gmov + "T12:00:00");
    d.setFullYear(d.getFullYear() + 1);
    const iso = getLocalDateIso(d);
    const faltam = diasEntre(hoje, iso) - 1;
    return { iso, faltam };
  })();
  const gmovCls = !gmovProx ? "text-[var(--text2)]" : gmovProx.faltam < 0 ? "text-red-600 dark:text-red-400" : gmovProx.faltam <= 30 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";

  // ======================= RESUMO =======================
  const todasFerias = Object.entries(state.ferias || {}).flatMap(([ex, l]) => (l || []).filter(p => p?.inicio && p?.fim).map(p => ({ ...p, ex })));
  const feriasAgora = todasFerias.find(p => p.inicio! <= hoje && p.fim! >= hoje);
  const proxFerias = todasFerias.filter(p => p.inicio! > hoje).sort((a, b) => a.inicio!.localeCompare(b.inicio!))[0];
  const proxAbono = Object.values(state.abonos || {}).flat().filter(a => a?.data && a.data >= hoje).sort((a, b) => a.data!.localeCompare(b.data!))[0];
  const abonosAnoAtual = ((state.abonos || {})[String(anoAtual)] || []).filter(a => a?.data).length;

  const Tile = ({ icone, rotulo, valor, detalhe, cls = "" }: { icone: React.ReactNode; rotulo: string; valor: React.ReactNode; detalhe?: React.ReactNode; cls?: string }) => (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm min-w-0">
      <div className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">{icone} {rotulo}</div>
      <div className={`text-base font-black mt-1 ${cls || "text-[var(--text)]"}`}>{valor}</div>
      {detalhe && <div className="text-[11px] font-semibold text-[var(--text2)] mt-0.5">{detalhe}</div>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {/* RESUMO */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {Tile({
          icone: <Palmtree size={12} />, rotulo: feriasAgora ? "De férias" : "Próximas férias",
          valor: feriasAgora ? `até ${fmtBR(feriasAgora.fim)}` : proxFerias ? `${fmtBR(proxFerias.inicio)} a ${fmtBR(proxFerias.fim)}` : "—",
          detalhe: feriasAgora ? `${diasEntre(hoje, feriasAgora.fim) - 1} dia(s) restantes` : proxFerias ? `em ${diasEntre(hoje, proxFerias.inicio) - 1} dia(s) · ${diasEntre(proxFerias.inicio, proxFerias.fim)} dias` : "Nenhum período futuro",
          cls: feriasAgora ? "text-emerald-600 dark:text-emerald-400" : ""
        })}
        {Tile({
          icone: <CalendarCheck size={12} />, rotulo: `Abonos ${anoAtual}`,
          valor: `${abonosAnoAtual} de 5`,
          detalhe: proxAbono ? `próximo: ${fmtBR(proxAbono.data)}${proxAbono.processo ? ` · ${proxAbono.processo}` : ""}` : "nenhum agendado"
        })}
        {Tile({
          icone: <BellRing size={12} />, rotulo: "Renovação GMOV",
          valor: gmovProx ? fmtBR(gmovProx.iso) : "—",
          detalhe: !gmovProx ? "informe a última renovação" : gmovProx.faltam < 0 ? `vencida há ${-gmovProx.faltam} dia(s)` : `em ${gmovProx.faltam} dia(s)`,
          cls: gmovCls
        })}
        {Tile({
          icone: <Stethoscope size={12} />, rotulo: "Afastamentos a lançar",
          valor: pendentesSisref,
          detalhe: pendentesSisref ? "pendentes no SISREF" : "tudo lançado",
          cls: pendentesSisref ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 items-start">
        {/* FÉRIAS */}
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <span className={tituloCls}><Palmtree size={15} /> Férias</span>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text2)]">
              Exercício
              <select value={exercicio} onChange={e => { setExercicio(e.target.value); setFeriasEdit(null); }} className="px-2 py-1 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)]">
                {exercicios.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
          {periodos.map((p, idx) => {
            if (feriasEdit?.idx === idx) {
              const n = diasEntre(feriasEdit.inicio, feriasEdit.fim);
              return (
                <div key={idx} className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2.5">
                  <div className="text-[11px] font-black text-[var(--text)]">{idx + 1}º período</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-bold text-[var(--text2)]">Início<input type="date" value={feriasEdit.inicio} onChange={e => setFeriasEdit(f => f && { ...f, inicio: e.target.value })} className={inp} /></label>
                    <label className="text-[10px] font-bold text-[var(--text2)]">Fim<input type="date" value={feriasEdit.fim} min={feriasEdit.inicio || undefined} onChange={e => setFeriasEdit(f => f && { ...f, fim: e.target.value })} className={inp} /></label>
                  </div>
                  <label className="text-[10px] font-bold text-[var(--text2)]">Processo SEI<input type="text" value={feriasEdit.processo} onChange={e => setFeriasEdit(f => f && { ...f, processo: e.target.value })} placeholder="00060-00000000/2026-00" className={`${inp} font-mono`} /></label>
                  {Rodape({ onCancel: () => setFeriasEdit(null), onSave: salvarFerias, extra: n > 0 ? <span className="text-[11px] font-bold text-[var(--blue-mid)]">{n} dia(s)</span> : null })}
                </div>
              );
            }
            const st = statusPeriodo(p.inicio, p.fim);
            return (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)]">
                <div className="w-8 text-center text-[11px] font-black text-[var(--text2)]">{idx + 1}º</div>
                {p.inicio ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-[var(--text)] flex items-center gap-2 flex-wrap">
                        {fmtBR(p.inicio)} a {fmtBR(p.fim)}
                        <span className="text-[11px] font-bold text-[var(--blue-mid)]">{diasEntre(p.inicio, p.fim)} dias</span>
                        {st && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.txt}</span>}
                      </div>
                      {p.processo && (
                        <button type="button" onClick={() => copiar(p.processo!)} className="text-[11px] font-mono text-[var(--text2)] hover:text-[var(--blue-mid)] flex items-center gap-1" title="Copiar número">
                          {p.processo} <Copy size={10} />
                        </button>
                      )}
                    </div>
                    {BotaoEditar({ onClick: () => setFeriasEdit({ idx, inicio: p.inicio || "", fim: p.fim || "", processo: p.processo || "" }) })}
                    <BotaoExcluir onConfirm={() => limparFerias(idx)} rotulo="Remover?" />
                  </>
                ) : (
                  <button type="button" onClick={() => setFeriasEdit({ idx, inicio: "", fim: "", processo: periodos.find(x => x.processo)?.processo || "" })} className="flex-1 text-left text-xs font-bold text-[var(--blue-mid)] flex items-center gap-1">
                    <Plus size={13} /> Marcar período
                  </button>
                )}
              </div>
            );
          })}
          <div className="text-[11px] font-bold text-[var(--text2)]">
            {diasMarcados} de 30 dias marcados neste exercício{diasMarcados > 30 ? " — passou de 30, confira as datas" : ""}
          </div>
        </div>

        {/* ABONOS */}
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <span className={tituloCls}><CalendarCheck size={15} /> Abonos</span>
            <select value={anoAbono} onChange={e => { setAnoAbono(e.target.value); setAbonoEdit(null); }} className="px-2 py-1 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)]">
              {anosAbono.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex gap-1">
            {abonos.map((a, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full ${a.data ? (a.data < hoje ? "bg-[var(--blue-mid)]" : "bg-[var(--blue-mid)]/40") : "bg-[var(--bg)] border border-[var(--border)]"}`} />
            ))}
          </div>
          <div className="text-[11px] font-bold text-[var(--text2)] -mt-1">{abonosUsados} usado(s) · {abonosAgendados} agendado(s) · {5 - abonosUsados - abonosAgendados} livre(s)</div>
          {abonos.map((a, idx) => {
            if (abonoEdit?.idx === idx) return (
              <div key={idx} className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2.5">
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <label className="text-[10px] font-bold text-[var(--text2)]">Data<input type="date" value={abonoEdit.data} onChange={e => setAbonoEdit(f => f && { ...f, data: e.target.value })} className={inp} /></label>
                  <label className="text-[10px] font-bold text-[var(--text2)]">Motivo / processo<input type="text" value={abonoEdit.processo} onChange={e => setAbonoEdit(f => f && { ...f, processo: e.target.value })} placeholder="Ex.: Recesso; 00060-…" className={inp} /></label>
                </div>
                {Rodape({ onCancel: () => setAbonoEdit(null), onSave: salvarAbono })}
              </div>
            );
            const passado = a.data && a.data < hoje;
            return (
              <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--border)]">
                <div className="w-8 text-center text-[11px] font-black text-[var(--text2)]">{idx + 1}º</div>
                {a.data ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                        {fmtBR(a.data)}
                        <span className="text-[10px] font-bold text-[var(--text2)] capitalize">{new Date(a.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short" })}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${passado ? "bg-slate-500/10 text-[var(--text2)]" : "bg-[var(--blue-light)] text-[var(--blue-mid)]"}`}>{passado ? "Usado" : "Agendado"}</span>
                      </div>
                      {a.processo && <div className="text-[11px] text-[var(--text2)] break-words">{a.processo}</div>}
                    </div>
                    {BotaoEditar({ onClick: () => setAbonoEdit({ idx, data: a.data || "", processo: a.processo || "" }) })}
                    <BotaoExcluir onConfirm={() => limparAbono(idx)} rotulo="Remover?" />
                  </>
                ) : (
                  <button type="button" onClick={() => setAbonoEdit({ idx, data: "", processo: "" })} className="flex-1 text-left text-xs font-bold text-[var(--blue-mid)] flex items-center gap-1">
                    <Plus size={13} /> Marcar abono
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* AFASTAMENTOS */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className={tituloCls}><Stethoscope size={15} /> Meus afastamentos e atestados</span>
          <div className="flex items-center gap-2">
            {anosAfas.length > 1 && (
              <select value={anoAfas} onChange={e => setAnoAfas(e.target.value)} className="px-2 py-1 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)]">
                <option value="todos">Todos</option>
                {anosAfas.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            <button type="button" onClick={novoAfas} className="px-3 py-1.5 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-xs font-bold rounded-lg flex items-center gap-1"><Plus size={13} /> Registrar</button>
          </div>
        </div>

        {afasEdit && (
          <div className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2.5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <label className="text-[10px] font-bold text-[var(--text2)]">Data (ou início)<input type="date" value={afasEdit.inicio} onChange={e => setAfasEdit(f => f && { ...f, inicio: e.target.value })} className={inp} /></label>
              <label className="text-[10px] font-bold text-[var(--text2)]">Até (se mais de um dia)<input type="date" value={afasEdit.fim} min={afasEdit.inicio || undefined} onChange={e => setAfasEdit(f => f && { ...f, fim: e.target.value })} className={inp} /></label>
              <label className="text-[10px] font-bold text-[var(--text2)]">Período do dia
                <select value={afasEdit.turno} onChange={e => setAfasEdit(f => f && { ...f, turno: e.target.value as any })} className={inp}>
                  <option value="dia">Dia todo</option><option value="manha">Só manhã</option><option value="tarde">Só tarde</option>
                </select>
              </label>
              <label className="text-[10px] font-bold text-[var(--text2)]">SISREF
                <select value={afasEdit.sisref} onChange={e => setAfasEdit(f => f && { ...f, sisref: e.target.value })} className={inp}>
                  <option value="pendente">Pendente</option><option value="sim">Lançado</option><option value="naoPrecisa">Não precisa</option>
                </select>
              </label>
            </div>
            <label className="text-[10px] font-bold text-[var(--text2)]">Tipo
              <input type="text" list="tipos-afast-vf" value={afasEdit.tipo} onChange={e => setAfasEdit(f => f && { ...f, tipo: e.target.value })} placeholder="Escolha ou escreva" className={inp} />
              <datalist id="tipos-afast-vf">{TIPOS_AFAST.map(t => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="text-[10px] font-bold text-[var(--text2)]">Observação (opcional)
              <input type="text" value={afasEdit.obs} onChange={e => setAfasEdit(f => f && { ...f, obs: e.target.value })} placeholder="Ex.: das 8h às 10h; CID; médico" className={inp} />
            </label>
            {Rodape({ onCancel: () => setAfasEdit(null), onSave: salvarAfas, extra: afasEdit.inicio && afasEdit.fim && afasEdit.fim > afasEdit.inicio ? <span className="text-[11px] font-bold text-[var(--blue-mid)]">{diasEntre(afasEdit.inicio, afasEdit.fim)} dia(s)</span> : null })}
          </div>
        )}

        <div className="divide-y divide-[var(--border)]">
          {afasVisiveis.map(({ a, idx, p }) => {
            const sr = rotuloSisref(a.sisref);
            const n = p ? diasEntre(p.inicio, p.fim) : 0;
            return (
              <div key={idx} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <div className="flex items-start gap-3 min-w-0 flex-1 basis-[260px]">
                  <div className="w-24 flex-shrink-0">
                    <div className="text-sm font-black text-[var(--text)] font-mono">{p ? fmtBR(p.inicio) : `${a.dia}/${a.mes}`}</div>
                    {p && n > 1 && <div className="text-[10px] font-bold text-[var(--text2)]">até {fmtBR(p.fim)} · {n} dias</div>}
                    {a.turno && a.turno !== "dia" && <div className="text-[10px] font-bold text-[var(--text2)]">{a.turno === "manha" ? "só manhã" : "só tarde"}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[var(--text)] break-words">{a.tipo}</div>
                    {a.obs && <div className="text-[11px] text-[var(--text2)] break-words">{a.obs}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${sr.cls}`}>{sr.txt}</span>
                  {a.sisref !== "sim" && a.sisref !== "naoPrecisa" && (
                    <button type="button" onClick={() => marcarLancado(idx)} className="px-2 py-1 text-[10px] font-bold rounded-lg border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 whitespace-nowrap" title="Marcar como lançado no SISREF">
                      <Check size={11} className="inline -mt-0.5" /> Lancei
                    </button>
                  )}
                  {BotaoEditar({ onClick: () => editarAfas(a, idx) })}
                  <BotaoExcluir onConfirm={() => excluirAfas(idx)} />
                </div>
              </div>
            );
          })}
          {afasVisiveis.length === 0 && <div className="text-center py-4 text-xs text-[var(--text2)]">Nenhum afastamento registrado.</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4 lg:gap-5 items-start">
        {/* PROCESSOS SEI */}
        <div className={card}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={tituloCls}><FolderOpen size={15} /> Meus processos SEI</span>
            <button type="button" onClick={() => setSeiEdit({ idx: -1, num: "", desc: "" })} className="px-3 py-1.5 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-xs font-bold rounded-lg flex items-center gap-1"><Plus size={13} /> Novo</button>
          </div>
          {(state.sei || []).length > 5 && (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
              <input type="text" value={seiBusca} onChange={e => setSeiBusca(e.target.value)} placeholder="Buscar por número ou assunto" className={`${inp} !pl-8`} />
            </div>
          )}
          {seiEdit && seiEdit.idx === -1 && (
            <div className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2.5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                <label className="text-[10px] font-bold text-[var(--text2)]">Número<input type="text" value={seiEdit.num} onChange={e => setSeiEdit(f => f && { ...f, num: e.target.value })} placeholder="00060-00000000/2026-00" className={`${inp} font-mono`} autoFocus /></label>
                <label className="text-[10px] font-bold text-[var(--text2)]">Assunto<input type="text" value={seiEdit.desc} onChange={e => setSeiEdit(f => f && { ...f, desc: e.target.value })} placeholder="Ex.: Licença Prêmio" className={inp} /></label>
              </div>
              {Rodape({ onCancel: () => setSeiEdit(null), onSave: salvarSei })}
            </div>
          )}
          <div className="divide-y divide-[var(--border)]">
            {seiLista.map(({ s, idx }) => seiEdit?.idx === idx ? (
              <div key={idx} className="py-2.5 flex flex-col gap-2.5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <input type="text" value={seiEdit.num} onChange={e => setSeiEdit(f => f && { ...f, num: e.target.value })} className={`${inp} font-mono`} />
                  <input type="text" value={seiEdit.desc} onChange={e => setSeiEdit(f => f && { ...f, desc: e.target.value })} className={inp} />
                </div>
                {Rodape({ onCancel: () => setSeiEdit(null), onSave: salvarSei })}
              </div>
            ) : (
              <div key={idx} className="py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--text)] break-words">{s.desc || "Sem assunto"}</div>
                  <button type="button" onClick={() => copiar(s.num)} className="text-[11px] font-mono text-[var(--blue-mid)] hover:underline flex items-center gap-1" title="Copiar número">
                    {s.num} <Copy size={10} />
                  </button>
                </div>
                {BotaoEditar({ onClick: () => setSeiEdit({ idx, num: s.num, desc: s.desc }) })}
                <BotaoExcluir onConfirm={() => excluirSei(idx)} />
              </div>
            ))}
            {seiLista.length === 0 && <div className="text-center py-4 text-xs text-[var(--text2)]">Nenhum processo{seiBusca ? " encontrado" : " cadastrado"}.</div>}
          </div>
        </div>

        {/* GMOV */}
        <div className={card}>
          <span className={tituloCls}><BellRing size={15} /> Renovação GMOV</span>
          <label className="text-[10px] font-bold text-[var(--text2)]">Última renovação
            <input type="date" value={gmov} onChange={e => updateState(prev => ({ config: { ...prev.config, gmov_data: e.target.value } }))} className={inp} />
          </label>
          <div className="p-3 rounded-xl bg-[var(--bg)]">
            <div className="text-[10px] font-bold text-[var(--text2)] uppercase">Próxima</div>
            <div className={`text-lg font-black ${gmovCls}`}>{gmovProx ? fmtBR(gmovProx.iso) : "—"}</div>
            {gmovProx && <div className="text-[11px] font-semibold text-[var(--text2)]">{gmovProx.faltam < 0 ? `Vencida há ${-gmovProx.faltam} dia(s)` : `Faltam ${gmovProx.faltam} dia(s)`}</div>}
          </div>
          {(() => {
            const proc = (state.sei || []).find(s => /gmov/i.test(s.desc));
            return proc ? (
              <button type="button" onClick={() => copiar(proc.num)} className="text-[11px] font-mono text-[var(--blue-mid)] hover:underline flex items-center gap-1">Processo: {proc.num} <Copy size={10} /></button>
            ) : null;
          })()}
        </div>
      </div>
    </div>
  );
}
