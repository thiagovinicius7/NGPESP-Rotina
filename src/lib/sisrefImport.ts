/**
 * Leitura do texto copiado do SISREF — usada pela lista avulsa (SISREF) e pelo lançador,
 * para as duas telas entenderem o texto exatamente do mesmo jeito.
 */
import type { AppState, QueueServer, Server } from "../types";
import { normalizeMatricula, cleanTipoName, extrairPeriodoSisref } from "./utils.js";

export interface ResultadoLeituraSisref {
  lista: QueueServer[];
  cedidosIgnorados: number;
}

export function lerTextoSisref(texto: string, servidores: Server[], cedidos: string[] = []): ResultadoLeituraSisref {
  const txt = (texto || "").trim();
  if (!txt) return { lista: [], cedidosIgnorados: 0 };

  const srvByMatMap = new Map<string, Server>();
  const srvByNameMap = new Map<string, Server>();
  (servidores || []).forEach(s => {
    if (s.matricula) {
      const nm = normalizeMatricula(s.matricula);
      if (nm) srvByMatMap.set(nm, s);
    }
    if (s.nome) {
      srvByNameMap.set(s.nome.trim().toLowerCase(), s);
    }
  });

  const cedidosNormSet = new Set((cedidos || []).map(m => normalizeMatricula(m)).filter(Boolean));
  let cedidosIgnoradosCount = 0;

  const map: Record<string, QueueServer> = {};
  const linhas = txt.split(/\n/);

  linhas.forEach((linha, idx) => {
    if (!linha.trim()) return;

    const dataMatch = linha.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || linha.match(/(\d{1,2}\/\d{2,4})/) || linha.match(/(\d{4}-\d{1,2}(?:-\d{1,2})?)/);
    const data = dataMatch ? dataMatch[0] : "";

    const matMatch = linha.match(/\b(\d{6,9}[A-Z0-9]?)\b/i) || linha.match(/(?:matrícula|mat|matr)\s*[:.]?\s*(\d{6,9}[A-Z0-9]?)/i);
    let matricula = matMatch ? matMatch[1].trim() : "";
    let nomeExtraido = "";

    if (matricula) {
      let rest = linha
        .replace(matMatch![0], "")
        .replace(/(?:matrícula|mat|matr)\s*[:.]?/gi, "")
        .replace(/(\d{2}\/\d{2}\/\d{4})/g, "")
        .replace(/\b(Anexado|Aprovado|Pendente)\b/gi, "")
        .trim();
      
      rest = rest.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();

      const parts = rest.split(/[\-–—]/).map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        const cleaned = p.replace(/\s*\([^)]*\)/g, "").trim();
        if (/^[A-Za-zÀ-ÿ\s]{4,}$/.test(cleaned) && !/^(atest|licença|licenca|falta|férias|ferias|afastamento|reunião|reuniao|ticket|servidor)/i.test(cleaned)) {
          nomeExtraido = cleaned;
          break;
        }
      }
      if (!nomeExtraido && parts.length > 0) {
        const lastPart = parts[parts.length - 1].replace(/\s*\([^)]*\)/g, "").trim();
        if (/^[A-Za-zÀ-ÿ\s]+$/.test(lastPart) && lastPart.length >= 3) {
          nomeExtraido = lastPart;
        }
      }
    } else {
      for (const [normName, srv] of srvByNameMap.entries()) {
        if (linha.toLowerCase().includes(normName)) {
          matricula = srv.matricula;
          nomeExtraido = srv.nome;
          break;
        }
      }
    }

    const normMat = normalizeMatricula(matricula);
    let officialServer = normMat ? srvByMatMap.get(normMat) : undefined;

    if (!officialServer && nomeExtraido) {
      officialServer = srvByNameMap.get(nomeExtraido.trim().toLowerCase());
    }

    const finalMatricula = officialServer ? officialServer.matricula : (matricula || "");
    const finalNome = officialServer ? officialServer.nome : (nomeExtraido || "");

    if (!finalMatricula) return;

    const normFinalMat = normalizeMatricula(finalMatricula);
    if ((normMat && cedidosNormSet.has(normMat)) || (normFinalMat && cedidosNormSet.has(normFinalMat))) {
      cedidosIgnoradosCount++;
      return;
    }

    let tipo = linha;

    if (finalMatricula) {
      const cleanMat = finalMatricula.replace(/\D/g, "");
      if (cleanMat.length >= 4) {
        tipo = tipo.replace(new RegExp(`\\b${cleanMat}\\b`, "gi"), "");
      }
    }

    if (finalNome && finalNome.trim().length > 2) {
      const normNome = finalNome.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const normTipo = tipo.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const idx = normTipo.toLowerCase().indexOf(normNome.toLowerCase());
      if (idx !== -1) {
        tipo = tipo.substring(0, idx) + tipo.substring(idx + normNome.length);
      }
    }

    tipo = tipo.replace(/(\d{1,2}\/\d{1,2}\/\d{2,4})/g, "")
               .replace(/(\d{1,2}\/\d{2,4})/g, "")
               .replace(/\b(Anexado|Aprovado|Pendente|Concluído|Processado|Ok)\b/gi, "")
               .replace(/^[\s\-\u2010-\u2015\u2212\uFE63\uFF0D:]+|[\s\-\u2010-\u2015\u2212\uFE63\uFF0D:]+$/g, "")
               .trim();
    
    const tipoLimpo = cleanTipoName(tipo) || "Atestado";

    if (!map[finalMatricula]) {
      map[finalMatricula] = { matricula: finalMatricula, nome: finalNome || `Servidor (${finalMatricula})`, tipos: [], ocorrencias: [] };
    } else if (officialServer) {
      map[finalMatricula].nome = officialServer.nome;
    }

    const matchPrevDate = idx > 0 ? (linhas[idx - 1].match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || linhas[idx - 1].match(/(\d{1,2}\/\d{2,4})/)) : null;
    const dataAnterior = matchPrevDate ? matchPrevDate[0] : "";
    // Período completo (primeiro e último dia) quando o SISREF traz as duas datas
    const periodo = extrairPeriodoSisref(linhas, idx, data || dataAnterior);
    map[finalMatricula].ocorrencias.push({
      tipo: tipoLimpo,
      data: periodo.data,
      ...(periodo.dataInicio ? { dataInicio: periodo.dataInicio } : {}),
      ...(periodo.dias ? { dias: periodo.dias } : {}),
      checked: false
    });

    if (!map[finalMatricula].tipos.includes(tipoLimpo)) {
      map[finalMatricula].tipos.push(tipoLimpo);
    }
  });


  const lista = Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { lista, cedidosIgnorados: cedidosIgnoradosCount };
}

