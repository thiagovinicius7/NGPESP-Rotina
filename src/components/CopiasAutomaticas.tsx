import React, { useEffect, useMemo, useState } from "react";
import { AppState } from "../types.js";
import { getSnapshotsFromIDB, StateSnapshotRecord } from "../lib/idbStorage.js";
import { baixarBackup, marcarBackupFeito } from "../lib/backupLembrete.js";
import { History, FileDown, RotateCcw, RefreshCw, Check } from "lucide-react";

interface Props {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: "ok" | "err" | "info") => void;
}

/** Partes do sistema que podem ser restauradas separadamente. */
const PARTES: { id: string; nome: string; campos: (keyof AppState)[]; desc: (s: AppState) => string }[] = [
  {
    id: "fila", nome: "Filas do SISREF (listas, progresso e pendências)", campos: ["filaAvulsa"],
    desc: s => {
      const l = s.filaAvulsa?.listas || {};
      const ativa = s.filaAvulsa?.ativa || "";
      const q = l[ativa];
      return `${Object.keys(l).length} lista(s); ativa "${ativa}" em ${q?.idx || 0} de ${q?.fila?.length || 0}; ${(s.filaAvulsa?.pendencias || []).length} pendência(s)`;
    }
  },
  {
    id: "prod", nome: "Produtividade e atendimentos de balcão", campos: ["produtividade"],
    desc: s => {
      const dias = Object.values(s.produtividade || {});
      const ativ = dias.reduce((n, d: any) => n + (d?.manha?.length || 0) + (d?.tarde?.length || 0), 0);
      return `${dias.length} dia(s), ${ativ} atividade(s)`;
    }
  },
  { id: "hist", nome: "Histórico de conferências e lançamentos", campos: ["historico"], desc: s => `${(s.historico || []).length} registro(s)` },
  {
    id: "vida", nome: "Vida funcional (férias, abonos, afastamentos, processos SEI)", campos: ["ferias", "abonos", "afastamentos", "sei"],
    desc: s => `${(s.afastamentos || []).length} afastamento(s), ${(s.sei || []).length} processo(s)`
  },
  { id: "outros", nome: "Respostas, FAQ, códigos e anotações antigas do balcão", campos: ["respostas", "faq", "codigos", "balcaoAtendimentos"], desc: s => `${(s.respostas || []).length} resposta(s), ${(s.faq || []).length} dúvida(s)` },
  { id: "serv", nome: "Cadastro de servidores", campos: ["servidores"], desc: s => `${(s.servidores || []).length} servidor(es)` }
];

function hora(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}
function dia(ts: number) {
  return new Date(ts).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" });
}

