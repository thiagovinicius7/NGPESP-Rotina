import React from "react";
import { AlertTriangle, Info } from "lucide-react";

/**
 * Aviso exibido na confirmação de um lançamento quando o mesmo servidor já foi
 * lançado antes:
 *  - vermelho: alguma das ocorrências marcadas agora já foi lançada (duplicata provável);
 *  - amarelo: o servidor foi lançado nos últimos 7 dias (pode ser outra ocorrência).
 * Não bloqueia: a decisão continua com quem está lançando.
 */

const DIAS_RECENTE = 7;

function normMat(m: any): string {
  let s = String(m || "").trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 8) s = s.padStart(8, "0");
  return s;
}

function ocToString(o: any): string {
  if (!o) return "";
  if (typeof o === "string") return o.trim();
  return o.data ? `${o.tipo} (${o.data})` : String(o.tipo || "").trim();
}

function fmt(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts || "data desconhecida";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

interface Props {
  historico: any[];
  mat: string;
  /** Ocorrências marcadas neste lançamento (objetos {tipo, data} ou textos). */
  ocorrencias?: any[];
}

export default function RecentLaunchWarning({ historico, mat, ocorrencias = [] }: Props) {
  const alvo = normMat(mat);
  if (!alvo || !Array.isArray(historico)) return null;

  const anteriores = historico.filter(h => h && normMat(h.mat) === alvo && h.ts);
  if (anteriores.length === 0) return null;

  const marcadas = new Set(ocorrencias.map(ocToString).filter(Boolean));
  const duplicadas = marcadas.size > 0
    ? anteriores.filter(h => (h.ocorrencias || []).some((o: any) => marcadas.has(ocToString(o))))
    : [];

  const limite = Date.now() - DIAS_RECENTE * 24 * 60 * 60 * 1000;
  const recentes = anteriores.filter(h => new Date(h.ts).getTime() >= limite);

  if (duplicadas.length > 0) {
    return (
      <div className="mt-4 p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-xs text-red-600 dark:text-red-400 space-y-1">
        <div className="font-black flex items-center gap-1.5">
          <AlertTriangle size={14} /> Atenção: possível lançamento repetido
        </div>
        <div className="font-semibold">Estas ocorrências já foram lançadas para este servidor:</div>
        {duplicadas.slice(0, 3).map((h, i) => (
          <div key={i} className="font-medium">
            • {fmt(h.ts)} — {(h.ocorrencias || []).filter((o: any) => marcadas.has(ocToString(o))).map(ocToString).join(", ")}
          </div>
        ))}
      </div>
    );
  }

  if (recentes.length > 0) {
    return (
      <div className="mt-4 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 space-y-1">
        <div className="font-black flex items-center gap-1.5">
          <Info size={14} /> Já lançado nos últimos {DIAS_RECENTE} dias
        </div>
        {recentes.slice(0, 3).map((h, i) => (
          <div key={i} className="font-medium">
            • {fmt(h.ts)}{h.setor ? ` · ${h.setor}` : ""}{(h.ocorrencias || []).length ? ` — ${(h.ocorrencias || []).map(ocToString).join(", ")}` : ""}
          </div>
        ))}
      </div>
    );
  }

  return null;
}
