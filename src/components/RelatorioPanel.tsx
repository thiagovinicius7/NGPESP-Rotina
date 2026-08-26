import React, { useState, useEffect, useMemo } from "react";
import { AppState, HistoryEntry } from "../types.js";
import { getLocalDateIso, toYmdDate, cleanTipoName, getSaoPauloHour } from "../lib/utils.js";
import { 
  Users, CalendarCheck2, Network, Timer, List, PieChart, 
  Trash2, ChevronRight, Edit2, LineChart, Calendar as CalendarIcon, 
  Sunrise, Sunset, Clock, CornerUpLeft, ArrowDown, FileText,
  Download, Copy, Printer, Search, Filter, CheckCircle2,
  FileSpreadsheet, Check, RefreshCw
} from "lucide-react";

interface RelatorioPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

export interface AfastamentoReportItem {
  id: string;
  matricula: string;
  nome: string;
  setor: string;
  cargo?: string;
  tipo: string;
  tipoRaw: string;
  dataOcorrencia: string;
  dataLancamentoIso: string;
  dataLancamentoFormatada: string;
  mesAnoLancamento: string; // YYYY-MM
  mesAnoOcorrencia?: string; // YYYY-MM
  origem: string;
}

export default function RelatorioPanel({ state, updateState, onToast }: RelatorioPanelProps) {
  const [subTab, setSubTab] = useState<'afastamentos' | 'conf' | 'setor'>('afastamentos');
  const [expandedSetores, setExpandedSetores] = useState<Record<string, boolean>>({});
  const [anoFiltro, setAnoFiltro] = useState<string>(() => new Date().getFullYear().toString());

  // Report Filters
  const currentMonthIso = useMemo(() => getLocalDateIso().slice(0, 7), []);
  const [filtroMes, setFiltroMes] = useState<string>(currentMonthIso);
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroBusca, setFiltroBusca] = useState<string>("");
  const [criterioMes, setCriterioMes] = useState<'ambos' | 'lancamento' | 'ocorrencia'>('ambos');
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // Summary Metrics calculations
  const totalServidores = state.servidores.length;
  
  // Sectors count
  const setoresUnicos = Array.from(new Set(state.servidores.map(s => s.codLotacao || s.lotacao || "Sem setor").filter(Boolean)));
  const totalSetores = setoresUnicos.length;

  // Session count (track items updated/added during current active session since page load)
  const [sessaoCount, setSessaoCount] = useState(0);
  const [sessaoLancamentos, setSessaoLancamentos] = useState(0);
  const sessionStartTime = React.useRef<number>(Date.now());

  useEffect(() => {
    // Only count history entries recorded during this active browser session
    const sessionEntries = state.historico.filter(h => {
      if (!h.ts) return false;
      const t = new Date(h.ts).getTime();
      return !isNaN(t) && t >= sessionStartTime.current - 5000;
    });

    setSessaoCount(sessionEntries.length);
    const totalSessionLances = sessionEntries.reduce((s, h) => s + (h.qtd || 0), 0);
    setSessaoLancamentos(totalSessionLances);
  }, [state.historico]);

  // Helper to check if a date value is today
  const isToday = (dateVal?: string | number) => {
    if (!dateVal) return false;
    const hojeYMD = getLocalDateIso();
    const strYmd = toYmdDate(dateVal);
    return strYmd === hojeYMD;
  };

  // Daily Turn stats (M vs T)
  const confHoje = (state.historico || []).filter(h => h && h.ts && isToday(h.ts));
  const confHojeMatriculas = new Set(confHoje.map(h => h.mat));
  
  let totalSrvManha = 0;
  let totalLancManha = 0;
  let totalSrvTarde = 0;
  let totalLancTarde = 0;

  // Count strictly from state.historico for launches actually made today (using precise São Paulo timezone hour)
  confHoje.forEach(h => {
    const hour = getSaoPauloHour(h.ts);
    const lances = Math.max(1, typeof h.qtd === "number" && h.qtd > 0 ? h.qtd : (h.ocorrencias?.length || 1));
    if (hour < 13) {
      totalSrvManha++;
      totalLancManha += lances;
    } else {
      totalSrvTarde++;
      totalLancTarde += lances;
    }
  });

  // Group history by Sector
  const getSectoredConferences = () => {
    const map: Record<string, { totalConf: number; totalLanc: number; list: HistoryEntry[] }> = {};
    
    state.historico.forEach(h => {
      const s = h.setor || "Sem setor especificado";
      const lances = Math.max(1, typeof h.qtd === "number" && h.qtd > 0 ? h.qtd : (h.ocorrencias?.length || 1));
      if (!map[s]) {
        map[s] = { totalConf: 0, totalLanc: 0, list: [] };
      }
      map[s].totalConf++;
      map[s].totalLanc += lances;
      map[s].list.push(h);
    });

    return Object.keys(map).map(sName => ({
      nome: sName,
      ...map[sName]
    })).sort((a, b) => b.totalConf - a.totalConf);
  };

  const toggleSectorExpand = (sName: string) => {
    setExpandedSetores(prev => ({ ...prev, [sName]: !prev[sName] }));
  };

  // Helper to extract Month and Year from any date string or text
  const parseMonthYear = (text: any): { month: string; year: string; mesAno: string; yyyyMm: string } | null => {
    if (!text) return null;
    const str = String(text).trim();
    if (!str) return null;

    // 1. DD/MM/YYYY or D/M/YYYY (e.g. "15/05/2025", "1/5/2025")
    let m = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) {
      const monthNum = parseInt(m[2], 10);
      const yearNum = parseInt(m[3], 10);
      if (monthNum >= 1 && monthNum <= 12 && yearNum >= 1990 && yearNum <= 2100) {
        const mm = String(monthNum).padStart(2, '0');
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    // 2. DD/MM/YY or D/M/YY (e.g. "15/05/25", "1/5/25")
    m = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (m) {
      const monthNum = parseInt(m[2], 10);
      let yy = parseInt(m[3], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        const yearNum = yy < 70 ? 2000 + yy : 1900 + yy;
        const mm = String(monthNum).padStart(2, '0');
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    // 3. MM/YYYY or M/YYYY (e.g. "05/2025", "5/2025")
    m = str.match(/\b(\d{1,2})\/(\d{4})\b/);
    if (m) {
      const monthNum = parseInt(m[1], 10);
      const yearNum = parseInt(m[2], 10);
      if (monthNum >= 1 && monthNum <= 12 && yearNum >= 1990 && yearNum <= 2100) {
        const mm = String(monthNum).padStart(2, '0');
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    // 4. MM/YY or M/YY (e.g. "05/25", "5/25")
    m = str.match(/\b(\d{1,2})\/(\d{2})\b/);
    if (m) {
      const monthNum = parseInt(m[1], 10);
      let yy = parseInt(m[2], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        const yearNum = yy < 70 ? 2000 + yy : 1900 + yy;
        const mm = String(monthNum).padStart(2, '0');
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    // 5. ISO date YYYY-MM-DD or YYYY-MM (e.g. "2025-05-15", "2025-05")
    m = str.match(/\b(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\b/);
    if (m) {
      const yearNum = parseInt(m[1], 10);
      const monthNum = parseInt(m[2], 10);
      if (monthNum >= 1 && monthNum <= 12 && yearNum >= 1990 && yearNum <= 2100) {
        const mm = String(monthNum).padStart(2, '0');
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    // 6. Textual months e.g. "Maio 2025", "Mai/2025", "Maio/25"
    const ptMonths: Record<string, string> = {
      jan: '01', janeiro: '01',
      fev: '02', fevereiro: '02',
      mar: '03', marco: '03', março: '03',
      abr: '04', abril: '04',
      mai: '05', maio: '05',
      jun: '06', junho: '06',
      jul: '07', julho: '07',
      ago: '08', agosto: '08',
      set: '09', setembro: '09',
      out: '10', outubro: '10',
      nov: '11', novembro: '11',
      dez: '12', dezembro: '12'
    };

    const textMatch = str.toLowerCase().match(/\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:ço|co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\b.*?(\d{2,4})/i);
    if (textMatch) {
      const mStr = textMatch[1].toLowerCase().replace('ço', 'co');
      const mm = ptMonths[mStr] || ptMonths[mStr.slice(0, 3)];
      let yy = parseInt(textMatch[2], 10);
      if (mm) {
        const yearNum = yy < 100 ? (yy < 70 ? 2000 + yy : 1900 + yy) : yy;
        return { month: mm, year: String(yearNum), mesAno: `${mm}/${yearNum}`, yyyyMm: `${yearNum}-${mm}` };
      }
    }

    return null;
  };

  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString("pt-BR", { 
        day: "2-digit", 
        month: "2-digit", 
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_) {
      return isoStr;
    }
  };

  // EXTRACT ALL LAUNCHED LEAVES / ABSENCES FROM STATE
  const todosAfastamentos = useMemo(() => {
    const list: AfastamentoReportItem[] = [];
    const seen = new Set<string>();

    // 1. Primary Source: State Historico
    (state.historico || []).forEach((h, hIdx) => {
      if (!h || !h.nome) return;
      const srv = (state.servidores || []).find(s => s.matricula === h.mat);
      const setor = h.setor || srv?.lotacao || srv?.codLotacao || "Não especificado";
      const cargo = srv?.cargo || srv?.denominacao || "";
      const launchIso = h.ts || new Date().toISOString();
      const launchYmd = toYmdDate(launchIso);
      const launchMonth = launchYmd.slice(0, 7); // YYYY-MM

      if (h.ocorrencias && Array.isArray(h.ocorrencias) && h.ocorrencias.length > 0) {
        h.ocorrencias.forEach((ocStr, ocIdx) => {
          if (!ocStr) return;
          const cleanTipo = cleanTipoName(ocStr) || "Lançamento Avulso";
          
          // Extract specific occurrence date if present in text
          let dataOc = "";
          const dateMatch = ocStr.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);
          if (dateMatch) {
            dataOc = dateMatch[1];
          } else {
            dataOc = new Date(launchIso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
          }

          const parsedOcMonth = parseMonthYear(dataOc) || parseMonthYear(ocStr);
          const mesAnoOc = parsedOcMonth ? parsedOcMonth.yyyyMm : undefined;

          const uniqueKey = `${h.mat}_${cleanTipo}_${dataOc}_${launchYmd}_${ocIdx}`;
          if (!seen.has(uniqueKey)) {
            seen.add(uniqueKey);
            list.push({
              id: `hist_${h.mat}_${hIdx}_${ocIdx}`,
              matricula: h.mat,
              nome: h.nome,
              setor,
              cargo,
              tipo: cleanTipo,
              tipoRaw: ocStr,
              dataOcorrencia: dataOc,
              dataLancamentoIso: launchIso,
              dataLancamentoFormatada: formatDateTime(launchIso),
              mesAnoLancamento: launchMonth,
              mesAnoOcorrencia: mesAnoOc,
              origem: "Histórico de Conferências"
            });
          }
        });
      } else {
        // Entry with qtd count but no individual ocorrencias list
        const cleanTipo = "Conferência / Lançamento Efetuado";
        const dataOc = new Date(launchIso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const uniqueKey = `${h.mat}_${cleanTipo}_${dataOc}_${launchYmd}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          list.push({
            id: `hist_${h.mat}_${hIdx}_gen`,
            matricula: h.mat,
            nome: h.nome,
            setor,
            cargo,
            tipo: cleanTipo,
            tipoRaw: `Lançamento (${h.qtd || 1} item/itens)`,
            dataOcorrencia: dataOc,
            dataLancamentoIso: launchIso,
            dataLancamentoFormatada: formatDateTime(launchIso),
            mesAnoLancamento: launchMonth,
            mesAnoOcorrencia: launchMonth,
            origem: "Histórico de Conferências"
          });
        }
      }
    });

    // 2. Secondary Source: Fila Avulsa SISREF
    if (state.filaAvulsa && state.filaAvulsa.listas) {
      Object.values(state.filaAvulsa.listas).forEach((q: any) => {
        (q.fila || []).forEach((server: any, sIdx: number) => {
          if (!server || !server.matricula) return;
          const srv = (state.servidores || []).find(s => s.matricula === server.matricula);
          const setor = srv?.lotacao || srv?.codLotacao || "Não especificado";
          const cargo = srv?.cargo || srv?.denominacao || "";

          (server.ocorrencias || []).forEach((oc: any, ocIdx: number) => {
            if (oc && (oc.dataLancamento || oc.checked)) {
              const lIso = oc.dataLancamento || new Date().toISOString();
              const lYmd = toYmdDate(lIso);
              const lMonth = lYmd.slice(0, 7);
              const cleanTipo = cleanTipoName(oc.tipo) || "Afastamento / Ocorrência";
              const dataOc = oc.data || new Date(lIso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
              const parsedOcMonth = parseMonthYear(dataOc);
              const mesAnoOc = parsedOcMonth ? parsedOcMonth.yyyyMm : undefined;

              const uniqueKey = `${server.matricula}_${cleanTipo}_${dataOc}_${lYmd}_${ocIdx}`;
              if (!seen.has(uniqueKey)) {
                seen.add(uniqueKey);
                list.push({
                  id: `fila_${server.matricula}_${sIdx}_${ocIdx}`,
                  matricula: server.matricula,
                  nome: server.nome,
                  setor,
                  cargo,
                  tipo: cleanTipo,
                  tipoRaw: oc.tipo || "",
                  dataOcorrencia: dataOc,
                  dataLancamentoIso: lIso,
                  dataLancamentoFormatada: formatDateTime(lIso),
                  mesAnoLancamento: lMonth,
                  mesAnoOcorrencia: mesAnoOc,
                  origem: "Fila Avulsa SISREF"
                });
              }
            }
          });
        });
      });
    }

    return list.sort((a, b) => {
      // Sort newest launches first, then by name
      const timeDiff = new Date(b.dataLancamentoIso).getTime() - new Date(a.dataLancamentoIso).getTime();
      if (!isNaN(timeDiff) && timeDiff !== 0) return timeDiff;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [state.historico, state.filaAvulsa, state.servidores]);

  // Extract distinct available months
  const mesesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    // Always include current month
    const nowIso = getLocalDateIso().slice(0, 7);
    const nowObj = parseMonthYear(nowIso);
    if (nowObj) {
      map.set(nowIso, `${nowObj.mesAno}`);
    }

    todosAfastamentos.forEach(item => {
      if (item.mesAnoLancamento) {
        const obj = parseMonthYear(item.mesAnoLancamento);
        if (obj) map.set(item.mesAnoLancamento, obj.mesAno);
      }
      if (item.mesAnoOcorrencia) {
        const obj = parseMonthYear(item.mesAnoOcorrencia);
        if (obj) map.set(item.mesAnoOcorrencia, obj.mesAno);
      }
    });

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([val, label]) => ({ val, label }));
  }, [todosAfastamentos]);

  // Extract distinct launch / leave types
  const tiposDisponiveis = useMemo(() => {
    const set = new Set<string>();
    todosAfastamentos.forEach(item => {
      if (item.tipo && item.tipo.trim()) {
        set.add(item.tipo.trim());
      }
    });

    // Suggested standard types
    const defaults = [
      "Licença Médica / Odontológica",
      "Atest. Comparec. (Dec. 34023)",
      "Atest. Comparec. (c/ comp)",
      "Atestado Médico (Até 3 Dias)",
      "Atestado Médico (Mais de 3 Dias)",
      "Declaração de Comparecimento",
      "Folga Anual Exames Prev/Periód",
      "Reunião Escolar (Bimestral)",
      "Doação de Sangue",
      "Licença Doença Pessoa Família",
      "Folga Eleitoral (TRE)",
      "Férias",
      "Abono Pecuniário",
      "Serviço Externo",
      "Greve"
    ];

    defaults.forEach(d => set.add(d));

    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [todosAfastamentos]);

  // Filtered Afastamentos
  const afastamentosFiltrados = useMemo(() => {
    return todosAfastamentos.filter(item => {
      // 1. Month Filter
      if (filtroMes !== "todos") {
        let matchesMonth = false;
        if (criterioMes === 'lancamento') {
          matchesMonth = item.mesAnoLancamento === filtroMes;
        } else if (criterioMes === 'ocorrencia') {
          matchesMonth = item.mesAnoOcorrencia === filtroMes;
        } else {
          matchesMonth = item.mesAnoLancamento === filtroMes || item.mesAnoOcorrencia === filtroMes;
        }
        if (!matchesMonth) return false;
      }

      // 2. Type Filter
      if (filtroTipo !== "todos") {
        const normFilter = filtroTipo.toLowerCase();
        const normTipo = item.tipo.toLowerCase();
        const normRaw = item.tipoRaw.toLowerCase();
        if (!normTipo.includes(normFilter) && !normRaw.includes(normFilter)) {
          return false;
        }
      }

      // 3. Search text
      if (filtroBusca.trim()) {
        const query = filtroBusca.toLowerCase().trim();
        const matchName = item.nome.toLowerCase().includes(query);
        const matchMat = item.matricula.toLowerCase().includes(query);
        const matchSetor = item.setor.toLowerCase().includes(query);
        const matchTipo = item.tipo.toLowerCase().includes(query);
        const matchData = item.dataOcorrencia.toLowerCase().includes(query);
        if (!matchName && !matchMat && !matchSetor && !matchTipo && !matchData) {
          return false;
        }
      }

      return true;
    });
  }, [todosAfastamentos, filtroMes, filtroTipo, filtroBusca, criterioMes]);

  const servidoresUnicosFiltrados = useMemo(() => {
    return new Set(afastamentosFiltrados.map(a => a.matricula)).size;
  }, [afastamentosFiltrados]);

  // Helper label for active month
  const labelMesAtivo = useMemo(() => {
    if (filtroMes === "todos") return "Todos os Meses";
    const parsed = parseMonthYear(filtroMes);
    return parsed ? parsed.mesAno : filtroMes;
  }, [filtroMes]);

  // Copy as formatted plain text (ideal for SEI dispatch / email)
  const copiarListaTexto = () => {
    if (afastamentosFiltrados.length === 0) {
      onToast("Nenhum afastamento filtrado para copiar.", "info");
      return;
    }

    const header = `RELATÓRIO DE AFASTAMENTOS LANÇADOS - ${labelMesAtivo.toUpperCase()}\n` +
      `Filtro de Tipo: ${filtroTipo === 'todos' ? 'Todos os Tipos' : filtroTipo}\n` +
      `Total: ${afastamentosFiltrados.length} afastamento(s) de ${servidoresUnicosFiltrados} servidor(es)\n` +
      `Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n\n` +
      `--------------------------------------------------------------------------------\n`;

    const lines = afastamentosFiltrados.map((item, idx) => {
      return `${idx + 1}. ${item.nome.toUpperCase()} (Matrícula: ${item.matricula})\n` +
             `   • Afastamento: ${item.tipo}\n` +
             `   • Data do Afastamento: ${item.dataOcorrencia}\n` +
             `   • Lotação: ${item.setor}\n` +
             `   • Data de Lançamento: ${item.dataLancamentoFormatada}\n`;
    });

    const fullText = header + lines.join("\n");
    navigator.clipboard.writeText(fullText);
    setCopiedFormat("text");
    setTimeout(() => setCopiedFormat(null), 2500);
    onToast(`Relatório copiado para a área de transferência (${afastamentosFiltrados.length} itens)!`, "ok");
  };

  // Copy as Excel/Word Table (TSV)
  const copiarTabelaExcel = () => {
    if (afastamentosFiltrados.length === 0) {
      onToast("Nenhum afastamento filtrado para copiar.", "info");
      return;
    }

    const headers = ["Nº", "Nome do Servidor", "Matrícula", "Lotação / Setor", "Afastamento Lançado", "Data do Afastamento", "Data do Lançamento"];
    const rows = afastamentosFiltrados.map((item, idx) => [
      String(idx + 1),
      item.nome,
      item.matricula,
      item.setor,
      item.tipo,
      item.dataOcorrencia,
      item.dataLancamentoFormatada
    ]);

    const tsvContent = [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
    navigator.clipboard.writeText(tsvContent);
    setCopiedFormat("table");
    setTimeout(() => setCopiedFormat(null), 2500);
    onToast("Tabela copiada! Você pode colar diretamente no Excel, Word ou SEI.", "ok");
  };

  // Export as CSV File
  const exportarCSV = () => {
    if (afastamentosFiltrados.length === 0) {
      onToast("Nenhum afastamento filtrado para exportar.", "info");
      return;
    }

    const headers = ["Nº", "Nome", "Matrícula", "Lotação", "Cargo", "Afastamento", "Data da Ocorrência", "Data do Lançamento", "Origem"];
    const rows = afastamentosFiltrados.map((item, idx) => [
      `"${idx + 1}"`,
      `"${item.nome.replace(/"/g, '""')}"`,
      `"${item.matricula}"`,
      `"${item.setor.replace(/"/g, '""')}"`,
      `"${(item.cargo || '').replace(/"/g, '""')}"`,
      `"${item.tipo.replace(/"/g, '""')}"`,
      `"${item.dataOcorrencia}"`,
      `"${item.dataLancamentoFormatada}"`,
      `"${item.origem}"`
    ]);

    const csvString = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const mesSlug = filtroMes.replace("/", "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_afastamentos_${mesSlug}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onToast("Arquivo CSV baixado com sucesso!", "ok");
  };

  // Print Report
  const imprimirRelatorio = () => {
    window.print();
  };

  // Launch Category Statistics (Diário vs Acumulado)
  const getLancamentoStatsByTipo = () => {
    const typeMap: Record<string, { tipoLabel: string; hoje: number; acumulado: number }> = {};

    const addStat = (typeStr: string, isTodayFlag: boolean, count = 1) => {
      const cleaned = cleanTipoName(typeStr);
      if (!cleaned) return;
      const norm = cleaned.toLowerCase();

      if (!typeMap[norm]) {
        typeMap[norm] = { tipoLabel: cleaned, hoje: 0, acumulado: 0 };
      } else {
        if (cleaned !== cleaned.toLowerCase() && typeMap[norm].tipoLabel === typeMap[norm].tipoLabel.toLowerCase()) {
          typeMap[norm].tipoLabel = cleaned;
        }
      }

      typeMap[norm].acumulado += count;
      if (isTodayFlag) {
        typeMap[norm].hoje += count;
      }
    };

    // 1. From History entries (historico) - primary source of confirmed launches
    if (state.historico && state.historico.length > 0) {
      state.historico.forEach(h => {
        const hIsToday = isToday(h.ts);
        if (h.ocorrencias && Array.isArray(h.ocorrencias) && h.ocorrencias.length > 0) {
          h.ocorrencias.forEach(ocStr => {
            const dateObj = parseMonthYear(ocStr) || parseMonthYear((h as any).desc) || parseMonthYear((h as any).sitObs);
            const matchesYear = anoFiltro === "todos" || !dateObj || dateObj.year === anoFiltro;

            if (matchesYear) {
              addStat(ocStr, hIsToday, 1);
            }
          });
        }
      });
    }

    // 2. From Queue list (filaAvulsa - Sisref): Count pending/checked unlogged items in current active queue
    if (state.filaAvulsa && state.filaAvulsa.listas) {
      const hasHistory = state.historico && state.historico.length > 0;
      Object.keys(state.filaAvulsa.listas).forEach(listName => {
        const queue = state.filaAvulsa.listas[listName];
        const fila = queue.fila || [];

        fila.forEach((server, sIdx) => {
          const ocs = server.ocorrencias || [];
          const serverProcessedToday = confHojeMatriculas.has(server.matricula);
          const isProcessedInQueue = sIdx < (queue.idx || 0);

          if (hasHistory && isProcessedInQueue) {
            return;
          }

          ocs.forEach(o => {
            if (o.checked || Boolean(o.dataLancamento)) {
              const ocIsToday = isToday(o.dataLancamento) || isToday(o.data) || serverProcessedToday;
              const dateObj = parseMonthYear(o.data) || parseMonthYear(o.tipo);
              const matchesYear = anoFiltro === "todos" || !dateObj || dateObj.year === anoFiltro;

              if (matchesYear) {
                addStat(o.tipo, ocIsToday, 1);
              }
            }
          });
        });
      });
    }

    return Object.values(typeMap)
      .sort((a, b) => b.acumulado - a.acumulado || a.tipoLabel.localeCompare(b.tipoLabel, "pt-BR"))
      .map(item => ({
        tipo: item.tipoLabel,
        hoje: item.hoje,
        acumulado: item.acumulado
      }));
  };

  // Monthly stats by Incident Date (Fato gerador)
  const getMonthlyStats = () => {
    const map: Record<string, number> = {};
    const anosDisponiveis = new Set<string>();
    anosDisponiveis.add(new Date().getFullYear().toString());

    if (state.historico && state.historico.length > 0) {
      state.historico.forEach(h => {
        if (h.ocorrencias && Array.isArray(h.ocorrencias) && h.ocorrencias.length > 0) {
          h.ocorrencias.forEach(ocStr => {
            const dateObj = parseMonthYear(ocStr) || parseMonthYear((h as any).desc) || parseMonthYear((h as any).sitObs);
            if (dateObj) {
              anosDisponiveis.add(dateObj.year);
            }
            const matchesYear = anoFiltro === "todos" || !dateObj || dateObj.year === anoFiltro;
            if (matchesYear) {
              const mesKey = dateObj ? dateObj.mesAno : "Sem Mês de Referência";
              map[mesKey] = (map[mesKey] || 0) + 1;
            }
          });
        }
      });
    }

    if (state.filaAvulsa && state.filaAvulsa.listas) {
      const hasHistory = state.historico && state.historico.length > 0;
      Object.keys(state.filaAvulsa.listas).forEach(listName => {
        const q = state.filaAvulsa.listas[listName];
        const list = q.fila || [];

        list.forEach((server, sIdx) => {
          const ocs = server.ocorrencias || [];
          const isProcessedInQueue = sIdx < (q.idx || 0);

          if (hasHistory && isProcessedInQueue) {
            return;
          }

          ocs.forEach(o => {
            if (o.checked || Boolean(o.dataLancamento)) {
              const dateObj = parseMonthYear(o.data) || parseMonthYear(o.tipo);
              if (dateObj) {
                anosDisponiveis.add(dateObj.year);
              }
              const matchesYear = anoFiltro === "todos" || !dateObj || dateObj.year === anoFiltro;
              if (matchesYear) {
                const mesKey = dateObj ? dateObj.mesAno : "Sem Mês de Referência";
                map[mesKey] = (map[mesKey] || 0) + 1;
              }
            }
          });
        });
      });
    }

    const parsedMonthList = Object.keys(map).map(mStr => ({
      mesAno: mStr,
      total: map[mStr]
    })).sort((a, b) => {
      if (a.mesAno === "Sem Mês de Referência") return 1;
      if (b.mesAno === "Sem Mês de Referência") return -1;
      const partsA = a.mesAno.split('/');
      const partsB = b.mesAno.split('/');
      return new Date(Number(partsA[1]), Number(partsA[0]) - 1).getTime() - new Date(Number(partsB[1]), Number(partsB[0]) - 1).getTime();
    });

    return {
      mesesList: parsedMonthList,
      anos: Array.from(anosDisponiveis).sort((a, b) => b.localeCompare(a))
    };
  };

  const { mesesList, anos } = getMonthlyStats();
  const catStats = getLancamentoStatsByTipo();

  // History CRUD inside Relatório
  const editarConferenciaLanc = (idx: number) => {
    const h = state.historico[idx];
    const val = prompt(`Editar lançamentos de ${h.nome} (Atual: ${h.qtd || 0})`, String(h.qtd || 0));
    if (val === null) return;
    
    const nextQtd = parseInt(val) || 0;
    updateState(prev => {
      const nextHist = [...prev.historico];
      nextHist[idx] = { ...nextHist[idx], qtd: nextQtd };
      return { historico: nextHist };
    });
    onToast("Lançamentos atualizados", "ok");
  };

  const excluirConferencia = (idx: number) => {
    const h = state.historico[idx];
    if (!confirm(`Excluir conferência de ${h.nome}?`)) return;
    updateState(prev => ({
      historico: prev.historico.filter((_, i) => i !== idx)
    }));
    onToast("Conferência excluída", "info");
  };

  const limparHistoricoGeral = () => {
    if (!confirm("Limpar todo o histórico local de conferências?")) return;
    updateState({ historico: [] });
    onToast("Histórico de conferência limpo", "info");
  };

  const totalHojeCat = catStats.reduce((sum, c) => sum + c.hoje, 0);
  const totalAcumuladoCat = catStats.reduce((sum, c) => sum + c.acumulado, 0);
  const totalMeses = mesesList.reduce((sum, m) => sum + m.total, 0);

  return (
    <div className="flex flex-col gap-6">
      
      {/* METRIC CARDS GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-3xl font-black text-[var(--text)] tracking-tight">
            {totalServidores}
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Users size={12} /> Servidores
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-xs font-bold leading-relaxed text-[var(--text)]">
            <div className="flex items-center gap-1 text-[var(--amber-mid)]">
              <Sunrise size={12} /> Manhã: <span className="font-bold text-[var(--text)] ml-1">{totalSrvManha} srv / {totalLancManha} lanç</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--blue-mid)] mt-1.5">
              <Sunset size={12} /> Tarde: <span className="font-bold text-[var(--text)] ml-1">{totalSrvTarde} srv / {totalLancTarde} lanç</span>
            </div>
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <CalendarCheck2 size={12} /> Conferidos hoje
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-3xl font-black text-[var(--text)] tracking-tight">
            {totalSetores}
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Network size={12} /> Setores
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="text-sm font-bold text-[var(--text)]">
            {sessaoCount} <span className="text-xs text-[var(--text2)] font-semibold">srv.</span> / {sessaoLancamentos} <span className="text-xs text-[var(--text2)] font-semibold">lanç.</span>
          </div>
          <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide mt-2 flex items-center gap-1">
            <Timer size={12} /> Nesta sessão
          </span>
        </div>
      </div>

      {/* RELATÓRIOS NAVIGATION TABS */}
      <div className="flex p-1 bg-[var(--border)] rounded-xl gap-1 select-none">
        <button 
          onClick={() => setSubTab('afastamentos')}
          className={`flex-1 py-3 text-xs md:text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'afastamentos' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <FileText size={16} /> Relatório de Afastamentos Lançados
        </button>
        <button 
          onClick={() => setSubTab('conf')}
          className={`flex-1 py-3 text-xs md:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'conf' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <List size={16} /> Conferências Recentes
        </button>
        <button 
          onClick={() => setSubTab('setor')}
          className={`flex-1 py-3 text-xs md:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'setor' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <PieChart size={16} /> Por Setor
        </button>
      </div>

      {/* TAB 1: RELATÓRIO DE AFASTAMENTOS LANÇADOS NO MÊS */}
      {subTab === 'afastamentos' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-5">
          
          {/* HEADER & FILTERS */}
          <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-black text-[var(--text)] flex items-center gap-2">
                  <FileText className="text-[var(--blue-mid)]" size={20} />
                  Relatório Mensal de Afastamentos Lançados
                </h3>
                <p className="text-xs text-[var(--text2)] font-medium mt-0.5">
                  Consulte os afastamentos lançados (Licença Médica, Atestado de Comparecimento, etc.) por mês, com nome, matrícula e data da ocorrência.
                </p>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex flex-wrap items-center gap-2 mt-2 md:mt-0">
                <button
                  onClick={copiarTabelaExcel}
                  className="px-3 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] flex items-center gap-1.5 transition shadow-sm"
                  title="Copiar tabela formatada para colar no Excel, Word ou SEI"
                >
                  {copiedFormat === "table" ? <Check size={14} className="text-emerald-500" /> : <FileSpreadsheet size={14} className="text-emerald-600" />}
                  <span>{copiedFormat === "table" ? "Tabela Copiada!" : "Copiar Tabela"}</span>
                </button>

                <button
                  onClick={copiarListaTexto}
                  className="px-3 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] flex items-center gap-1.5 transition shadow-sm"
                  title="Copiar em formato de texto estruturado para despacho SEI"
                >
                  {copiedFormat === "text" ? <Check size={14} className="text-blue-500" /> : <Copy size={14} className="text-[var(--blue-mid)]" />}
                  <span>{copiedFormat === "text" ? "Texto Copiado!" : "Copiar Texto"}</span>
                </button>

                <button
                  onClick={exportarCSV}
                  className="px-3 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] flex items-center gap-1.5 transition shadow-sm"
                  title="Baixar planilha CSV"
                >
                  <Download size={14} className="text-indigo-500" />
                  <span>Exportar CSV</span>
                </button>

                <button
                  onClick={imprimirRelatorio}
                  className="px-3 py-2 text-xs font-bold rounded-xl border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] flex items-center gap-1.5 transition shadow-sm hidden sm:flex"
                  title="Imprimir relatório"
                >
                  <Printer size={14} />
                  <span>Imprimir</span>
                </button>
              </div>
            </div>

            {/* FILTER CONTROLS BAR */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              
              {/* 1. MÊS */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">
                  <CalendarIcon size={13} className="text-[var(--blue-mid)]" /> Mês de Referência
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="month"
                    value={filtroMes === "todos" ? "" : filtroMes}
                    onChange={(e) => setFiltroMes(e.target.value || "todos")}
                    className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--blue-mid)]"
                  />
                  {filtroMes !== "todos" ? (
                    <button
                      onClick={() => setFiltroMes("todos")}
                      className="px-2 py-1 text-[11px] font-bold bg-[var(--border)] hover:bg-[var(--border2)] text-[var(--text)] rounded-xl whitespace-nowrap"
                      title="Exibir todos os meses"
                    >
                      Todos
                    </button>
                  ) : (
                    <button
                      onClick={() => setFiltroMes(currentMonthIso)}
                      className="px-2 py-1 text-[11px] font-bold bg-[var(--blue-mid)] text-white rounded-xl whitespace-nowrap"
                      title="Voltar ao mês atual"
                    >
                      Mês Atual
                    </button>
                  )}
                </div>
              </div>

              {/* 2. TIPO DE AFASTAMENTO */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">
                  <Filter size={13} className="text-[var(--blue-mid)]" /> Tipo de Afastamento
                </label>
                <select
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--blue-mid)]"
                >
                  <option value="todos">Todos os Tipos de Afastamento</option>
                  {tiposDisponiveis.map(tipo => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
              </div>

              {/* 3. BUSCA POR NOME / MATRÍCULA */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">
                  <Search size={13} className="text-[var(--blue-mid)]" /> Buscar Servidor / Matrícula
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={filtroBusca}
                    onChange={(e) => setFiltroBusca(e.target.value)}
                    placeholder="Nome, matrícula ou setor..."
                    className="w-full pl-8 pr-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--blue-mid)]"
                  />
                  <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text2)]" />
                  {filtroBusca && (
                    <button 
                      onClick={() => setFiltroBusca("")} 
                      className="absolute right-2.5 top-2.5 text-xs text-[var(--text2)] hover:text-[var(--text)]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* 4. CRITÉRIO DE DATA */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">
                  <Clock size={13} className="text-[var(--blue-mid)]" /> Critério do Mês
                </label>
                <select
                  value={criterioMes}
                  onChange={(e) => setCriterioMes(e.target.value as any)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--blue-mid)]"
                >
                  <option value="ambos">Lançamento ou Ocorrência (Ambos)</option>
                  <option value="lancamento">Mês do Lançamento no Sistema</option>
                  <option value="ocorrencia">Mês do Fato Gerador / Atestado</option>
                </select>
              </div>

            </div>

            {/* QUICK STATS CHIPS */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-[var(--blue-mid)]/10 text-[var(--blue-mid)] border border-[var(--blue-mid)]/20 px-2.5 py-1 rounded-lg font-bold">
                  {afastamentosFiltrados.length} afastamento(s) encontrado(s)
                </span>
                <span className="bg-[var(--bg)] text-[var(--text2)] border border-[var(--border)] px-2.5 py-1 rounded-lg font-semibold">
                  {servidoresUnicosFiltrados} servidor(es) distinto(s)
                </span>
                {filtroTipo !== "todos" && (
                  <span className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-2.5 py-1 rounded-lg font-bold">
                    Filtro: {filtroTipo}
                  </span>
                )}
                {filtroMes !== "todos" && (
                  <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-bold">
                    Mês: {labelMesAtivo}
                  </span>
                )}
              </div>

              {(filtroTipo !== "todos" || filtroBusca !== "" || filtroMes !== currentMonthIso) && (
                <button
                  onClick={() => {
                    setFiltroMes(currentMonthIso);
                    setFiltroTipo("todos");
                    setFiltroBusca("");
                  }}
                  className="text-xs font-bold text-[var(--blue-mid)] hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Redefinir Filtros
                </button>
              )}
            </div>

          </div>

          {/* TABLE OF AFASTAMENTOS */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-[var(--bg)]/60 text-[var(--text2)] font-bold border-b border-[var(--border)]">
                    <th className="p-3 w-12 text-center">Nº</th>
                    <th className="p-3">Servidor</th>
                    <th className="p-3 w-28">Matrícula</th>
                    <th className="p-3">Lotação / Setor</th>
                    <th className="p-3">Afastamento Lançado</th>
                    <th className="p-3 w-36">Data do Afastamento</th>
                    <th className="p-3 w-36">Data do Lançamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {afastamentosFiltrados.map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-[var(--bg)]/30 transition-colors">
                      <td className="p-3 text-center font-mono font-bold text-[var(--text2)] text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="p-3 font-bold text-[var(--text)]">
                        <div className="text-sm">{item.nome}</div>
                        {item.cargo && <div className="text-[10px] text-[var(--text2)] font-normal mt-0.5">{item.cargo}</div>}
                      </td>
                      <td className="p-3 font-mono font-bold text-[var(--blue-mid)]">
                        {item.matricula}
                      </td>
                      <td className="p-3 text-[var(--text2)] font-medium">
                        {item.setor}
                      </td>
                      <td className="p-3">
                        <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] border border-[var(--blue-mid)]/20">
                          {item.tipo}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-[var(--text)]">
                        {item.dataOcorrencia || "—"}
                      </td>
                      <td className="p-3 font-mono text-[var(--text2)] text-[11px]">
                        {item.dataLancamentoFormatada || "—"}
                      </td>
                    </tr>
                  ))}

                  {afastamentosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <FileText size={32} className="text-[var(--text2)]/40" />
                          <div className="text-sm font-bold text-[var(--text)]">
                            Nenhum afastamento encontrado para os filtros selecionados.
                          </div>
                          <p className="text-xs text-[var(--text2)] max-w-md">
                            Tente selecionar outro mês de referência, escolher "Todos os Tipos de Afastamento" ou limpar os termos da busca.
                          </p>
                          {(filtroTipo !== "todos" || filtroBusca !== "" || filtroMes !== "todos") && (
                            <button
                              onClick={() => {
                                setFiltroMes("todos");
                                setFiltroTipo("todos");
                                setFiltroBusca("");
                              }}
                              className="mt-2 px-4 py-2 bg-[var(--blue-mid)] text-white text-xs font-bold rounded-xl shadow-sm hover:opacity-90 transition"
                            >
                              Ver Todos os Afastamentos
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* STATIC RELATORIO SECTIONS TABLE INJECT */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <LineChart size={16} /> Estatísticas por Tipo de Lançamento
        </div>
        <div className="border border-[var(--border)] rounded-xl overflow-hidden text-xs">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg)]/40 text-[var(--text2)]">
                <th className="p-3 text-left">Tipo de Lançamento</th>
                <th className="p-3 text-center w-28">Diário (Hoje)</th>
                <th className="p-3 text-center w-28">Acumulado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] font-semibold">
              {catStats.map((c, i) => (
                <tr key={i} className="hover:bg-[var(--bg)]/5 text-[var(--text)]">
                  <td className="p-3 text-sm font-bold">{c.tipo}</td>
                  <td className="p-3 text-center text-sm font-black text-[var(--blue-mid)]">{c.hoje}</td>
                  <td className="p-3 text-center text-sm font-black">{c.acumulado}</td>
                </tr>
              ))}
              {catStats.length > 0 && (
                <tr className="bg-[var(--bg)]/20 font-black text-[var(--text)] border-t border-[var(--border)]">
                  <td className="p-3 text-sm">TOTAL</td>
                  <td className="p-3 text-center text-sm text-[var(--blue-mid)]">{totalHojeCat}</td>
                  <td className="p-3 text-center text-sm">{totalAcumuladoCat}</td>
                </tr>
              )}
              {catStats.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-[var(--text2)]">
                    Nenhum tipo de lançamento registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REF DATE GROUP BY MONTH SECTION */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
            <CalendarIcon size={16} /> Estatísticas por Mês de Referência
          </div>
          <select 
            value={anoFiltro}
            onChange={(e) => setAnoFiltro(e.target.value)}
            className="px-2.5 py-1 text-xs font-bold rounded bg-[var(--bg)]"
          >
            <option value="todos">Todos os Anos</option>
            {anos.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg)]/40 text-[var(--text2)] text-xs">
                <th className="p-3 text-left">Mês de Referência (Ocorrência)</th>
                <th className="p-3 text-center w-36">Lançamentos Efetuados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] font-semibold text-xs">
              {mesesList.map((m, i) => (
                <tr key={i} className="hover:bg-[var(--bg)]/5 text-[var(--text)]">
                  <td className="p-3 text-sm font-bold font-mono">{m.mesAno}</td>
                  <td className="p-3 text-center text-sm font-black text-[var(--green-mid)]">{m.total}</td>
                </tr>
              ))}
              {mesesList.length > 0 && (
                <tr className="bg-[var(--bg)]/20 font-black text-[var(--text)] border-t border-[var(--border)]">
                  <td className="p-3 text-sm">TOTAL</td>
                  <td className="p-3 text-center text-sm text-[var(--green-mid)]">{totalMeses}</td>
                </tr>
              )}
              {mesesList.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-4 text-center text-[var(--text2)]">
                    Nenhum lançamento identificado nos meses.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TAB 2: CONFERÊNCIAS RECENTES */}
      {subTab === 'conf' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/30 flex justify-between items-center">
            <span className="text-xs font-bold text-[var(--text2)] uppercase">Histórico de Conferências</span>
            <button 
              onClick={limparHistoricoGeral}
              className="text-xs font-semibold text-[var(--red)] hover:underline border border-[var(--red)] px-2.5 py-1.5 rounded-lg bg-white"
            >
              Limpar Tudo
            </button>
          </div>

          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
            {state.historico.map((h, i) => {
              const d = new Date(h.ts);
              const hr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const dt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
              return (
                <div key={i} className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/10 text-xs">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="font-bold text-sm text-[var(--text)] truncate">{h.nome}</div>
                    <div className="text-[11px] text-[var(--text2)] font-mono mt-0.5">{h.mat} · {h.setor}</div>
                  </div>
                  <div className="text-center w-16">
                    <span className="font-black text-sm text-[var(--blue-mid)] block">{h.qtd || 0}</span>
                    <span className="text-[9px] font-bold text-[var(--text2)] uppercase">Lanç.</span>
                  </div>
                  <div className="text-right font-mono text-[var(--text2)] font-semibold w-20">
                    <div>{dt}</div>
                    <div className="text-[10px] mt-0.5">{hr}</div>
                  </div>
                  <div className="flex gap-1.5 ml-3 flex-shrink-0">
                    <button onClick={() => editarConferenciaLanc(i)} className="p-1 border bg-white rounded hover:bg-[var(--bg)]"><Edit2 size={11} /></button>
                    <button onClick={() => excluirConferencia(i)} className="p-1 border bg-white text-[var(--red)] rounded hover:bg-[var(--red-light)]"><Trash2 size={11} /></button>
                  </div>
                </div>
              );
            })}
            {state.historico.length === 0 && (
              <div className="p-8 text-center text-[var(--text2)] font-semibold text-xs">
                Nenhuma conferência registrada ainda.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: POR SETOR */}
      {subTab === 'setor' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/30">
            <span className="text-xs font-bold text-[var(--text2)] uppercase">Conferências Consolidadas por Setor</span>
          </div>

          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
            {getSectoredConferences().map((s) => {
              const isExpanded = !!expandedSetores[s.nome];
              return (
                <div key={s.nome} className="flex flex-col">
                  <div 
                    onClick={() => toggleSectorExpand(s.nome)}
                    className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/20 cursor-pointer transition text-xs"
                  >
                    <div>
                      <div className="font-bold text-sm text-[var(--text)]">{s.nome}</div>
                      <div className="text-[11px] text-[var(--text2)] font-semibold mt-1">
                        {s.totalConf} conferência(s) · {s.totalLanc} lançamento(s)
                      </div>
                    </div>
                    <ChevronRight size={18} className={`text-[var(--text2)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>

                  {isExpanded && (
                    <div className="bg-[var(--bg)]/5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                      {s.list.map((h, subIdx) => (
                        <div key={subIdx} className="p-3 pl-8 flex justify-between items-center text-[11px] font-semibold text-[var(--text2)]">
                          <div>
                            <span className="font-bold text-[var(--text)]">{h.nome}</span>
                            <span className="font-mono ml-2">({h.mat})</span>
                          </div>
                          <div className="flex gap-4 items-center">
                            {h.qtd > 0 && <span className="bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-0.5 rounded font-black">{h.qtd} lanç.</span>}
                            <span className="font-mono text-[var(--text2)]">{new Date(h.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {getSectoredConferences().length === 0 && (
              <div className="p-8 text-center text-[var(--text2)] font-semibold text-xs">
                Nenhuma conferência registrada por setor ainda.
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