function formatMatricula(m: any): string {
  if (!m) return "";
  let clean = String(m).trim().replace(/[^a-zA-Z0-9]/g, "");
  if (/^\d+$/.test(clean) && clean.length > 0 && clean.length < 8) clean = clean.padStart(8, "0");
  return clean;
}

/** Matrícula e nome oficiais (do cadastro), quando o servidor é encontrado. */
export function servidorOficial(mat: string, fallbackNome: string, servidores: Server[] = []): { matricula: string; nome: string } {
  if (!mat && !fallbackNome) return { matricula: formatMatricula(mat) || "", nome: fallbackNome || "" };
  const normMat = normalizeMatricula(mat);
  if (normMat && servidores?.length) {
    const s = servidores.find(x => normalizeMatricula(x.matricula) === normMat);
    if (s) return { matricula: formatMatricula(s.matricula), nome: s.nome };
  }
  if (fallbackNome && servidores?.length) {
    const n = fallbackNome.trim().toLowerCase();
    const s = servidores.find(x => x.nome && x.nome.trim().toLowerCase() === n);
    if (s) return { matricula: formatMatricula(s.matricula), nome: s.nome };
  }
  return { matricula: formatMatricula(mat) || "", nome: fallbackNome || "" };
}

/** Servidores marcados, sem cedidos, com matrícula e nome do cadastro. */
export function servidoresSelecionados(resultados: QueueServer[], selecionados: Record<number, boolean>, state: AppState): QueueServer[] {
  const cedidos = new Set((state.config?.matriculasCedidos || []).map(m => normalizeMatricula(m)).filter(Boolean));
  return resultados
    .filter((_, i) => selecionados[i])
    .filter(s => !cedidos.has(normalizeMatricula(s.matricula)))
    .map(s => ({ ...s, ...servidorOficial(s.matricula, s.nome, state.servidores) }));
}

