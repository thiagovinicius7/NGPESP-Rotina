import React, { useState, useEffect, useMemo } from "react";
import { AppState, HistoryEntry, QueueServer, LancamentoAnteriorItem } from "../types.js";
import { getLocalDateIso, toYmdDate, cleanTipoName, getSaoPauloHour, normalizeMatricula } from "../lib/utils.js";
import ModalColarLancamentosAnteriores from "./ModalColarLancamentosAnteriores.js";
import { AtividadeLancamento, ProdutividadeDia } from "../types.js";
import { situacaoTurno, labelSituacao, qtdNum } from "../lib/produtividade.js";
import { copiarTabela, baixarCSV, imprimirTabela } from "../lib/exportar.js";
import { TrendingUp, PhoneCall } from "lucide-react";
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

type TipoRelatorio = 'afastamentos' | 'sem-lancamentos' | 'conf' | 'setor' | 'produtividade' | 'balcao';

const TIPOS_RELATORIO: { id: TipoRelatorio; titulo: string; desc: string }[] = [
  { id: 'afastamentos', titulo: 'Afastamentos lançados', desc: 'O que foi lançado, por mês' },
  { id: 'sem-lancamentos', titulo: 'Sem lançamento', desc: 'Servidores sem nada desde um mês' },
  { id: 'conf', titulo: 'Conferências', desc: 'Servidores conferidos, dia a dia' },
  { id: 'setor', titulo: 'Por setor', desc: 'Conferências agrupadas por lotação' },
  { id: 'produtividade', titulo: 'Produtividade', desc: 'Atividades num período' },
  { id: 'balcao', titulo: 'Balcão', desc: 'Atendimentos num período' }
];

// Format YYYY-MM to readable Portuguese (e.g. "Outubro de 2025 (10/2025)")
function formatarMesAnoExtenso(yyyyMm: string): string {
  if (!yyyyMm || !yyyyMm.includes("-")) return yyyyMm || "";
  const [y, m] = yyyyMm.split("-");
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const mNum = parseInt(m, 10);
  const mNome = meses[mNum - 1] || m;
  return `${mNome} de ${y} (${m}/${y})`;
}

// Format YYYY-MM to short label (e.g. "10/2025")
function formatarMesAnoCurto(yyyyMm: string): string {
  if (!yyyyMm || !yyyyMm.includes("-")) return yyyyMm || "";
  const [y, m] = yyyyMm.split("-");
  return `${m}/${y}`;
}

// ---------- peças visuais da tela de relatórios ----------
const inputCls = "w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--blue-mid)]";

function Campo({ rotulo, children, className = "" }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider">{rotulo}</span>
      {children}
    </div>
  );
}

