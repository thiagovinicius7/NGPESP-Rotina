import React, { useState, useEffect, useMemo } from "react";
import { AppState, HistoryEntry, QueueServer } from "../types.js";
import { getLocalDateIso, toYmdDate, cleanTipoName, getSaoPauloHour } from "../lib/utils.js";
import { 
  Users, CalendarCheck2, Network, Timer, List, PieChart, 
  Trash2, ChevronRight, Edit2, LineChart, Calendar as CalendarIcon, 
  Sunrise, Sunset, Clock, CornerUpLeft, ArrowDown, FileText,
  Download, Copy, Printer, Search, Filter, CheckCircle2,
  FileSpreadsheet, Check, RefreshCw, UserX, Layers, ExternalLink,
  CheckSquare, Square, ArrowRight, Plus, Send, AlertTriangle,
  HelpCircle, Sparkles, ShieldAlert, FileDown
} from "lucide-react";

interface RelatorioPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  onNavigateToSisref?: () => void;
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

export interface ServidorSemLancamentoItem {
  matricula: string;
  matriculaNorm: string;
  nome: string;
  cargo: string;
  setor: string;
  isCedido: boolean;
  temLancamentoDesdeCorte: boolean;
  ultimoLancamento: {
    data: string;
    tipo: string;
    mesAno: string;
    dataLancamentoFormatada?: string;
  } | null;
  totalHistorico: number;
}