export default function CopiasAutomaticas({ state, updateState, onToast }: Props) {
  const [copias, setCopias] = useState<StateSnapshotRecord[] | null>(null);
  const [diaSel, setDiaSel] = useState<string>("");
  const [restaurando, setRestaurando] = useState<StateSnapshotRecord | null>(null);
  const [partes, setPartes] = useState<Record<string, boolean>>({});

  const carregar = async () => {
    setCopias(null);
    const l = await getSnapshotsFromIDB(500);
    setCopias(l.filter(c => c && c.state && Array.isArray(c.state.servidores)));
  };
  useEffect(() => { carregar(); }, []);

  const porDia = useMemo(() => {
    const m = new Map<string, StateSnapshotRecord[]>();
    (copias || []).forEach(c => {
      const k = dia(c.timestamp);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    });
    return m;
  }, [copias]);
  const dias = Array.from(porDia.keys());
  const diaAtual = diaSel && porDia.has(diaSel) ? diaSel : dias[0] || "";
  const lista = porDia.get(diaAtual) || [];

  const baixar = (c: StateSnapshotRecord) => {
    const blob = new Blob([JSON.stringify(c.state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NGPESP_copia_${new Date(c.timestamp).toISOString().slice(0, 16).replace(":", "h")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    marcarBackupFeito();
    onToast(`Cópia de ${c.dateFormatted} baixada.`, "ok");
  };

  const abrirRestaurar = (c: StateSnapshotRecord) => {
    setRestaurando(c);
    setPartes({});
  };

  const restaurar = () => {
    if (!restaurando) return;
    const escolhidas = PARTES.filter(p => partes[p.id]);
    if (escolhidas.length === 0) { onToast("Marque o que você quer trazer de volta.", "err"); return; }
    if (!confirm(`Trazer de volta, como estava às ${hora(restaurando.timestamp)} de ${dia(restaurando.timestamp)}:\n\n• ${escolhidas.map(p => p.nome).join("\n• ")}\n\nAntes, o app baixa um backup do estado atual (por segurança). Continuar?`)) return;
    baixarBackup(state); // estado atual guardado antes de qualquer troca
    const antigo: any = restaurando.state;
    const novo: Partial<AppState> = {};
    escolhidas.forEach(p => p.campos.forEach(c => { (novo as any)[c] = antigo[c] ?? (Array.isArray((state as any)[c]) ? [] : {}); }));
    updateState(novo);
    onToast(`Restaurado como estava às ${hora(restaurando.timestamp)}. Um backup do estado anterior foi baixado.`, "ok");
    setRestaurando(null);
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-[var(--text)] flex items-center gap-2"><History size={16} /> Cópias automáticas deste computador</span>
        <button type="button" onClick={carregar} className="p-1.5 rounded-lg border border-[var(--border2)] text-[var(--text2)]" title="Atualizar lista"><RefreshCw size={13} /></button>
      </div>
      <p className="text-xs text-[var(--text2)]">
        Este navegador guarda sozinho uma cópia completa dos dados a cada alteração. Escolha o dia e o horário para baixar a cópia ou trazer de volta uma parte dos dados como estavam naquela hora.
        As cópias ficam só neste computador: use o computador em que você estava trabalhando.
      </p>

      {copias === null ? (
        <div className="text-xs text-[var(--text2)]">Lendo as cópias…</div>
      ) : copias.length === 0 ? (
        <div className="text-xs font-bold text-[var(--text2)]">Nenhuma cópia automática neste navegador.</div>
      ) : (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {dias.slice(0, 10).map(d => (
              <button key={d} type="button" onClick={() => { setDiaSel(d); setRestaurando(null); }}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border capitalize ${d === diaAtual ? "border-[var(--blue-mid)] bg-[var(--blue-light)] text-[var(--blue-mid)]" : "border-[var(--border2)] text-[var(--text2)]"}`}>
                {d} ({porDia.get(d)!.length})
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
            {lista.map(c => (
              <div key={c.id ?? c.timestamp} className={`px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${restaurando?.timestamp === c.timestamp ? "bg-[var(--blue-light)]/60" : ""}`}>
                <span className="font-mono font-black text-sm text-[var(--text)] w-12">{hora(c.timestamp)}</span>
                <span className="text-[11px] text-[var(--text2)] flex-1 min-w-[180px]">{c.summary}</span>
                <div className="flex gap-1.5 ml-auto">
                  <button type="button" onClick={() => baixar(c)} className="px-2 py-1 text-[11px] font-bold rounded-lg border border-[var(--border2)] text-[var(--text)] flex items-center gap-1"><FileDown size={12} /> Baixar</button>
                  <button type="button" onClick={() => abrirRestaurar(c)} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-[var(--blue-light)] text-[var(--blue-mid)] flex items-center gap-1"><RotateCcw size={12} /> Restaurar…</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {restaurando && (
        <div className="p-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/5 flex flex-col gap-2">
          <div className="text-xs font-black text-[var(--text)]">Trazer de volta como estava às {hora(restaurando.timestamp)} ({dia(restaurando.timestamp)}). Marque só o que precisa:</div>
          {PARTES.map(p => (
            <label key={p.id} className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={!!partes[p.id]} onChange={e => setPartes(v => ({ ...v, [p.id]: e.target.checked }))} className="mt-0.5" />
              <span>
                <b className="text-[var(--text)]">{p.nome}</b>
                <span className="block text-[11px] text-[var(--text2)]">Naquela hora: {p.desc(restaurando.state)} · Agora: {p.desc(state)}</span>
              </span>
            </label>
          ))}
          <div className="text-[11px] text-[var(--text2)]">O que não for marcado continua como está agora. Antes de restaurar, o app baixa um backup do estado atual.</div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setRestaurando(null)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]">Cancelar</button>
            <button type="button" onClick={restaurar} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"><Check size={14} /> Restaurar o que marquei</button>
          </div>
        </div>
      )}
    </div>
  );
}
