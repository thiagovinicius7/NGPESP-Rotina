import { AppState, ProdutividadeDia } from "../types";

/**
 * Returns YYYY-MM-DD in Brazilian local timezone (America/Sao_Paulo).
 * Avoids the UTC date shift problem of new Date().toISOString().
 */
export function getLocalDateIso(d: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(d); // YYYY-MM-DD
  } catch (_) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

/**
 * Converts any date representation (ISO, DD/MM/YYYY, timestamp) to YYYY-MM-DD
 */
export function toYmdDate(input: any): string {
  if (!input) return getLocalDateIso();
  const str = String(input).trim();

  // DD/MM/YYYY
  const dmY = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmY) {
    const day = String(parseInt(dmY[1], 10)).padStart(2, "0");
    const month = String(parseInt(dmY[2], 10)).padStart(2, "0");
    return `${dmY[3]}-${month}-${day}`;
  }

  // YYYY-MM-DD
  const yMd = str.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (yMd) {
    const month = String(parseInt(yMd[2], 10)).padStart(2, "0");
    const day = String(parseInt(yMd[3], 10)).padStart(2, "0");
    return `${yMd[1]}-${month}-${day}`;
  }

  // Timestamp
  const num = Number(input);
  if (!isNaN(num) && num > 1000000000) {
    return getLocalDateIso(new Date(num));
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return getLocalDateIso(d);
  }

  return str;
}

/**
 * Merges two productivity dictionaries without losing entries.
 */
export function mergeProdutividade(
  p1: Record<string, ProdutividadeDia> = {},
  p2: Record<string, ProdutividadeDia> = {}
): Record<string, ProdutividadeDia> {
  const merged: Record<string, ProdutividadeDia> = { ...(p1 || {}) };
  if (!p2 || typeof p2 !== "object") return merged;

  for (const [date, dayData] of Object.entries(p2)) {
    if (!dayData) continue;
    if (!merged[date]) {
      merged[date] = dayData;
    } else {
      const manha1 = Array.isArray(merged[date].manha) ? merged[date].manha : [];
      const manha2 = Array.isArray(dayData.manha) ? dayData.manha : [];
      const tarde1 = Array.isArray(merged[date].tarde) ? merged[date].tarde : [];
      const tarde2 = Array.isArray(dayData.tarde) ? dayData.tarde : [];

      const manhaMap = new Map();
      [...manha1, ...manha2].forEach(item => {
        if (item) {
          const key = `${item.tipo}_${item.sistema}_${item.qtd}_${item.desc || ''}_${item.processosSei || ''}`;
          manhaMap.set(key, item);
        }
      });

      const tardeMap = new Map();
      [...tarde1, ...tarde2].forEach(item => {
        if (item) {
          const key = `${item.tipo}_${item.sistema}_${item.qtd}_${item.desc || ''}_${item.processosSei || ''}`;
          tardeMap.set(key, item);
        }
      });

      merged[date] = {
        situacao: dayData.situacao || merged[date].situacao || "normal",
        sitObs: dayData.sitObs || merged[date].sitObs || "",
        manha: Array.from(manhaMap.values()),
        tarde: Array.from(tardeMap.values())
      };
    }
  }
  return merged;
}

/**
 * Reconstructs productivity data for all dates from history entries and queue occurrences.
 */
export function reconstructProdutividadeFromState(
  state: AppState
): Record<string, ProdutividadeDia> {
  const reconstructed: Record<string, ProdutividadeDia> = { ...(state.produtividade || {}) };

  const getOrCreateDay = (dateIso: string): ProdutividadeDia => {
    if (!reconstructed[dateIso]) {
      reconstructed[dateIso] = {
        situacao: "Trabalho Normal",
        sitObs: "Reconstruído automaticamente a partir dos lançamentos",
        manha: [],
        tarde: []
      };
    }
    return reconstructed[dateIso];
  };

  // 1. Process state.historico
  if (state.historico && Array.isArray(state.historico)) {
    state.historico.forEach(h => {
      const dateIso = toYmdDate(h.ts);
      if (!dateIso) return;

      const dayObj = getOrCreateDay(dateIso);
      const hour = new Date(h.ts || Date.now()).getHours();
      const turno = hour >= 13 ? "tarde" : "manha";

      if (h.ocorrencias && Array.isArray(h.ocorrencias) && h.ocorrencias.length > 0) {
        h.ocorrencias.forEach(oc => {
          const keyMatch = `${oc}_SISREF_${h.mat || ''}`;
          const exists = dayObj[turno].some(a => a.desc?.includes(h.mat || '') && a.tipo === oc);
          if (!exists) {
            dayObj[turno].push({
              qtd: 1,
              tipo: oc,
              sistema: "SISREF",
              desc: `Matrícula ${h.mat || ''} - ${h.nome || ''}`
            });
          }
        });
      } else {
        const descText = `Conferência Matrícula ${h.mat || ''} - ${h.nome || ''}`;
        const exists = dayObj[turno].some(a => a.desc === descText);
        if (!exists) {
          dayObj[turno].push({
            qtd: h.qtd || 1,
            tipo: "conferência",
            sistema: "SISREF",
            desc: descText
          });
        }
      }
    });
  }

  // 2. Process state.filaAvulsa checked items
  if (state.filaAvulsa && state.filaAvulsa.listas) {
    Object.values(state.filaAvulsa.listas).forEach(q => {
      (q.fila || []).forEach(server => {
        (server.ocorrencias || []).forEach(oc => {
          if (oc.checked || oc.dataLancamento) {
            const dateIso = toYmdDate(oc.dataLancamento || oc.data);
            if (dateIso) {
              const dayObj = getOrCreateDay(dateIso);
              const exists = dayObj.manha.some(a => a.desc?.includes(server.matricula) && a.tipo === oc.tipo) ||
                             dayObj.tarde.some(a => a.desc?.includes(server.matricula) && a.tipo === oc.tipo);
              if (!exists) {
                dayObj.manha.push({
                  qtd: 1,
                  tipo: oc.tipo || "ocorrência",
                  sistema: "SISREF",
                  desc: `Lançamento Matrícula ${server.matricula} (${oc.data || ''})`
                });
              }
            }
          }
        });
      });
    });
  }

  return reconstructed;
}