export default function RelatorioPanel({ state, updateState, onToast, onNavigateToSisref }: RelatorioPanelProps) {
  const [subTab, setSubTab] = useState<'afastamentos' | 'sem-lancamentos' | 'conf' | 'setor'>('afastamentos');
  const [expandedSetores, setExpandedSetores] = useState<Record<string, boolean>>({});
  const [anoFiltro, setAnoFiltro] = useState<string>(() => new Date().getFullYear().toString());

  // Sem Lançamento States
  const [corteMesAno, setCorteMesAno] = useState<string>("2025-10");
  const [criterioSemLanc, setCriterioSemLanc] = useState<'qualquer' | 'lancamento' | 'ocorrencia'>('qualquer');
  const [filtroBuscaSemLanc, setFiltroBuscaSemLanc] = useState<string>("");
  const [filtroSetorSemLanc, setFiltroSetorSemLanc] = useState<string>("todos");
  const [ocultarCedidosSemLanc, setOcultarCedidosSemLanc] = useState<boolean>(true);
  const [apenasSemHistorico, setApenasSemHistorico] = useState<boolean>(false);
  const [ordenacaoSemLanc, setOrdenacaoSemLanc] = useState<'nome' | 'matricula' | 'setor' | 'ultimoAntigo' | 'ultimoRecente'>('nome');
  const [selectedMatriculasSemLanc, setSelectedMatriculasSemLanc] = useState<Record<string, boolean>>({});

  // Fila Avulsa modal & feedback states
  const [isModalFilaOpen, setIsModalFilaOpen] = useState(false);
  const [nomeFilaInput, setNomeFilaInput] = useState("");
  const [modoFila, setModoFila] = useState<'substituir' | 'adicionar'>('substituir');
  const [filaCriadaSucesso, setFilaCriadaSucesso] = useState<{ nome: string; count: number } | null>(null);
  const [copiedFormatSemLanc, setCopiedFormatSemLanc] = useState<string | null>(null);

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

    // 1. Primary Source: State Historico (Actual confirmed launches)
    (state.historico || []).forEach((h, hIdx) => {
      if (!h || !h.nome || !h.ts) return;
      const srv = (state.servidores || []).find(s => s.matricula === h.mat);
      const setor = h.setor || srv?.lotacao || srv?.codLotacao || "Não especificado";
      const cargo = srv?.cargo || srv?.denominacao || "";
      const launchIso = h.ts;
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

    // 2. Secondary Source: Fila Avulsa SISREF (Only items with real dataLancamento recorded)
    if (state.filaAvulsa && state.filaAvulsa.listas) {
      Object.values(state.filaAvulsa.listas).forEach((q: any) => {
        (q.fila || []).forEach((server: any, sIdx: number) => {
          if (!server || !server.matricula) return;
          const srv = (state.servidores || []).find(s => s.matricula === server.matricula);
          const setor = srv?.lotacao || srv?.codLotacao || "Não especificado";
          const cargo = srv?.cargo || srv?.denominacao || "";

          (server.ocorrencias || []).forEach((oc: any, ocIdx: number) => {
            if (oc && oc.dataLancamento) {
              const lIso = oc.dataLancamento;
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

  // Helper to normalize matriculas consistently across datasets
  const normalizeMatricula = (m: any): string => {
    if (!m) return "";
    const clean = String(m).replace(/\D/g, "");
    return clean ? clean.replace(/^0+/, "") : "";
  };

  // Set of normalized matriculas of ceded servers (servidores cedidos)
  const cedidosNormSet = useMemo(() => {
    return new Set((state.config?.matriculasCedidos || []).map(m => normalizeMatricula(m)).filter(Boolean));
  }, [state.config?.matriculasCedidos]);

  // Fast indexing of all occurrences and launches by server (by matricula & name)
  const launchesByServer = useMemo(() => {
    const mapMat = new Map<string, AfastamentoReportItem[]>();
    const mapNome = new Map<string, AfastamentoReportItem[]>();

    todosAfastamentos.forEach(item => {
      const nMat = normalizeMatricula(item.matricula);
      if (nMat) {
        if (!mapMat.has(nMat)) mapMat.set(nMat, []);
        mapMat.get(nMat)!.push(item);
      }
      const nNome = item.nome ? item.nome.trim().toUpperCase() : "";
      if (nNome) {
        if (!mapNome.has(nNome)) mapNome.set(nNome, []);
        mapNome.get(nNome)!.push(item);
      }
    });

    return { mapMat, mapNome };
  }, [todosAfastamentos]);

  // Format YYYY-MM to readable Portuguese (e.g. "Outubro de 2025 (10/2025)")
  const formatarMesAnoExtenso = (yyyyMm: string) => {
    if (!yyyyMm || !yyyyMm.includes("-")) return yyyyMm;
    const [y, m] = yyyyMm.split("-");
    const meses = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    const mNum = parseInt(m, 10);
    const mNome = meses[mNum - 1] || m;
    return `${mNome} de ${y} (${m}/${y})`;
  };

  // Format YYYY-MM to short label (e.g. "10/2025")
  const formatarMesAnoCurto = (yyyyMm: string) => {
    if (!yyyyMm || !yyyyMm.includes("-")) return yyyyMm;
    const [y, m] = yyyyMm.split("-");
    return `${m}/${y}`;
  };

  // Compute analysis of all servers against the cutoff month
  const relatorioSemLancamentoCompleto = useMemo(() => {
    const cutoff = corteMesAno || "2025-10";

    return (state.servidores || []).map((srv): ServidorSemLancamentoItem => {
      const nMat = normalizeMatricula(srv.matricula);
      const nNome = srv.nome ? srv.nome.trim().toUpperCase() : "";
      const isCedido = cedidosNormSet.has(nMat);
      const setor = srv.lotacao || srv.codLotacao || "Não especificado";
      const cargo = srv.cargo || srv.denominacao || "";

      // Gather launches for this server
      const launchesMap = new Map<string, AfastamentoReportItem>();
      if (nMat && launchesByServer.mapMat.has(nMat)) {
        launchesByServer.mapMat.get(nMat)!.forEach(it => launchesMap.set(it.id, it));
      }
      if (nNome && launchesByServer.mapNome.has(nNome)) {
        launchesByServer.mapNome.get(nNome)!.forEach(it => launchesMap.set(it.id, it));
      }
      const srvLaunches = Array.from(launchesMap.values());

      // Check if ANY launch qualifies as being >= cutoff
      const temLancamentoDesdeCorte = srvLaunches.some(it => {
        const lMonth = it.mesAnoLancamento;
        const oMonth = it.mesAnoOcorrencia;
        if (criterioSemLanc === 'lancamento') {
          return Boolean(lMonth && lMonth >= cutoff);
        }
        if (criterioSemLanc === 'ocorrencia') {
          return Boolean(oMonth && oMonth >= cutoff);
        }
        // 'qualquer'
        return Boolean((lMonth && lMonth >= cutoff) || (oMonth && oMonth >= cutoff));
      });

      // Find the most recent launch before the cutoff (if any)
      let ultimoLancamento: ServidorSemLancamentoItem["ultimoLancamento"] = null;
      if (srvLaunches.length > 0) {
        const sorted = [...srvLaunches].sort((a, b) => {
          const dateA = a.mesAnoLancamento || a.dataLancamentoIso || a.mesAnoOcorrencia || "";
          const dateB = b.mesAnoLancamento || b.dataLancamentoIso || b.mesAnoOcorrencia || "";
          return dateB.localeCompare(dateA);
        });
        const top = sorted[0];
        ultimoLancamento = {
          data: top.dataOcorrencia || top.dataLancamentoFormatada || top.mesAnoLancamento,
          tipo: top.tipo,
          mesAno: top.mesAnoLancamento || top.mesAnoOcorrencia || "",
          dataLancamentoFormatada: top.dataLancamentoFormatada
        };
      }

      return {
        matricula: srv.matricula,
        matriculaNorm: nMat,
        nome: srv.nome,
        cargo,
        setor,
        isCedido,
        temLancamentoDesdeCorte,
        ultimoLancamento,
        totalHistorico: srvLaunches.length
      };
    });
  }, [state.servidores, corteMesAno, criterioSemLanc, launchesByServer, cedidosNormSet]);

  // Global summary statistics
  const statsSemLanc = useMemo(() => {
    const semLanc = relatorioSemLancamentoCompleto.filter(s => !s.temLancamentoDesdeCorte);
    const nunca = semLanc.filter(s => s.totalHistorico === 0);
    const comAnterior = semLanc.filter(s => s.totalHistorico > 0);
    const cedidos = semLanc.filter(s => s.isCedido);

    return {
      totalSemLanc: semLanc.length,
      totalNunca: nunca.length,
      totalComAnterior: comAnterior.length,
      totalCedidos: cedidos.length,
      totalGeralServidores: relatorioSemLancamentoCompleto.length
    };
  }, [relatorioSemLancamentoCompleto]);

  // Filtered and sorted list of servers without launch
  const servidoresSemLancFiltrados = useMemo(() => {
    let list = relatorioSemLancamentoCompleto.filter(s => !s.temLancamentoDesdeCorte);

    if (ocultarCedidosSemLanc) {
      list = list.filter(s => !s.isCedido);
    }

    if (apenasSemHistorico) {
      list = list.filter(s => s.totalHistorico === 0);
    }

    if (filtroSetorSemLanc !== "todos") {
      list = list.filter(s => s.setor === filtroSetorSemLanc);
    }

    if (filtroBuscaSemLanc.trim()) {
      const term = filtroBuscaSemLanc.trim().toLowerCase();
      list = list.filter(s => 
        s.nome.toLowerCase().includes(term) ||
        s.matricula.includes(term) ||
        s.cargo.toLowerCase().includes(term) ||
        s.setor.toLowerCase().includes(term)
      );
    }

    // Sort list
    return list.sort((a, b) => {
      if (ordenacaoSemLanc === 'nome') return a.nome.localeCompare(b.nome, "pt-BR");
      if (ordenacaoSemLanc === 'matricula') return a.matricula.localeCompare(b.matricula);
      if (ordenacaoSemLanc === 'setor') return a.setor.localeCompare(b.setor, "pt-BR");
      if (ordenacaoSemLanc === 'ultimoAntigo') {
        if (!a.ultimoLancamento && !b.ultimoLancamento) return 0;
        if (!a.ultimoLancamento) return -1;
        if (!b.ultimoLancamento) return 1;
        return a.ultimoLancamento.mesAno.localeCompare(b.ultimoLancamento.mesAno);
      }
      if (ordenacaoSemLanc === 'ultimoRecente') {
        if (!a.ultimoLancamento && !b.ultimoLancamento) return 0;
        if (!a.ultimoLancamento) return 1;
        if (!b.ultimoLancamento) return -1;
        return b.ultimoLancamento.mesAno.localeCompare(a.ultimoLancamento.mesAno);
      }
      return 0;
    });
  }, [relatorioSemLancamentoCompleto, ocultarCedidosSemLanc, apenasSemHistorico, filtroSetorSemLanc, filtroBuscaSemLanc, ordenacaoSemLanc]);

  // Selected items calculation
  const selecionadosList = useMemo(() => {
    return servidoresSemLancFiltrados.filter(s => selectedMatriculasSemLanc[s.matricula]);
  }, [servidoresSemLancFiltrados, selectedMatriculasSemLanc]);

  const selecionadosCount = selecionadosList.length;
  const todosSelecionados = servidoresSemLancFiltrados.length > 0 && selecionadosCount === servidoresSemLancFiltrados.length;

  // Selection handlers
  const toggleSelectServer = (mat: string) => {
    setSelectedMatriculasSemLanc(prev => {
      const next = { ...prev };
      if (next[mat]) {
        delete next[mat];
      } else {
        next[mat] = true;
      }
      return next;
    });
  };

  const toggleSelectAllSemLanc = () => {
    if (todosSelecionados) {
      setSelectedMatriculasSemLanc({});
    } else {
      const next: Record<string, boolean> = {};
      servidoresSemLancFiltrados.forEach(s => {
        next[s.matricula] = true;
      });
      setSelectedMatriculasSemLanc(next);
    }
  };

  // Open modal to configure queue name and action
  const abrirModalFilaAvulsa = () => {
    if (selecionadosCount === 0) {
      onToast("Selecione ao menos um servidor para enviar para a Fila Avulsa.", "info");
      return;
    }
    const defaultNome = `Sem Lançamento (${formatarMesAnoCurto(corteMesAno)})`;
    setNomeFilaInput(defaultNome);
    setModoFila('substituir');
    setIsModalFilaOpen(true);
  };

  // Create or append to Fila Avulsa
  const confirmarEnvioFilaAvulsa = () => {
    const nomeFilaFinal = nomeFilaInput.trim() || `Sem Lançamento (${corteMesAno})`;
    if (selecionadosList.length === 0) {
      onToast("Nenhum servidor selecionado.", "err");
      return;
    }

    const labelCorte = formatarMesAnoCurto(corteMesAno);

    const servidoresFila: QueueServer[] = selecionadosList.map(s => {
      const descUlt = s.ultimoLancamento
        ? `Último em ${s.ultimoLancamento.data} (${s.ultimoLancamento.tipo})`
        : `Sem registros de afastamento no sistema`;

      return {
        matricula: s.matricula,
        nome: s.nome,
        tipos: ["Verificação / Sem Lançamento"],
        ocorrencias: [
          {
            tipo: `Verificação de Frequência (${descUlt})`,
            data: labelCorte,
            checked: false
          }
        ]
      };
    });

    updateState(prev => {
      const nextListas = { ...(prev.filaAvulsa?.listas || {}) };
      const filaExistente = nextListas[nomeFilaFinal]?.fila || [];

      let finalFila: QueueServer[] = [];
      if (modoFila === 'adicionar' && nextListas[nomeFilaFinal]) {
        const existingMats = new Set(filaExistente.map(i => normalizeMatricula(i.matricula)));
        const filteredNew = servidoresFila.filter(i => !existingMats.has(normalizeMatricula(i.matricula)));
        finalFila = [...filaExistente, ...filteredNew];
      } else {
        finalFila = servidoresFila;
      }

      nextListas[nomeFilaFinal] = {
        fila: finalFila,
        idx: 0
      };

      return {
        filaAvulsa: {
          ...(prev.filaAvulsa || { natal: [], configProd: { tipos: [], sistemas: [] }, pendencias: [] }),
          ativa: nomeFilaFinal,
          listas: nextListas
        }
      };
    });

    setIsModalFilaOpen(false);
    setFilaCriadaSucesso({ nome: nomeFilaFinal, count: servidoresFila.length });
    onToast(`${servidoresFila.length} servidores enviados para a Fila Avulsa "${nomeFilaFinal}"!`, "ok");
  };

  // Add a single server directly to the default queue
  const adicionarServidorIndividualFila = (s: ServidorSemLancamentoItem) => {
    const nomeFilaFinal = `Sem Lançamento (${formatarMesAnoCurto(corteMesAno)})`;
    const labelCorte = formatarMesAnoCurto(corteMesAno);
    const descUlt = s.ultimoLancamento
      ? `Último em ${s.ultimoLancamento.data} (${s.ultimoLancamento.tipo})`
      : `Sem registros anteriores no sistema`;

    const itemFila: QueueServer = {
      matricula: s.matricula,
      nome: s.nome,
      tipos: ["Verificação / Sem Lançamento"],
      ocorrencias: [{
        tipo: `Verificação de Frequência (${descUlt})`,
        data: labelCorte,
        checked: false
      }]
    };

    updateState(prev => {
      const nextListas = { ...(prev.filaAvulsa?.listas || {}) };
      const filaExistente = nextListas[nomeFilaFinal]?.fila || [];
      const existingMats = new Set(filaExistente.map(i => normalizeMatricula(i.matricula)));
      const novaFila = existingMats.has(normalizeMatricula(s.matricula))
        ? filaExistente
        : [...filaExistente, itemFila];

      nextListas[nomeFilaFinal] = { fila: novaFila, idx: 0 };
      return {
        filaAvulsa: {
          ...(prev.filaAvulsa || { natal: [], configProd: { tipos: [], sistemas: [] }, pendencias: [] }),
          ativa: nomeFilaFinal,
          listas: nextListas
        }
      };
    });

    setFilaCriadaSucesso({ nome: nomeFilaFinal, count: 1 });
    onToast(`Servidor ${s.nome} adicionado à Fila Avulsa "${nomeFilaFinal}"!`, "ok");
  };

  // Copy table to clipboard (TSV for Excel / Word / Google Sheets)
  const copiarTabelaExcelSemLanc = () => {
    if (servidoresSemLancFiltrados.length === 0) {
      onToast("Nenhum servidor filtrado para copiar.", "info");
      return;
    }

    const headers = ["Nº", "Matrícula", "Servidor", "Cargo / Denominação", "Lotação / Setor", "Último Afastamento", "Data do Último", "Situação", "Cedido"];
    const rows = servidoresSemLancFiltrados.map((s, idx) => [
      String(idx + 1),
      s.matricula,
      s.nome,
      s.cargo || "—",
      s.setor,
      s.ultimoLancamento ? s.ultimoLancamento.tipo : "Nenhum registro anterior",
      s.ultimoLancamento ? s.ultimoLancamento.data : "—",
      s.ultimoLancamento ? `Último em ${s.ultimoLancamento.data}` : "Nunca registrado no sistema",
      s.isCedido ? "Sim (Cedido)" : "Não"
    ]);

    const tsv = [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
    navigator.clipboard.writeText(tsv);
    setCopiedFormatSemLanc("table");
    setTimeout(() => setCopiedFormatSemLanc(null), 2500);
    onToast(`${servidoresSemLancFiltrados.length} servidores copiados para a área de transferência (Excel)!`, "ok");
  };

  // Copy text list formatted for official dispatch in SEI / Memo
  const copiarListaTextoSemLanc = () => {
    if (servidoresSemLancFiltrados.length === 0) {
      onToast("Nenhum servidor filtrado para copiar.", "info");
      return;
    }

    const labelCorte = formatarMesAnoExtenso(corteMesAno);
    let txt = `==========================================================\n`;
    txt += `RELATÓRIO: SERVIDORES SEM LANÇAMENTO REGISTRADO NO SISREF\n`;
    txt += `Data do Relatório: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}\n`;
    txt += `Critério: Servidores sem lançamento ou afastamento desde ${labelCorte}\n`;
    txt += `Total de Servidores Identificados: ${servidoresSemLancFiltrados.length}\n`;
    txt += `==========================================================\n\n`;

    servidoresSemLancFiltrados.forEach((s, idx) => {
      const ultDesc = s.ultimoLancamento
        ? `${s.ultimoLancamento.data} (${s.ultimoLancamento.tipo})`
        : `Nenhum lançamento no histórico`;
      txt += `${idx + 1}. ${s.nome} (Matrícula: ${s.matricula})\n`;
      txt += `   Lotação: ${s.setor} | Cargo: ${s.cargo || "Não informado"}\n`;
      txt += `   Situação: Último registro em ${ultDesc}${s.isCedido ? " [SERVIDOR CEDIDO]" : ""}\n\n`;
    });

    navigator.clipboard.writeText(txt);
    setCopiedFormatSemLanc("text");
    setTimeout(() => setCopiedFormatSemLanc(null), 2500);
    onToast("Lista textual formatada copiada para a área de transferência!", "ok");
  };

  // Export CSV file
  const exportarCsvSemLanc = () => {
    if (servidoresSemLancFiltrados.length === 0) {
      onToast("Nenhum servidor filtrado para exportar.", "info");
      return;
    }

    const headers = ["Nº", "Matrícula", "Nome", "Cargo", "Lotação", "Último Afastamento", "Data Último", "Situação", "Cedido"];
    const rows = servidoresSemLancFiltrados.map((s, idx) => [
      `"${idx + 1}"`,
      `"${s.matricula}"`,
      `"${s.nome.replace(/"/g, '""')}"`,
      `"${(s.cargo || '').replace(/"/g, '""')}"`,
      `"${s.setor.replace(/"/g, '""')}"`,
      `"${(s.ultimoLancamento ? s.ultimoLancamento.tipo : 'Nenhum').replace(/"/g, '""')}"`,
      `"${s.ultimoLancamento ? s.ultimoLancamento.data : ''}"`,
      `"${s.ultimoLancamento ? `Último em ${s.ultimoLancamento.data}` : 'Nunca lançado'}"`,
      `"${s.isCedido ? 'Sim' : 'Não'}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `servidores_sem_lancamento_${corteMesAno.replace("-", "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onToast("Arquivo CSV baixado com sucesso!", "ok");
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
            if (o.dataLancamento) {
              const ocIsToday = isToday(o.dataLancamento);
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
            if (o.dataLancamento) {
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
      <div className="flex p-1 bg-[var(--border)] rounded-xl gap-1 select-none flex-wrap">
        <button 
          onClick={() => setSubTab('afastamentos')}
          className={`flex-1 min-w-[170px] py-3 text-xs md:text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'afastamentos' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)] hover:text-[var(--text)]'}`}
        >
          <FileText size={16} /> Relatório de Afastamentos
        </button>
        <button 
          onClick={() => setSubTab('sem-lancamentos')}
          className={`flex-1 min-w-[190px] py-3 text-xs md:text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'sem-lancamentos' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)] hover:text-[var(--text)]'}`}
        >
          <UserX size={16} /> Servidores sem Lançamento
          {statsSemLanc.totalSemLanc > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--red)]/15 text-[var(--red)] font-black">
              {statsSemLanc.totalSemLanc}
            </span>
          )}
        </button>
        <button 
          onClick={() => setSubTab('conf')}
          className={`flex-1 min-w-[130px] py-3 text-xs md:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'conf' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)] hover:text-[var(--text)]'}`}
        >
          <List size={16} /> Conferências
        </button>
        <button 
          onClick={() => setSubTab('setor')}
          className={`flex-1 min-w-[110px] py-3 text-xs md:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'setor' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)] hover:text-[var(--text)]'}`}
        >
          <PieChart size={16} /> Por Setor
        </button>
      </div>

      {/* TAB 1: RELATÓRIO DE AFASTAMENTOS LANÇADOS NO MÊS */}
      {subTab === 'afastamentos' && (
        <div className="flex flex-col gap-5">
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

      </div>
      )}

      {/* TAB 2: SERVIDORES SEM LANÇAMENTO */}
      {subTab === 'sem-lancamentos' && (
        <div className="flex flex-col gap-5">

          {/* BANNER NOTIFICAÇÃO SE FILA CRIADA */}
          {filaCriadaSucesso && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200 shadow-sm">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={22} className="text-emerald-500 shrink-0" />
                <div>
                  <div className="text-sm font-black">
                    Fila Avulsa "{filaCriadaSucesso.nome}" configurada com {filaCriadaSucesso.count} servidor(es)!
                  </div>
                  <div className="text-xs text-[var(--text2)] mt-0.5">
                    Os servidores já foram inseridos na Fila Avulsa do SISREF e estão prontos para conferência e lançamento.
                  </div>
                </div>
              </div>
              {onNavigateToSisref && (
                <button
                  onClick={onNavigateToSisref}
                  className="self-start sm:self-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl flex items-center gap-2 shadow-sm transition shrink-0 text-xs"
                >
                  <Layers size={15} /> Abrir Fila Avulsa no SISREF <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}

          {/* FILTRO PRINCIPAL DE DATA DE CORTE */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-5">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--border)] pb-5">
              <div>
                <h3 className="text-base font-black text-[var(--text)] flex items-center gap-2">
                  <UserX className="text-[var(--red)]" size={20} />
                  Servidores sem Lançamento no SISREF
                </h3>
                <p className="text-xs text-[var(--text2)] mt-1">
                  Localiza todos os servidores ativos que não possuem nenhum afastamento ou lançamento registrado a partir da data de corte estipulada.
                </p>
              </div>

              {/* CONTROLE DO MÊS DE CORTE */}
              <div className="flex flex-wrap items-center gap-2 bg-[var(--bg)]/70 p-2 rounded-xl border border-[var(--border)]">
                <span className="text-xs font-bold text-[var(--text2)] flex items-center gap-1 pl-1">
                  <CalendarIcon size={14} /> Data de Corte:
                </span>
                <input 
                  type="month" 
                  value={corteMesAno}
                  onChange={(e) => {
                    setCorteMesAno(e.target.value);
                    setSelectedMatriculasSemLanc({});
                  }}
                  className="px-2.5 py-1.5 text-xs font-bold font-mono rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)]"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setCorteMesAno("2025-10");
                      setSelectedMatriculasSemLanc({});
                    }}
                    className={`px-2.5 py-1 text-xs font-black rounded-lg transition ${corteMesAno === "2025-10" ? "bg-[var(--blue-mid)] text-white shadow-sm" : "bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border)]"}`}
                    title="Definir corte para Outubro de 2025"
                  >
                    10/2025
                  </button>
                  <button
                    onClick={() => {
                      setCorteMesAno("2026-01");
                      setSelectedMatriculasSemLanc({});
                    }}
                    className={`px-2.5 py-1 text-xs font-black rounded-lg transition ${corteMesAno === "2026-01" ? "bg-[var(--blue-mid)] text-white shadow-sm" : "bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border)]"}`}
                    title="Definir corte para Janeiro de 2026"
                  >
                    01/2026
                  </button>
                  <button
                    onClick={() => {
                      setCorteMesAno("2026-05");
                      setSelectedMatriculasSemLanc({});
                    }}
                    className={`px-2.5 py-1 text-xs font-black rounded-lg transition ${corteMesAno === "2026-05" ? "bg-[var(--blue-mid)] text-white shadow-sm" : "bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border)]"}`}
                    title="Definir corte para Maio de 2026"
                  >
                    05/2026
                  </button>
                </div>
              </div>
            </div>

            {/* CRITÉRIO DE DATA & BADGE INFORMATIVO */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-[var(--bg)]/40 p-3 rounded-xl border border-[var(--border)]">
              <div className="flex items-center gap-2 font-semibold text-[var(--text2)]">
                <span className="font-bold text-[var(--text)]">Critério de Verificação:</span>
                <span>Qual data considerar para aferir se o servidor teve lançamento?</span>
              </div>
              <div className="flex gap-1 select-none flex-wrap">
                <button
                  onClick={() => setCriterioSemLanc('qualquer')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition text-xs ${criterioSemLanc === 'qualquer' ? 'bg-[var(--blue-mid)] text-white shadow-xs' : 'bg-[var(--surface)] text-[var(--text2)] border border-[var(--border)]'}`}
                  title="Considera tanto a data do fato gerador quanto a data do lançamento no sistema"
                >
                  Ambos (Lançamento ou Ocorrência)
                </button>
                <button
                  onClick={() => setCriterioSemLanc('lancamento')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition text-xs ${criterioSemLanc === 'lancamento' ? 'bg-[var(--blue-mid)] text-white shadow-xs' : 'bg-[var(--surface)] text-[var(--text2)] border border-[var(--border)]'}`}
                  title="Considera a data em que o lançamento foi realizado"
                >
                  Apenas Data de Lançamento
                </button>
                <button
                  onClick={() => setCriterioSemLanc('ocorrencia')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition text-xs ${criterioSemLanc === 'ocorrencia' ? 'bg-[var(--blue-mid)] text-white shadow-xs' : 'bg-[var(--surface)] text-[var(--text2)] border border-[var(--border)]'}`}
                  title="Considera a data de ocorrência do fato gerador"
                >
                  Apenas Fato Gerador
                </button>
              </div>
            </div>

            {/* SUMMARY STAT CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide block">
                    Sem Lançamento
                  </span>
                  <div className="text-2xl lg:text-3xl font-black text-rose-600 dark:text-rose-400 mt-1">
                    {statsSemLanc.totalSemLanc}
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text2)] font-semibold mt-2">
                  {Math.round((statsSemLanc.totalSemLanc / (statsSemLanc.totalGeralServidores || 1)) * 100)}% de {statsSemLanc.totalGeralServidores} servidores
                </span>
              </div>

              <div className="bg-[var(--bg)]/50 border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold text-[var(--text2)] uppercase tracking-wide block">
                    Nunca Lançados
                  </span>
                  <div className="text-2xl lg:text-3xl font-black text-[var(--text)] mt-1">
                    {statsSemLanc.totalNunca}
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text2)] font-semibold mt-2">
                  Sem registros no histórico geral
                </span>
              </div>

              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold text-[var(--blue-mid)] uppercase tracking-wide block">
                    Registro Anterior
                  </span>
                  <div className="text-2xl lg:text-3xl font-black text-[var(--blue-mid)] mt-1">
                    {statsSemLanc.totalComAnterior}
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text2)] font-semibold mt-2">
                  Lançamento antes de {formatarMesAnoCurto(corteMesAno)}
                </span>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide block">
                    Total na Base
                  </span>
                  <div className="text-2xl lg:text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                    {statsSemLanc.totalGeralServidores}
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text2)] font-semibold mt-2">
                  {statsSemLanc.totalCedidos} cedido(s) identificado(s)
                </span>
              </div>
            </div>

            {/* FILTROS SECUNDÁRIOS: BUSCA, SETOR, CEDIDOS, ORDENAÇÃO */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1 text-xs">
              
              <div className="md:col-span-4 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
                <input 
                  type="text"
                  placeholder="Filtrar por nome, matrícula, cargo ou setor..."
                  value={filtroBuscaSemLanc}
                  onChange={(e) => setFiltroBuscaSemLanc(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-semibold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)]"
                />
                {filtroBuscaSemLanc && (
                  <button
                    onClick={() => setFiltroBuscaSemLanc("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text2)] hover:text-[var(--text)] font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="md:col-span-3">
                <select
                  value={filtroSetorSemLanc}
                  onChange={(e) => setFiltroSetorSemLanc(e.target.value)}
                  className="w-full py-2 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-semibold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)] truncate"
                >
                  <option value="todos">Todos os Setores ({setoresUnicos.length})</option>
                  {setoresUnicos.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <select
                  value={ordenacaoSemLanc}
                  onChange={(e) => setOrdenacaoSemLanc(e.target.value as any)}
                  className="w-full py-2 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-semibold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)]"
                >
                  <option value="nome">Ordenar por Nome (A-Z)</option>
                  <option value="matricula">Ordenar por Matrícula</option>
                  <option value="setor">Ordenar por Setor</option>
                  <option value="ultimoAntigo">Mais tempo sem lançamento</option>
                  <option value="ultimoRecente">Mais recente no histórico</option>
                </select>
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-semibold text-[var(--text2)]">
                  <input
                    type="checkbox"
                    checked={ocultarCedidosSemLanc}
                    onChange={(e) => setOcultarCedidosSemLanc(e.target.checked)}
                    className="rounded text-[var(--blue-mid)]"
                  />
                  <span>Ocultar Cedidos</span>
                </label>
              </div>

            </div>

            {/* ACTIONS TOOLBAR: ENVIAR FILA AVULSA & EXPORTAÇÕES */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
              
              {/* STATUS DE SELEÇÃO */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={toggleSelectAllSemLanc}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface)] text-[var(--text)] font-bold transition"
                >
                  {todosSelecionados ? <CheckSquare size={14} className="text-[var(--blue-mid)]" /> : <Square size={14} />}
                  <span>{todosSelecionados ? "Desmarcar Todos" : "Selecionar Todos"}</span>
                </button>
                <span className="font-semibold text-[var(--text2)]">
                  <strong className="text-[var(--text)]">{selecionadosCount}</strong> de {servidoresSemLancFiltrados.length} selecionado(s)
                </span>
              </div>

              {/* BOTÕES DE AÇÃO */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* BOTÃO PRINCIPAL: ENVIAR PARA FILA AVULSA */}
                <button
                  onClick={abrirModalFilaAvulsa}
                  disabled={selecionadosCount === 0}
                  className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition shadow-sm ${
                    selecionadosCount > 0 
                      ? "bg-[var(--blue-mid)] hover:bg-blue-600 text-white cursor-pointer" 
                      : "bg-[var(--border)] text-[var(--text2)]/60 cursor-not-allowed"
                  }`}
                  title="Enviar os servidores selecionados para uma Fila Avulsa no SISREF"
                >
                  <Layers size={15} />
                  <span>Enviar para Fila Avulsa ({selecionadosCount})</span>
                </button>

                {/* COPIAR EXCEL */}
                <button
                  onClick={copiarTabelaExcelSemLanc}
                  className="px-3 py-2 bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  title="Copiar dados tabulados para colar no Excel, Word ou SEI"
                >
                  {copiedFormatSemLanc === "table" ? <Check size={14} className="text-emerald-500" /> : <FileSpreadsheet size={14} />}
                  <span>{copiedFormatSemLanc === "table" ? "Copiado!" : "Excel"}</span>
                </button>

                {/* COPIAR LISTA TEXTO */}
                <button
                  onClick={copiarListaTextoSemLanc}
                  className="px-3 py-2 bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  title="Copiar relação textual para despacho SEI"
                >
                  {copiedFormatSemLanc === "text" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span>{copiedFormatSemLanc === "text" ? "Copiado!" : "Texto / SEI"}</span>
                </button>

                {/* EXPORTAR CSV */}
                <button
                  onClick={exportarCsvSemLanc}
                  className="px-3 py-2 bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  title="Baixar arquivo CSV completo"
                >
                  <FileDown size={14} />
                  <span>CSV</span>
                </button>

              </div>

            </div>

          </div>

          {/* TABELA DE SERVIDORES SEM LANÇAMENTO */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-[var(--bg)]/70 text-[var(--text2)] font-bold border-b border-[var(--border)] select-none">
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={todosSelecionados}
                        onChange={toggleSelectAllSemLanc}
                        className="rounded text-[var(--blue-mid)] cursor-pointer"
                        title="Selecionar / Desmarcar todos os visíveis"
                      />
                    </th>
                    <th className="p-3 w-12 text-center">Nº</th>
                    <th className="p-3">Servidor</th>
                    <th className="p-3 w-32">Matrícula</th>
                    <th className="p-3">Lotação / Setor</th>
                    <th className="p-3">Situação no Histórico</th>
                    <th className="p-3 w-28 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {servidoresSemLancFiltrados.map((item, idx) => {
                    const isSelected = !!selectedMatriculasSemLanc[item.matricula];
                    return (
                      <tr 
                        key={item.matricula || idx} 
                        className={`transition-colors ${isSelected ? "bg-[var(--blue-mid)]/5 hover:bg-[var(--blue-mid)]/10" : "hover:bg-[var(--bg)]/30"}`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectServer(item.matricula)}
                            className="rounded text-[var(--blue-mid)] cursor-pointer"
                          />
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-[var(--text2)] text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="p-3 font-bold text-[var(--text)]">
                          <div className="text-sm flex items-center gap-1.5 flex-wrap">
                            <span>{item.nome}</span>
                            {item.isCedido && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                CEDIDO
                              </span>
                            )}
                          </div>
                          {item.cargo && (
                            <div className="text-[11px] font-normal text-[var(--text2)] truncate max-w-sm mt-0.5">
                              {item.cargo}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-[var(--text)] text-xs">
                              {item.matricula}
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(item.matricula);
                                onToast(`Matrícula ${item.matricula} copiada!`, "ok");
                              }}
                              className="p-1 text-[var(--text2)] hover:text-[var(--text)] rounded transition opacity-60 hover:opacity-100"
                              title="Copiar matrícula"
                            >
                              <Copy size={11} />
                            </button>
                          </div>
                        </td>
                        <td className="p-3 font-semibold text-[var(--text2)] text-xs">
                          {item.setor}
                        </td>
                        <td className="p-3">
                          {item.ultimoLancamento ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--blue-mid)]/10 text-[var(--blue-mid)] border border-[var(--blue-mid)]/20 w-fit">
                                Último: {item.ultimoLancamento.data}
                              </span>
                              <span className="text-[11px] text-[var(--text2)] truncate max-w-xs pl-1 font-medium">
                                {item.ultimoLancamento.tipo}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--bg)] text-[var(--text2)] border border-[var(--border)]">
                              Sem registros anteriores
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => adicionarServidorIndividualFila(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--surface)] hover:bg-[var(--blue-mid)] hover:text-white text-[var(--blue-mid)] border border-[var(--blue-mid)]/30 transition shadow-2xs"
                            title={`Adicionar ${item.nome} à Fila Avulsa`}
                          >
                            <Plus size={13} />
                            <span>+ Fila</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {servidoresSemLancFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <CheckCircle2 size={36} className="text-emerald-500/60" />
                          <div className="text-sm font-bold text-[var(--text)]">
                            Nenhum servidor sem lançamento para os filtros selecionados!
                          </div>
                          <p className="text-xs text-[var(--text2)] max-w-md">
                            Todos os servidores ativos possuem ocorrência ou lançamento registrado a partir de {formatarMesAnoExtenso(corteMesAno)}, ou os filtros de busca/setor não retornaram correspondências.
                          </p>
                          {(filtroBuscaSemLanc !== "" || filtroSetorSemLanc !== "todos") && (
                            <button
                              onClick={() => {
                                setFiltroBuscaSemLanc("");
                                setFiltroSetorSemLanc("todos");
                              }}
                              className="mt-2 px-4 py-2 bg-[var(--blue-mid)] text-white text-xs font-bold rounded-xl shadow-sm hover:opacity-90 transition"
                            >
                              Limpar Filtros de Busca
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

          {/* MODAL CONFIGURAR E ENVIAR PARA FILA AVULSA */}
          {isModalFilaOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-fadeIn">
                
                <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="text-[var(--blue-mid)]" size={20} />
                    <h3 className="font-black text-sm text-[var(--text)]">
                      Enviar para Fila Avulsa SISREF
                    </h3>
                  </div>
                  <button
                    onClick={() => setIsModalFilaOpen(false)}
                    className="text-[var(--text2)] hover:text-[var(--text)] font-bold text-sm p-1 rounded-lg"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-5 flex flex-col gap-4 text-xs">
                  
                  <div className="bg-[var(--blue-mid)]/10 border border-[var(--blue-mid)]/20 rounded-xl p-3 text-[var(--text)] font-semibold flex items-center gap-2.5">
                    <Sparkles size={18} className="text-[var(--blue-mid)] shrink-0" />
                    <div>
                      Você está enviando <strong className="font-bold text-[var(--blue-mid)]">{selecionadosCount} servidor(es)</strong> para a Fila Avulsa de conferência no SISREF.
                    </div>
                  </div>

                  {/* NOME DA FILA */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--text)] mb-1.5">
                      Nome da Fila no SISREF:
                    </label>
                    <input
                      type="text"
                      value={nomeFilaInput}
                      onChange={(e) => setNomeFilaInput(e.target.value)}
                      placeholder="Ex: Sem Lançamento (10/2025)"
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--blue-mid)]"
                    />

                    {/* SUGESTÕES DE FILAS EXISTENTES SE HOUVER */}
                    {Object.keys(state.filaAvulsa?.listas || {}).length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-[var(--text2)] font-bold mr-1">Filas existentes:</span>
                        {Object.keys(state.filaAvulsa?.listas || {}).map(nome => (
                          <button
                            key={nome}
                            type="button"
                            onClick={() => setNomeFilaInput(nome)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${nomeFilaInput === nome ? 'bg-[var(--blue-mid)] text-white border-[var(--blue-mid)]' : 'bg-[var(--bg)] text-[var(--text2)] border-[var(--border)] hover:text-[var(--text)]'}`}
                          >
                            {nome}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* MODO DE ENVIO: SUBSTITUIR OU ADICIONAR */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--text)] mb-1.5">
                      Ação se a fila já existir:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2.5 transition ${modoFila === 'substituir' ? 'border-[var(--blue-mid)] bg-[var(--blue-mid)]/5' : 'border-[var(--border)] bg-[var(--bg)]/40'}`}>
                        <input
                          type="radio"
                          name="modoFila"
                          checked={modoFila === 'substituir'}
                          onChange={() => setModoFila('substituir')}
                          className="mt-0.5 text-[var(--blue-mid)]"
                        />
                        <div>
                          <div className="font-bold text-[var(--text)]">Criar / Substituir</div>
                          <div className="text-[10px] text-[var(--text2)] font-medium mt-0.5">
                            Cria nova fila ou substitui totalmente os servidores da fila com este nome.
                          </div>
                        </div>
                      </label>

                      <label className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2.5 transition ${modoFila === 'adicionar' ? 'border-[var(--blue-mid)] bg-[var(--blue-mid)]/5' : 'border-[var(--border)] bg-[var(--bg)]/40'}`}>
                        <input
                          type="radio"
                          name="modoFila"
                          checked={modoFila === 'adicionar'}
                          onChange={() => setModoFila('adicionar')}
                          className="mt-0.5 text-[var(--blue-mid)]"
                        />
                        <div>
                          <div className="font-bold text-[var(--text)]">Acrescentar</div>
                          <div className="text-[10px] text-[var(--text2)] font-medium mt-0.5">
                            Adiciona aos já existentes sem duplicar matrículas que já estejam na fila.
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* PREVIEW RÁPIDO */}
                  <div className="text-[11px] text-[var(--text2)] bg-[var(--bg)]/60 p-3 rounded-xl border border-[var(--border)]">
                    Cada servidor será adicionado à fila com uma ocorrência de verificação contendo o mês de corte ({formatarMesAnoCurto(corteMesAno)}) e a referência do seu último registro anterior.
                  </div>

                </div>

                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg)]/30 flex justify-end gap-2 text-xs">
                  <button
                    onClick={() => setIsModalFilaOpen(false)}
                    className="px-4 py-2 rounded-xl font-bold text-[var(--text2)] hover:text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarEnvioFilaAvulsa}
                    className="px-5 py-2 rounded-xl font-black text-white bg-[var(--blue-mid)] hover:bg-blue-600 shadow-sm transition flex items-center gap-1.5"
                  >
                    <Send size={13} />
                    <span>Confirmar Envio</span>
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>
      )}

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

