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

/**
 * Safely merges two FilaAvulsa objects so no queues or server lists are lost.
 */
export function mergeFilaAvulsa(f1: any, f2: any): any {
  if (!f1 || !f1.listas || Object.keys(f1.listas).length === 0) return f2 || { listas: { "Padrão": { fila: [], idx: 0 } }, ativa: "Padrão" };
  if (!f2 || !f2.listas || Object.keys(f2.listas).length === 0) return f1;

  const totalFila1 = Object.values(f1.listas as Record<string, { fila: any[] }>).reduce((sum, l) => sum + (Array.isArray(l?.fila) ? l.fila.length : 0), 0);
  const totalFila2 = Object.values(f2.listas as Record<string, { fila: any[] }>).reduce((sum, l) => sum + (Array.isArray(l?.fila) ? l.fila.length : 0), 0);

  if (totalFila1 === 0 && totalFila2 > 0) {
    return {
      ...f2,
      natal: Array.from(new Set([...(f1.natal || []), ...(f2.natal || [])])),
      pendencias: f2.pendencias || f1.pendencias || []
    };
  }

  const mergedListas: Record<string, { fila: any[]; idx: number }> = { ...f1.listas };

  for (const [listName, qObj2] of Object.entries(f2.listas as Record<string, { fila: any[]; idx: number }>)) {
    if (!qObj2) continue;
    if (!mergedListas[listName]) {
      mergedListas[listName] = qObj2;
    } else {
      const qObj1 = mergedListas[listName];
      const fila1 = Array.isArray(qObj1.fila) ? qObj1.fila : [];
      const fila2 = Array.isArray(qObj2.fila) ? qObj2.fila : [];

      if (fila1.length === 0 && fila2.length > 0) {
        mergedListas[listName] = qObj2;
      } else if (fila1.length > 0 && fila2.length > 0) {
        const map = new Map();
        fila1.forEach(item => {
          if (item && item.matricula) map.set(String(item.matricula), item);
        });
        fila2.forEach(item => {
          if (!item || !item.matricula) return;
          const m = String(item.matricula);
          if (map.has(m)) {
            const existing = map.get(m);
            const ocMap = new Map();
            (existing.ocorrencias || []).forEach((oc: any) => ocMap.set(`${oc.tipo}_${oc.data}`, oc));
            (item.ocorrencias || []).forEach((oc: any) => ocMap.set(`${oc.tipo}_${oc.data}`, oc));
            map.set(m, {
              ...existing,
              ...item,
              ocorrencias: Array.from(ocMap.values())
            });
          } else {
            map.set(m, item);
          }
        });
        mergedListas[listName] = {
          fila: Array.from(map.values()),
          idx: Math.max(qObj1.idx || 0, qObj2.idx || 0)
        };
      }
    }
  }

  const mergedNatal = Array.from(new Set([...(f1.natal || []), ...(f2.natal || [])]));
  const mergedPendencias = [...(f1.pendencias || [])];
  (f2.pendencias || []).forEach((p: any) => {
    if (p && !mergedPendencias.some(x => x.matricula === p.matricula && x.motivo === p.motivo)) {
      mergedPendencias.push(p);
    }
  });

  const activeName = (f1.ativa && mergedListas[f1.ativa]) ? f1.ativa : (f2.ativa && mergedListas[f2.ativa] ? f2.ativa : Object.keys(mergedListas)[0] || "Padrão");

  return {
    listas: mergedListas,
    ativa: activeName,
    natal: mergedNatal,
    configProd: (f1.configProd?.tipos && f1.configProd.tipos.length > 0) ? f1.configProd : (f2.configProd || { tipos: ["documento", "processo", "análise", "atendimento", "reunião", "outro"], sistemas: ["SISREF", "SEI", "SIAPE", "SOUGOV", "E-mail", "Físico", "Outro"] }),
    pendencias: mergedPendencias
  };
}

const SNAPSHOTS_KEY = "ngpesp_local_snapshots";

export interface StateSnapshot {
  timestamp: number;
  dateFormatted: string;
  summary: string;
  state: AppState;
}

export function saveLocalSnapshot(state: AppState) {
  try {
    if (!state || !state.servidores) return;
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    let snapshots: StateSnapshot[] = raw ? JSON.parse(raw) : [];

    const now = Date.now();
    const dateFormatted = new Date(now).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    
    const numServ = (state.servidores || []).length;
    const numHist = (state.historico || []).length;
    const numProdDays = Object.keys(state.produtividade || {}).length;
    const numFilaListas = Object.keys(state.filaAvulsa?.listas || {}).length;
    let totalFilaItems = 0;
    if (state.filaAvulsa?.listas) {
      Object.values(state.filaAvulsa.listas).forEach((l: any) => {
        totalFilaItems += (l.fila || []).length;
      });
    }

    const summary = `${numServ} servidores, ${numHist} histórico, ${numProdDays} dias prod., ${totalFilaItems} itens Fila (${numFilaListas} listas)`;

    if (snapshots.length > 0) {
      const last = snapshots[0];
      if (last.summary === summary && (now - last.timestamp) < 300000) {
        return;
      }
    }

    snapshots.unshift({ timestamp: now, dateFormatted, summary, state });
    snapshots = snapshots.slice(0, 15);
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch (err) {
    console.warn("Could not save local snapshot", err);
  }
}

export function getLocalSnapshots(): StateSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