/** Coloca os servidores na fila ativa: substituindo (recomeça do 1º) ou anexando no fim (mantém o progresso). */
export function colocarNaFilaAtiva(prev: AppState, novos: QueueServer[], modo: "substituir" | "anexar"): Partial<AppState> {
  const nome = prev.filaAvulsa?.ativa || "Padrão";
  const atual = prev.filaAvulsa?.listas?.[nome] || { fila: [], idx: 0 };
  const fila = modo === "anexar" ? [...(atual.fila || []), ...novos] : novos;
  const idx = modo === "anexar" ? (atual.idx || 0) : 0;
  return {
    filaAvulsa: {
      ...prev.filaAvulsa,
      listas: { ...(prev.filaAvulsa?.listas || {}), [nome]: { ...atual, fila, idx } }
    }
  };
}

/** Progresso da fila ativa (para avisar antes de substituir). */
export function progressoFilaAtiva(state: AppState): { nome: string; total: number; feitos: number } {
  const nome = state.filaAvulsa?.ativa || "Padrão";
  const q = state.filaAvulsa?.listas?.[nome];
  return { nome, total: q?.fila?.length || 0, feitos: q?.idx || 0 };
}

const chaveOc = (mat: string, tipo: string, data: string) => `${normalizeMatricula(mat)}|${(tipo || "").trim().toLowerCase()}|${(data || "").trim()}`;

/** Quantas ocorrências da fila ativa receberiam os dias do texto colado. */
export function contarDiasParaAtualizar(state: AppState, resultados: QueueServer[]): { comPeriodo: number; atualizar: number } {
  const periodos = mapaPeriodos(resultados);
  const fila = state.filaAvulsa?.listas?.[state.filaAvulsa?.ativa || "Padrão"]?.fila || [];
  const atualizar = fila.reduce((n, srv) => n + (srv.ocorrencias || []).filter(o => precisaDias(o, periodos.get(chaveOc(srv.matricula, o.tipo, o.data)))).length, 0);
  return { comPeriodo: periodos.size, atualizar };
}

function mapaPeriodos(resultados: QueueServer[]) {
  const m = new Map<string, { dataInicio: string; dias?: string[] }>();
  resultados.forEach(s => (s.ocorrencias || []).forEach(o => {
    if (o.dataInicio) m.set(chaveOc(s.matricula, o.tipo, o.data), { dataInicio: o.dataInicio, dias: o.dias });
  }));
  return m;
}

function precisaDias(o: any, p?: { dataInicio: string; dias?: string[] }) {
  return !!p && (o.dataInicio !== p.dataInicio || JSON.stringify(o.dias || null) !== JSON.stringify(p.dias || null));
}

/** Completa os dias dos afastamentos na fila ativa sem mexer no progresso nem nas marcações. */
export function atualizarDiasNaFilaAtiva(prev: AppState, resultados: QueueServer[]): Partial<AppState> {
  const periodos = mapaPeriodos(resultados);
  const fa = prev.filaAvulsa;
  const nome = fa?.ativa || "Padrão";
  const q = fa?.listas?.[nome];
  if (!q || periodos.size === 0) return {};
  const fila = (q.fila || []).map(srv => ({
    ...srv,
    ocorrencias: (srv.ocorrencias || []).map(o => {
      const p = periodos.get(chaveOc(srv.matricula, o.tipo, o.data));
      return p && precisaDias(o, p) ? { ...o, dataInicio: p.dataInicio, ...(p.dias ? { dias: p.dias } : {}) } : o;
    })
  }));
  return { filaAvulsa: { ...fa, listas: { ...fa.listas, [nome]: { ...q, fila } } } };
}