function Segmentos<T extends string>({ valor, opcoes, onChange }: { valor: T; opcoes: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex p-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded-xl">
      {opcoes.map(o => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`flex-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition ${valor === o.id ? "bg-[var(--surface)] text-[var(--blue-mid)] shadow-xs" : "text-[var(--text2)] hover:text-[var(--text)]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BarraResultado({ resumo, copiado, onExportar, extra }: { resumo: React.ReactNode; copiado: boolean; onExportar: (c: "copiar" | "csv" | "imprimir") => void; extra?: React.ReactNode }) {
  const btn = "px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text)] flex items-center gap-1";
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap px-4 lg:px-5 py-3 border-b border-[var(--border)] bg-[var(--bg)]/40">
      <div className="text-xs font-semibold text-[var(--text2)] flex items-center gap-2 flex-wrap">{resumo}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {extra}
        <button type="button" onClick={() => onExportar("copiar")} className={btn} title="Copiar para colar no Excel, Word ou SEI">
          {copiado ? <Check size={13} className="text-emerald-500" /> : <FileSpreadsheet size={13} className="text-emerald-600" />} {copiado ? "Copiado" : "Copiar"}
        </button>
        <button type="button" onClick={() => onExportar("csv")} className={btn} title="Baixar planilha CSV"><Download size={13} /> CSV</button>
        <button type="button" onClick={() => onExportar("imprimir")} className={btn} title="Imprimir só esta tabela"><Printer size={13} /> Imprimir</button>
      </div>
    </div>
  );
}

const thCls = "px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text2)] text-left";
const tdCls = "px-3 py-2 align-top";

export default function RelatorioPanel({ state, updateState, onToast, onNavigateToSisref }: RelatorioPanelProps) {
  const [subTab, setSubTabRaw] = useState<TipoRelatorio>(() => {
    try {
      const v = localStorage.getItem("ngpesp_rel_tipo") as TipoRelatorio | null;
      return v && TIPOS_RELATORIO.some(t => t.id === v) ? v : 'afastamentos';
    } catch (_) { return 'afastamentos'; }
  });
  const setSubTab = (t: TipoRelatorio) => {
    setSubTabRaw(t);
    try { localStorage.setItem("ngpesp_rel_tipo", t); } catch (_) { /* ok */ }
  };
  // Afastamentos
  const [agruparAfast, setAgruparAfast] = useState<'servidor' | 'tipo' | 'lista'>('servidor');
  const [limiteAfast, setLimiteAfast] = useState(100);
  // Conferências / setor
  const [confMes, setConfMes] = useState<string>(() => getLocalDateIso().slice(0, 7));
  const [confBusca, setConfBusca] = useState("");
  const [limiteConf, setLimiteConf] = useState(150);
  // Produtividade / balcão
  const [perDe, setPerDe] = useState<string>(() => getLocalDateIso().slice(0, 8) + "01");
  const [perAte, setPerAte] = useState<string>(() => getLocalDateIso());
  const [prodAgrupar, setProdAgrupar] = useState<'dia' | 'tipo' | 'sistema'>('dia');
  const [copiado, setCopiado] = useState(false);
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

  // Modal Lançamentos Anteriores ao Sistema (Histórico SISREF)
  const [isModalAnterioresOpen, setIsModalAnterioresOpen] = useState(false);

  const lancamentosSalvos = useMemo<LancamentoAnteriorItem[]>(() => {
    return (state.config?.lancamentosAnteriores || state.lancamentosAnteriores || []) as LancamentoAnteriorItem[];
  }, [state.config?.lancamentosAnteriores, state.lancamentosAnteriores]);

  const handleSalvarAnteriores = (novosItens: LancamentoAnteriorItem[], modo: 'adicionar' | 'substituir') => {
    const atuais = (state.config?.lancamentosAnteriores || state.lancamentosAnteriores || []) as LancamentoAnteriorItem[];
    let finalItens: LancamentoAnteriorItem[];
    if (modo === 'substituir') {
      finalItens = novosItens;
    } else {
      const map = new Map<string, LancamentoAnteriorItem>();
      (atuais || []).forEach(it => {
        if (!it || !it.matricula) return;
        const key = `${normalizeMatricula(it.matricula)}_${(it.tipo || '').toLowerCase()}_${it.dataOcorrencia || ''}_${it.mesAnoOcorrencia || ''}`;
        map.set(key, it);
      });
      (novosItens || []).forEach(it => {
        if (!it || !it.matricula) return;
        const key = `${normalizeMatricula(it.matricula)}_${(it.tipo || '').toLowerCase()}_${it.dataOcorrencia || ''}_${it.mesAnoOcorrencia || ''}`;
        map.set(key, it);
      });
      finalItens = Array.from(map.values());
    }

    updateState(prev => ({
      config: {
        ...(prev.config || {}),
        lancamentosAnteriores: finalItens
      },
      lancamentosAnteriores: finalItens
    }));

    onToast(`${novosItens.length} lançamento(s) anterior(es) salvo(s) com sucesso! Servidores com afastamentos a partir da data de corte foram atualizados.`, "ok");
  };

  const handleExcluirAnterior = (id: string) => {
    const atuais = (state.config?.lancamentosAnteriores || state.lancamentosAnteriores || []) as LancamentoAnteriorItem[];
    const finalItens = atuais.filter(it => it.id !== id);
    updateState(prev => ({
      config: {
        ...(prev.config || {}),
        lancamentosAnteriores: finalItens
      },
      lancamentosAnteriores: finalItens
    }));
    onToast("Lançamento anterior removido do sistema.", "info");
  };

  const handleLimparTodosAnteriores = () => {
    updateState(prev => ({
      config: {
        ...(prev.config || {}),
        lancamentosAnteriores: []
      },
      lancamentosAnteriores: []
    }));
    onToast("Todos os lançamentos anteriores ao sistema foram removidos.", "info");
  };

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
      const setor = srv?.lotacao || srv?.codLotacao || h.setor || "Não especificado";
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

          const uniqueKey = `${normalizeMatricula(h.mat)}_${cleanTipo.toLowerCase()}_${dataOc}_${launchYmd}`;
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

              const uniqueKey = `${normalizeMatricula(server.matricula)}_${cleanTipo.toLowerCase()}_${dataOc}_${lYmd}`;
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

    // 3. Source: Lançamentos Anteriores ao Sistema (Histórico SISREF colado manualmente)
    const anteriores = (state.config?.lancamentosAnteriores || state.lancamentosAnteriores || []) as LancamentoAnteriorItem[];
    anteriores.forEach((item, idx) => {
      if (!item || !item.matricula) return;
      const nMat = normalizeMatricula(item.matricula);
      const srv = (state.servidores || []).find(s => s && s.matricula && normalizeMatricula(s.matricula) === nMat);
      const setor = srv?.lotacao || srv?.codLotacao || "Não especificado";
      const cargo = srv?.cargo || srv?.denominacao || "";
      const cleanTipo = cleanTipoName(item.tipo) || item.tipo || "Afastamento Anterior";
      const mesAno = item.mesAnoOcorrencia || (item.dataOcorrencia ? toYmdDate(item.dataOcorrencia).slice(0, 7) : "");

      const uniqueKey = `${nMat}_ant_${cleanTipo}_${item.dataOcorrencia}_${mesAno}_${idx}`;
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        list.push({
          id: item.id || `ant_${nMat}_${idx}`,
          matricula: item.matricula,
          nome: item.nome || srv?.nome || "Servidor",
          setor,
          cargo,
          tipo: cleanTipo,
          tipoRaw: item.tipo,
          dataOcorrencia: item.dataOcorrencia,
          dataLancamentoIso: "", // Considerar sem data de lançamento identificada
          dataLancamentoFormatada: "Lançamento Anterior ao SISREF",
          mesAnoLancamento: mesAno, // Qualifies in month filters
          mesAnoOcorrencia: mesAno,
          origem: "Lançamento Anterior ao SISREF"
        });
      }
    });

    return list.sort((a, b) => {
      // Sort newest launches first, then by name
      const valA = a.dataLancamentoIso || (a.mesAnoOcorrencia ? a.mesAnoOcorrencia + "-01" : "");
      const valB = b.dataLancamentoIso || (b.mesAnoOcorrencia ? b.mesAnoOcorrencia + "-01" : "");
      const cmp = valB.localeCompare(valA);
      if (cmp !== 0) return cmp;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [state.historico, state.filaAvulsa, state.servidores, state.config?.lancamentosAnteriores, state.lancamentosAnteriores]);

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

  const setoresSemLanc = useMemo(() => Array.from(new Set(relatorioSemLancamentoCompleto.map(s => String(s.setor || "")).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b, "pt-BR")), [relatorioSemLancamentoCompleto]);

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

  // ======================= DADOS DA NOVA TELA DE RELATÓRIOS =======================
  const srvPorMat = useMemo(() => {
    const m = new Map<string, any>();
    (state.servidores || []).forEach(s => { if (s?.matricula) m.set(normalizeMatricula(s.matricula), s); });
    return m;
  }, [state.servidores]);
  const lotacaoDe = (mat: string, fallback?: string) => {
    const s = srvPorMat.get(normalizeMatricula(mat));
    return s?.lotacao || s?.codLotacao || fallback || "Não especificado";
  };

  // Afastamentos agrupados
  const afastPorServidor = useMemo(() => {
    const m = new Map<string, { matricula: string; nome: string; setor: string; itens: AfastamentoReportItem[] }>();
    afastamentosFiltrados.forEach(it => {
      const k = normalizeMatricula(it.matricula) || it.nome;
      if (!m.has(k)) m.set(k, { matricula: it.matricula, nome: it.nome, setor: it.setor, itens: [] });
      m.get(k)!.itens.push(it);
    });
    const arr = Array.from(m.values());
    arr.forEach(g => g.itens.sort((a, b) => (toYmdDate(a.dataOcorrencia) || "").localeCompare(toYmdDate(b.dataOcorrencia) || "")));
    return arr.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [afastamentosFiltrados]);

  const afastPorTipo = useMemo(() => {
    const m = new Map<string, { tipo: string; qtd: number; servidores: Set<string> }>();
    afastamentosFiltrados.forEach(it => {
      if (!m.has(it.tipo)) m.set(it.tipo, { tipo: it.tipo, qtd: 0, servidores: new Set() });
      const g = m.get(it.tipo)!;
      g.qtd++;
      g.servidores.add(normalizeMatricula(it.matricula));
    });
    return Array.from(m.values()).sort((a, b) => b.qtd - a.qtd);
  }, [afastamentosFiltrados]);

  // Conferências do mês escolhido
  const confFiltradas = useMemo(() => {
    const q = confBusca.trim().toLowerCase();
    return (state.historico || [])
      .map((h, idx) => ({ h, idx }))
      .filter(({ h }) => h && h.ts && (confMes === "todos" || toYmdDate(h.ts).startsWith(confMes)))
      .filter(({ h }) => !q || `${h.nome} ${h.mat} ${lotacaoDe(h.mat, h.setor)}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.h.ts).localeCompare(String(a.h.ts)));
  }, [state.historico, confMes, confBusca, srvPorMat]);

  const lancDe = (h: HistoryEntry) => Math.max(1, typeof h.qtd === "number" && h.qtd > 0 ? h.qtd : (h.ocorrencias?.length || 1));

  const confPorSetor = useMemo(() => {
    const m = new Map<string, { setor: string; conf: number; lanc: number; lista: HistoryEntry[] }>();
    confFiltradas.forEach(({ h }) => {
      const s = lotacaoDe(h.mat, h.setor);
      if (!m.has(s)) m.set(s, { setor: s, conf: 0, lanc: 0, lista: [] });
      const g = m.get(s)!;
      g.conf++;
      g.lanc += lancDe(h);
      g.lista.push(h);
    });
    return Array.from(m.values()).sort((a, b) => b.conf - a.conf);
  }, [confFiltradas]);

  // Produtividade e balcão no período
  const diasPeriodo = useMemo(() => {
    const de = perDe <= perAte ? perDe : perAte;
    const ate = perDe <= perAte ? perAte : perDe;
    return Object.entries<ProdutividadeDia>(state.produtividade || {})
      .map(([k, d]) => ({ iso: toYmdDate(k), d }))
      .filter(x => x.iso >= de && x.iso <= ate)
      .sort((a, b) => a.iso.localeCompare(b.iso));
  }, [state.produtividade, perDe, perAte]);

  const prodLinhas = useMemo(() => {
    const out: { iso: string; turno: "manha" | "tarde"; a: AtividadeLancamento }[] = [];
    diasPeriodo.forEach(({ iso, d }) => (["manha", "tarde"] as const).forEach(turno => (d?.[turno] || []).forEach(a => out.push({ iso, turno, a }))));
    return out;
  }, [diasPeriodo]);

  const prodResumo = useMemo(() => {
    const turnos: Record<string, number> = {};
    diasPeriodo.forEach(({ d }) => (["manha", "tarde"] as const).forEach(t => {
      const s = situacaoTurno(d, t);
      turnos[s] = (turnos[s] || 0) + 0.5;
    }));
    const itens = prodLinhas.reduce((s, x) => s + qtdNum(x.a), 0);
    return { itens, atividades: prodLinhas.length, dias: diasPeriodo.length, turnos };
  }, [diasPeriodo, prodLinhas]);

  const prodGrupos = useMemo(() => {
    const m = new Map<string, { chave: string; rotulo: string; itens: number; atividades: number; detalhe: string[] }>();
    prodLinhas.forEach(({ iso, a }) => {
      const k = prodAgrupar === "dia" ? iso : prodAgrupar === "tipo" ? (a.tipo || "—") : (a.sistema || "—");
      const rot = prodAgrupar === "dia" ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) : k;
      if (!m.has(k)) m.set(k, { chave: k, rotulo: rot, itens: 0, atividades: 0, detalhe: [] });
      const g = m.get(k)!;
      g.itens += qtdNum(a);
      g.atividades++;
      const det = prodAgrupar === "dia" ? `${a.tipo} (${a.sistema})` : prodAgrupar === "tipo" ? (a.sistema || "") : (a.tipo || "");
      if (det && !g.detalhe.includes(det)) g.detalhe.push(det);
    });
    // dias sem atividade mas com situação (férias, atestado…) também aparecem no agrupamento por dia
    if (prodAgrupar === "dia") diasPeriodo.forEach(({ iso }) => {
      if (!m.has(iso)) m.set(iso, { chave: iso, rotulo: new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }), itens: 0, atividades: 0, detalhe: [] });
    });
    const arr = Array.from(m.values());
    return prodAgrupar === "dia" ? arr.sort((a, b) => a.chave.localeCompare(b.chave)) : arr.sort((a, b) => b.itens - a.itens);
  }, [prodLinhas, diasPeriodo, prodAgrupar]);

  const situacaoDoDia = (iso: string) => {
    const d = diasPeriodo.find(x => x.iso === iso)?.d;
    const m = situacaoTurno(d, "manha"), t = situacaoTurno(d, "tarde");
    return m === t ? labelSituacao(m) : `M: ${labelSituacao(m)} · T: ${labelSituacao(t)}`;
  };

  const balcaoLinhas = useMemo(() => {
    const out: { iso: string; hora: string; texto: string; antigo?: boolean }[] = [];
    prodLinhas.forEach(({ iso, turno, a }) => {
      if (a.origem === "balcao" || a.sistema === "Balcão") out.push({ iso, hora: a.inicio ? `${a.inicio}${a.fim ? "–" + a.fim : ""}` : (turno === "manha" ? "Manhã" : "Tarde"), texto: a.desc || "" });
    });
    const de = perDe <= perAte ? perDe : perAte, ate = perDe <= perAte ? perAte : perDe;
    Object.entries<string>(state.balcaoAtendimentos || {}).forEach(([iso, txt]) => {
      if (iso < de || iso > ate) return;
      String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).forEach(l => out.push({ iso, hora: "—", texto: l, antigo: true }));
    });
    return out.sort((a, b) => (a.iso + a.hora).localeCompare(b.iso + b.hora));
  }, [prodLinhas, state.balcaoAtendimentos, perDe, perAte]);

  const fmtData = (iso: string) => iso ? iso.split("-").reverse().join("/") : "";
  const rotuloPeriodo = `${fmtData(perDe <= perAte ? perDe : perAte)} a ${fmtData(perDe <= perAte ? perAte : perDe)}`;
  const rotuloConfMes = confMes === "todos" ? "todos os meses" : formatarMesAnoCurto(confMes);

  // Dados para copiar / CSV / imprimir, conforme o relatório escolhido
  const dadosExport = (): { titulo: string; sub: string; arquivo: string; headers: string[]; rows: (string | number)[][] } | null => {
    if (subTab === 'afastamentos') {
      if (agruparAfast === 'tipo') return {
        titulo: "Afastamentos lançados por tipo", sub: labelMesAtivo, arquivo: `afastamentos_por_tipo_${filtroMes}`,
        headers: ["Tipo", "Quantidade", "Servidores"], rows: afastPorTipo.map(g => [g.tipo, g.qtd, g.servidores.size])
      };
      return {
        titulo: "Afastamentos lançados", sub: `${labelMesAtivo} · ${afastamentosFiltrados.length} afastamento(s) de ${servidoresUnicosFiltrados} servidor(es)`, arquivo: `afastamentos_${filtroMes}`,
        headers: ["Servidor", "Matrícula", "Lotação", "Afastamento", "Data do afastamento", "Lançado em"],
        rows: (agruparAfast === 'servidor' ? afastPorServidor.flatMap(g => g.itens) : afastamentosFiltrados).map(it => [it.nome, it.matricula, it.setor, it.tipo, it.dataOcorrencia, it.dataLancamentoFormatada])
      };
    }
    if (subTab === 'sem-lancamentos') return {
      titulo: "Servidores sem lançamento", sub: `desde ${formatarMesAnoCurto(corteMesAno)} · ${servidoresSemLancFiltrados.length} servidor(es)`, arquivo: `sem_lancamento_${corteMesAno}`,
      headers: ["Servidor", "Matrícula", "Cargo", "Lotação", "Último registro"],
      rows: servidoresSemLancFiltrados.map(s => [s.nome, s.matricula, s.cargo, s.setor, s.ultimoLancamento ? `${s.ultimoLancamento.data} (${s.ultimoLancamento.tipo})` : "Nunca lançado"])
    };
    if (subTab === 'conf') return {
      titulo: "Conferências", sub: `${rotuloConfMes} · ${confFiltradas.length} conferência(s)`, arquivo: `conferencias_${confMes}`,
      headers: ["Data", "Hora", "Servidor", "Matrícula", "Lotação", "Lançamentos", "Ocorrências"],
      rows: confFiltradas.map(({ h }) => [new Date(h.ts).toLocaleDateString("pt-BR"), new Date(h.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), h.nome, h.mat, lotacaoDe(h.mat, h.setor), lancDe(h), (h.ocorrencias || []).join("; ")])
    };
    if (subTab === 'setor') return {
      titulo: "Conferências por setor", sub: rotuloConfMes, arquivo: `conferencias_por_setor_${confMes}`,
      headers: ["Setor", "Conferências", "Lançamentos"], rows: confPorSetor.map(g => [g.setor, g.conf, g.lanc])
    };
    if (subTab === 'produtividade') return {
      titulo: "Produtividade", sub: `${rotuloPeriodo} · ${prodResumo.itens} itens em ${prodResumo.atividades} atividade(s)`, arquivo: `produtividade_${perDe}_${perAte}`,
      headers: ["Data", "Turno", "Situação", "Qtd", "Tipo", "Sistema", "Detalhes", "Processos SEI"],
      rows: prodLinhas.map(({ iso, turno, a }) => [fmtData(iso), turno === "manha" ? "Manhã" : "Tarde", labelSituacao(situacaoTurno(diasPeriodo.find(x => x.iso === iso)?.d, turno)), qtdNum(a), a.tipo, a.sistema, a.desc || "", a.processosSei || ""])
    };
    if (subTab === 'balcao') return {
      titulo: "Atendimentos de balcão", sub: `${rotuloPeriodo} · ${balcaoLinhas.length} atendimento(s)`, arquivo: `balcao_${perDe}_${perAte}`,
      headers: ["Data", "Horário", "Atendimento"], rows: balcaoLinhas.map(b => [fmtData(b.iso), b.hora, b.texto])
    };
    return null;
  };

  const exportar = async (como: "copiar" | "csv" | "imprimir") => {
    const d = dadosExport();
    if (!d || d.rows.length === 0) { onToast("Nada para exportar com estes filtros.", "info"); return; }
    if (como === "copiar") {
      const ok = await copiarTabela(d.headers, d.rows);
      if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
      onToast(ok ? `Tabela copiada (${d.rows.length} linhas). Cole no Excel, Word ou SEI.` : "Não foi possível copiar.", ok ? "ok" : "err");
    } else if (como === "csv") {
      baixarCSV(d.arquivo, d.headers, d.rows);
      onToast("Arquivo CSV baixado.", "ok");
    } else {
      imprimirTabela(d.titulo, d.sub, d.headers, d.rows);
    }
  };

  const iconeTipo: Record<TipoRelatorio, React.ReactNode> = {
    'afastamentos': <FileText size={16} />,
    'sem-lancamentos': <UserX size={16} />,
    'conf': <List size={16} />,
    'setor': <PieChart size={16} />,
    'produtividade': <TrendingUp size={16} />,
    'balcao': <PhoneCall size={16} />
  };
  const contagemTipo: Partial<Record<TipoRelatorio, number>> = {
    'sem-lancamentos': statsSemLanc.totalSemLanc
  };

  return (
    <div className="flex flex-col gap-4 lg:gap-5">

      {/* ESCOLHA DO RELATÓRIO */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {TIPOS_RELATORIO.map(t => {
            const ativo = subTab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setSubTab(t.id)}
                className={`text-left p-3 rounded-xl border transition ${ativo ? "border-[var(--blue-mid)] bg-[var(--blue-light)] ring-1 ring-[var(--blue-mid)]/30" : "border-[var(--border)] hover:bg-[var(--bg)]"}`}>
                <div className={`flex items-center gap-1.5 text-xs font-black ${ativo ? "text-[var(--blue-mid)]" : "text-[var(--text)]"}`}>
                  {iconeTipo[t.id]} <span className="truncate">{t.titulo}</span>
                  {contagemTipo[t.id] ? <span className="ml-auto px-1.5 rounded-full text-[10px] bg-[var(--red)]/15 text-[var(--red)]">{contagemTipo[t.id]}</span> : null}
                </div>
                <div className="text-[10px] font-semibold text-[var(--text2)] mt-0.5 leading-tight">{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============ AFASTAMENTOS LANÇADOS ============ */}
      {subTab === 'afastamentos' && (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <Campo rotulo="Mês" className="col-span-1 lg:col-span-2">
              <div className="flex gap-1">
                <input type="month" value={filtroMes === "todos" ? "" : filtroMes} onChange={e => { setFiltroMes(e.target.value || "todos"); setLimiteAfast(100); }} className={inputCls} />
                {filtroMes !== "todos" && <button type="button" onClick={() => setFiltroMes("todos")} className="px-2 text-[10px] font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]" title="Todos os meses">Todos</button>}
              </div>
            </Campo>
            <Campo rotulo="Contar pelo mês do" className="col-span-1 lg:col-span-2">
              <select value={criterioMes} onChange={e => setCriterioMes(e.target.value as any)} className={inputCls}>
                <option value="ambos">Lançamento ou afastamento</option>
                <option value="lancamento">Lançamento</option>
                <option value="ocorrencia">Afastamento</option>
              </select>
            </Campo>
            <Campo rotulo="Tipo" className="col-span-2 lg:col-span-3">
              <select value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setLimiteAfast(100); }} className={inputCls}>
                <option value="todos">Todos os tipos</option>
                {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Buscar" className="col-span-2 lg:col-span-2">
              <input type="text" value={filtroBusca} onChange={e => { setFiltroBusca(e.target.value); setLimiteAfast(100); }} placeholder="Nome, matrícula ou setor" className={inputCls} />
            </Campo>
            <Campo rotulo="Mostrar" className="col-span-2 lg:col-span-3">
              <Segmentos valor={agruparAfast} onChange={v => { setAgruparAfast(v); setLimiteAfast(100); }}
                opcoes={[{ id: 'servidor', label: 'Por servidor' }, { id: 'tipo', label: 'Por tipo' }, { id: 'lista', label: 'Lista' }]} />
            </Campo>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
            <BarraResultado
              copiado={copiado}
              onExportar={exportar}
              resumo={<>
                <b className="text-[var(--text)] text-sm">{afastamentosFiltrados.length}</b> afastamento(s) de
                <b className="text-[var(--text)] text-sm">{servidoresUnicosFiltrados}</b> servidor(es) · {labelMesAtivo}
                {(filtroTipo !== "todos" || filtroBusca) && (
                  <button type="button" onClick={() => { setFiltroTipo("todos"); setFiltroBusca(""); }} className="text-[var(--blue-mid)] font-bold hover:underline">limpar filtros</button>
                )}
              </>}
              extra={
                <button type="button" onClick={() => setIsModalAnterioresOpen(true)} className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" title="Lançamentos feitos antes de usar o sistema">
                  Anteriores ao sistema{lancamentosSalvos.length ? ` (${lancamentosSalvos.length})` : ""}
                </button>
              }
            />

            {agruparAfast === 'tipo' ? (
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr><th className={thCls}>Tipo</th><th className={`${thCls} text-right`}>Afastamentos</th><th className={`${thCls} text-right`}>Servidores</th><th className={thCls}></th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {afastPorTipo.map(g => (
                    <tr key={g.tipo} className="hover:bg-[var(--bg)]">
                      <td className={`${tdCls} font-bold text-[var(--text)]`}>{g.tipo}</td>
                      <td className={`${tdCls} text-right font-black text-[var(--blue-mid)]`}>{g.qtd}</td>
                      <td className={`${tdCls} text-right font-bold`}>{g.servidores.size}</td>
                      <td className={`${tdCls} text-right`}><button type="button" onClick={() => { setFiltroTipo(g.tipo); setAgruparAfast('servidor'); }} className="text-[11px] font-bold text-[var(--blue-mid)] hover:underline">ver servidores</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : agruparAfast === 'servidor' ? (
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr><th className={thCls}>Servidor</th><th className={thCls}>Afastamentos (data)</th><th className={`${thCls} hidden md:table-cell`}>Lançado em</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {afastPorServidor.slice(0, limiteAfast).map(g => (
                    <tr key={g.matricula + g.nome} className="hover:bg-[var(--bg)]">
                      <td className={`${tdCls} w-[38%]`}>
                        <div className="font-bold text-[var(--text)] text-[13px]">{g.nome}</div>
                        <div className="text-[11px] text-[var(--text2)] font-mono">{g.matricula}<span className="font-sans"> · {g.setor}</span></div>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-col gap-1">
                          {Array.from(g.itens.reduce((m, it) => {
                            const k = `${it.dataOcorrencia}|${it.tipo}`;
                            const e = m.get(k) || { it, vezes: 0 };
                            e.vezes++;
                            return m.set(k, e);
                          }, new Map<string, { it: AfastamentoReportItem; vezes: number }>()).values()).map(({ it, vezes }) => (
                            <div key={it.id} className="flex items-baseline gap-2 flex-wrap">
                              <span className="font-mono font-bold text-[var(--text)]">{it.dataOcorrencia}</span>
                              <span className="text-[var(--text2)] font-semibold">{it.tipo}</span>
                              {vezes > 1 && <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-300" title="O mesmo afastamento aparece lançado mais de uma vez">lançado {vezes}x</span>}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className={`${tdCls} hidden md:table-cell text-[11px] text-[var(--text2)] font-mono whitespace-nowrap`}>
                        {Array.from(new Set(g.itens.map(it => it.dataLancamentoIso ? new Date(it.dataLancamentoIso).toLocaleDateString("pt-BR") : "anterior"))).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr><th className={thCls}>Data</th><th className={thCls}>Servidor</th><th className={thCls}>Afastamento</th><th className={`${thCls} hidden md:table-cell`}>Lançado em</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {afastamentosFiltrados.slice(0, limiteAfast).map(it => (
                    <tr key={it.id} className="hover:bg-[var(--bg)]">
                      <td className={`${tdCls} font-mono font-bold whitespace-nowrap`}>{it.dataOcorrencia}</td>
                      <td className={tdCls}><div className="font-bold text-[var(--text)]">{it.nome}</div><div className="text-[11px] text-[var(--text2)] font-mono">{it.matricula}</div></td>
                      <td className={`${tdCls} text-[var(--text2)] font-semibold`}>{it.tipo}</td>
                      <td className={`${tdCls} hidden md:table-cell text-[11px] text-[var(--text2)] font-mono whitespace-nowrap`}>{it.dataLancamentoFormatada}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {agruparAfast !== 'tipo' && (agruparAfast === 'servidor' ? afastPorServidor.length : afastamentosFiltrados.length) > limiteAfast && (
              <div className="p-3 text-center border-t border-[var(--border)]">
                <button type="button" onClick={() => setLimiteAfast(l => l + 200)} className="px-4 py-2 text-xs font-bold rounded-lg bg-[var(--blue-light)] text-[var(--blue-mid)]">
                  Mostrar mais ({(agruparAfast === 'servidor' ? afastPorServidor.length : afastamentosFiltrados.length) - limiteAfast} restantes)
                </button>
              </div>
            )}
            {afastamentosFiltrados.length === 0 && <div className="p-10 text-center text-xs font-bold text-[var(--text2)]">Nenhum afastamento com estes filtros.</div>}
          </div>
        </>
      )}

      {/* ============ SERVIDORES SEM LANÇAMENTO ============ */}
      {subTab === 'sem-lancamentos' && (
        <div className="flex flex-col gap-4 lg:gap-5">
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

          {/* FILTROS — SEM LANÇAMENTO */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <Campo rotulo="Sem lançamento desde" className="col-span-1 lg:col-span-2">
              <input type="month" value={corteMesAno} onChange={e => { if (e.target.value) { setCorteMesAno(e.target.value); setSelectedMatriculasSemLanc({}); } }} className={inputCls} />
            </Campo>
            <Campo rotulo="Considerar a data do" className="col-span-1 lg:col-span-2">
              <select value={criterioSemLanc} onChange={e => setCriterioSemLanc(e.target.value as any)} className={inputCls}>
                <option value="qualquer">Lançamento ou afastamento</option>
                <option value="lancamento">Lançamento</option>
                <option value="ocorrencia">Afastamento</option>
              </select>
            </Campo>
            <Campo rotulo="Setor" className="col-span-2 lg:col-span-3">
              <select value={filtroSetorSemLanc} onChange={e => setFiltroSetorSemLanc(e.target.value)} className={inputCls}>
                <option value="todos">Todos os setores</option>
                {setoresSemLanc.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Buscar" className="col-span-2 lg:col-span-2">
              <input type="text" value={filtroBuscaSemLanc} onChange={e => setFiltroBuscaSemLanc(e.target.value)} placeholder="Nome, matrícula, cargo" className={inputCls} />
            </Campo>
            <Campo rotulo="Ordenar" className="col-span-1 lg:col-span-2">
              <select value={ordenacaoSemLanc} onChange={e => setOrdenacaoSemLanc(e.target.value as any)} className={inputCls}>
                <option value="nome">Nome</option>
                <option value="matricula">Matrícula</option>
                <option value="setor">Setor</option>
                <option value="ultimoAntigo">Mais tempo sem lançamento</option>
                <option value="ultimoRecente">Lançamento mais recente</option>
              </select>
            </Campo>
            <label className="col-span-1 lg:col-span-1 flex items-center gap-1.5 text-[11px] font-bold text-[var(--text2)] pb-2 cursor-pointer select-none">
              <input type="checkbox" checked={ocultarCedidosSemLanc} onChange={e => setOcultarCedidosSemLanc(e.target.checked)} /> Sem cedidos
            </label>
          </div>

          {/* TABELA DE SERVIDORES SEM LANÇAMENTO */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
            <BarraResultado
              copiado={copiado}
              onExportar={exportar}
              resumo={<>
                <b className="text-[var(--red)] text-sm">{servidoresSemLancFiltrados.length}</b> servidor(es) sem lançamento desde {formatarMesAnoCurto(corteMesAno)}
                <span>· {statsSemLanc.totalNunca} nunca lançado(s) · base de {statsSemLanc.totalGeralServidores}</span>
              </>}
              extra={<>
                <button type="button" onClick={toggleSelectAllSemLanc} className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] flex items-center gap-1">
                  {todosSelecionados ? <CheckSquare size={13} className="text-[var(--blue-mid)]" /> : <Square size={13} />} {selecionadosCount} selecionado(s)
                </button>
                <button type="button" onClick={abrirModalFilaAvulsa} disabled={selecionadosCount === 0}
                  className={`px-3 py-1.5 text-[11px] font-black rounded-lg flex items-center gap-1 ${selecionadosCount > 0 ? "bg-[var(--blue-mid)] text-white" : "bg-[var(--border)] text-[var(--text2)] cursor-not-allowed"}`}>
                  <Layers size={13} /> Enviar para fila
                </button>
                <button type="button" onClick={() => setIsModalAnterioresOpen(true)} className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Anteriores{lancamentosSalvos.length ? ` (${lancamentosSalvos.length})` : ""}
                </button>
              </>}
            />
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


      {/* ============ CONFERÊNCIAS / POR SETOR ============ */}
      {(subTab === 'conf' || subTab === 'setor') && (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <Campo rotulo="Mês" className="col-span-1 lg:col-span-3">
              <div className="flex gap-1">
                <input type="month" value={confMes === "todos" ? "" : confMes} onChange={e => { setConfMes(e.target.value || "todos"); setLimiteConf(150); }} className={inputCls} />
                {confMes !== "todos" && <button type="button" onClick={() => setConfMes("todos")} className="px-2 text-[10px] font-bold rounded-lg border border-[var(--border2)] text-[var(--text2)]">Todos</button>}
              </div>
            </Campo>
            <Campo rotulo="Buscar" className="col-span-1 lg:col-span-4">
              <input type="text" value={confBusca} onChange={e => setConfBusca(e.target.value)} placeholder="Nome, matrícula ou setor" className={inputCls} />
            </Campo>
          </div>

          {subTab === 'conf' ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
              <BarraResultado copiado={copiado} onExportar={exportar}
                resumo={<><b className="text-[var(--text)] text-sm">{confFiltradas.length}</b> conferência(s) · <b className="text-[var(--text)]">{confFiltradas.reduce((s, x) => s + lancDe(x.h), 0)}</b> lançamento(s) · {rotuloConfMes}</>} />
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr><th className={thCls}>Quando</th><th className={thCls}>Servidor</th><th className={`${thCls} hidden md:table-cell`}>Ocorrências</th><th className={`${thCls} text-right`}>Lanç.</th><th className={thCls}></th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {confFiltradas.slice(0, limiteConf).map(({ h, idx }) => (
                    <tr key={idx} className="hover:bg-[var(--bg)] group">
                      <td className={`${tdCls} font-mono text-[11px] text-[var(--text2)] whitespace-nowrap`}>
                        {new Date(h.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}<br />{new Date(h.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className={tdCls}><div className="font-bold text-[var(--text)]">{h.nome}</div><div className="text-[11px] text-[var(--text2)]"><span className="font-mono">{h.mat}</span> · {lotacaoDe(h.mat, h.setor)}</div></td>
                      <td className={`${tdCls} hidden md:table-cell text-[11px] text-[var(--text2)]`}>{(h.ocorrencias || []).join(" · ")}</td>
                      <td className={`${tdCls} text-right font-black text-[var(--blue-mid)]`}>{lancDe(h)}</td>
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        <button onClick={() => editarConferenciaLanc(idx)} className="p-1.5 rounded text-[var(--text2)] hover:bg-[var(--bg)]" title="Corrigir quantidade"><Edit2 size={12} /></button>
                        <button onClick={() => excluirConferencia(idx)} className="p-1.5 rounded text-[var(--text2)] opacity-60 hover:opacity-100 hover:text-[var(--red)]" title="Excluir"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {confFiltradas.length > limiteConf && (
                <div className="p-3 text-center border-t border-[var(--border)]">
                  <button type="button" onClick={() => setLimiteConf(l => l + 300)} className="px-4 py-2 text-xs font-bold rounded-lg bg-[var(--blue-light)] text-[var(--blue-mid)]">Mostrar mais ({confFiltradas.length - limiteConf} restantes)</button>
                </div>
              )}
              {confFiltradas.length === 0 && <div className="p-10 text-center text-xs font-bold text-[var(--text2)]">Nenhuma conferência neste mês.</div>}
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
              <BarraResultado copiado={copiado} onExportar={exportar}
                resumo={<><b className="text-[var(--text)] text-sm">{confPorSetor.length}</b> setor(es) · {confFiltradas.length} conferência(s) · {rotuloConfMes}</>} />
              <div className="divide-y divide-[var(--border)]">
                {confPorSetor.map(g => {
                  const aberto = !!expandedSetores[g.setor];
                  const max = confPorSetor[0]?.conf || 1;
                  return (
                    <div key={g.setor}>
                      <button type="button" onClick={() => toggleSectorExpand(g.setor)} className="w-full px-4 lg:px-5 py-2.5 flex items-center gap-3 text-left hover:bg-[var(--bg)]">
                        <ChevronRight size={14} className={`text-[var(--text2)] transition-transform ${aberto ? "rotate-90" : ""}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-[var(--text)] truncate">{g.setor}</div>
                          <div className="h-1.5 mt-1 rounded-full bg-[var(--bg)] overflow-hidden"><div className="h-full bg-[var(--blue-mid)]/60" style={{ width: `${Math.max(4, (g.conf / max) * 100)}%` }} /></div>
                        </div>
                        <div className="text-right text-[11px] font-bold text-[var(--text2)] whitespace-nowrap"><b className="text-[var(--text)] text-sm">{g.conf}</b> conf. · {g.lanc} lanç.</div>
                      </button>
                      {aberto && (
                        <div className="px-4 lg:px-5 pb-3 pl-11 flex flex-col gap-1">
                          {g.lista.map((h, i) => (
                            <div key={i} className="flex justify-between gap-2 text-[11px] text-[var(--text2)] border-b border-dashed border-[var(--border)] py-1">
                              <span><b className="text-[var(--text)]">{h.nome}</b> <span className="font-mono">({h.mat})</span></span>
                              <span className="font-mono whitespace-nowrap">{lancDe(h)} lanç. · {new Date(h.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {confPorSetor.length === 0 && <div className="p-10 text-center text-xs font-bold text-[var(--text2)]">Nenhuma conferência neste mês.</div>}
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ PRODUTIVIDADE / BALCÃO ============ */}
      {(subTab === 'produtividade' || subTab === 'balcao') && (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 lg:p-5 shadow-sm grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <Campo rotulo="De" className="col-span-1 lg:col-span-2"><input type="date" value={perDe} onChange={e => e.target.value && setPerDe(e.target.value)} className={inputCls} /></Campo>
            <Campo rotulo="Até" className="col-span-1 lg:col-span-2"><input type="date" value={perAte} onChange={e => e.target.value && setPerAte(e.target.value)} className={inputCls} /></Campo>
            <Campo rotulo="Atalhos" className="col-span-2 lg:col-span-4">
              <div className="flex gap-1 flex-wrap">
                {[
                  { l: "Este mês", de: getLocalDateIso().slice(0, 8) + "01", ate: getLocalDateIso() },
                  { l: "Mês passado", ...(() => { const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1); const fim = new Date(d.getFullYear(), d.getMonth(), 0); return { de: getLocalDateIso(ini), ate: getLocalDateIso(fim) }; })() },
                  { l: "Este ano", de: getLocalDateIso().slice(0, 4) + "-01-01", ate: getLocalDateIso() }
                ].map(a => (
                  <button key={a.l} type="button" onClick={() => { setPerDe(a.de); setPerAte(a.ate); }}
                    className={`px-2.5 py-2 text-[11px] font-bold rounded-lg border ${perDe === a.de && perAte === a.ate ? "border-[var(--blue-mid)] bg-[var(--blue-light)] text-[var(--blue-mid)]" : "border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--bg)]"}`}>{a.l}</button>
                ))}
              </div>
            </Campo>
            {subTab === 'produtividade' && (
              <Campo rotulo="Agrupar por" className="col-span-2 lg:col-span-4">
                <Segmentos valor={prodAgrupar} onChange={setProdAgrupar} opcoes={[{ id: 'dia', label: 'Dia' }, { id: 'tipo', label: 'Tipo' }, { id: 'sistema', label: 'Sistema' }]} />
              </Campo>
            )}
          </div>

          {subTab === 'produtividade' ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
              <BarraResultado copiado={copiado} onExportar={exportar}
                resumo={<>
                  <b className="text-[var(--blue-mid)] text-sm">{prodResumo.itens}</b> itens em <b className="text-[var(--text)]">{prodResumo.atividades}</b> atividade(s) · {prodResumo.dias} dia(s) registrados
                  {Object.entries(prodResumo.turnos).filter(([s]) => s !== "normal").map(([s, n]) => (
                    <span key={s} className="px-2 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] font-bold">{labelSituacao(s)}: {n} dia(s)</span>
                  ))}
                </>} />
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr>
                  <th className={thCls}>{prodAgrupar === "dia" ? "Dia" : prodAgrupar === "tipo" ? "Tipo" : "Sistema"}</th>
                  {prodAgrupar === "dia" && <th className={`${thCls} hidden md:table-cell`}>Situação</th>}
                  <th className={`${thCls} hidden md:table-cell`}>{prodAgrupar === "dia" ? "Atividades" : prodAgrupar === "tipo" ? "Sistemas" : "Tipos"}</th>
                  <th className={`${thCls} text-right`}>Ativ.</th><th className={`${thCls} text-right`}>Itens</th>
                </tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {prodGrupos.map(g => (
                    <tr key={g.chave} className="hover:bg-[var(--bg)]">
                      <td className={`${tdCls} font-bold text-[var(--text)] capitalize whitespace-nowrap`}>{g.rotulo}</td>
                      {prodAgrupar === "dia" && <td className={`${tdCls} hidden md:table-cell text-[11px] font-semibold text-[var(--text2)]`}>{situacaoDoDia(g.chave)}</td>}
                      <td className={`${tdCls} hidden md:table-cell text-[11px] text-[var(--text2)]`}>{g.detalhe.join(", ")}</td>
                      <td className={`${tdCls} text-right font-bold`}>{g.atividades}</td>
                      <td className={`${tdCls} text-right font-black text-[var(--blue-mid)]`}>{g.itens}</td>
                    </tr>
                  ))}
                  {prodGrupos.length > 0 && (
                    <tr className="bg-[var(--bg)]/60 font-black">
                      <td className={tdCls}>Total</td>
                      {prodAgrupar === "dia" && <td className={`${tdCls} hidden md:table-cell`}></td>}
                      <td className={`${tdCls} hidden md:table-cell`}></td>
                      <td className={`${tdCls} text-right`}>{prodResumo.atividades}</td>
                      <td className={`${tdCls} text-right text-[var(--blue-mid)]`}>{prodResumo.itens}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {prodGrupos.length === 0 && <div className="p-10 text-center text-xs font-bold text-[var(--text2)]">Nenhuma atividade neste período.</div>}
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
              <BarraResultado copiado={copiado} onExportar={exportar}
                resumo={<><b className="text-teal-600 dark:text-teal-400 text-sm">{balcaoLinhas.length}</b> atendimento(s) em {new Set(balcaoLinhas.map(b => b.iso)).size} dia(s) · {rotuloPeriodo}</>} />
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border)]"><tr><th className={thCls}>Data</th><th className={thCls}>Horário</th><th className={thCls}>Atendimento</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {balcaoLinhas.map((b, i) => (
                    <tr key={i} className="hover:bg-[var(--bg)]">
                      <td className={`${tdCls} font-mono font-bold whitespace-nowrap`}>{fmtData(b.iso)}</td>
                      <td className={`${tdCls} font-mono text-[11px] text-[var(--text2)] whitespace-nowrap`}>{b.hora}</td>
                      <td className={`${tdCls} text-[var(--text)] whitespace-pre-wrap break-words`}>{b.texto}{b.antigo && <span className="ml-1 text-[10px] text-[var(--text2)]">(anotação antiga)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {balcaoLinhas.length === 0 && <div className="p-10 text-center text-xs font-bold text-[var(--text2)]">Nenhum atendimento neste período.</div>}
            </div>
          )}
        </>
      )}

      {/* MODAL COLAR LANÇAMENTOS ANTERIORES AO SISTEMA */}
      <ModalColarLancamentosAnteriores
        isOpen={isModalAnterioresOpen}
        onClose={() => setIsModalAnterioresOpen(false)}
        servidores={state.servidores}
        lancamentosSalvos={lancamentosSalvos}
        onSalvar={handleSalvarAnteriores}
        onExcluirItem={handleExcluirAnterior}
        onLimparTodos={handleLimparTodosAnteriores}
        onToast={onToast}
      />

    </div>
  );
}

