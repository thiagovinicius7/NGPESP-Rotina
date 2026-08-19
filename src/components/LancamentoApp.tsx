import React, { useState, useEffect, useCallback, useMemo } from "react";
import { AppState, Server, HistoryEntry, QueueServer, QueueOcorrencia } from "../types.js";
import { getLocalDateIso, toYmdDate } from "../lib/utils.js";
import { 
  Zap, CheckCheck, Copy, AlertOctagon, CornerUpLeft, Plus, Trash2, 
  ChevronLeft, ChevronRight, CheckSquare, ListTodo, MessageSquareQuote, 
  Search, ExternalLink, Moon, Sun, Droplet, Maximize2, Minimize2, 
  HelpCircle, RefreshCw, X, ArrowLeft, ArrowRight, Check, Sparkles,
  Layers, Bookmark, Share2, Download, Monitor, Laptop, BookmarkPlus,
  CheckCircle2, Cloud, UploadCloud
} from "lucide-react";

interface LancamentoAppProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  openModal?: (nome: string, mat: string, setor: string, onConfirm: (qtd: number) => void, defaultQtd?: number) => void;
  onSwitchToFullApp?: () => void;
  theme: 'claro' | 'escuro' | 'petroleo';
  setTheme: (t: 'claro' | 'escuro' | 'petroleo') => void;
  forceSync?: () => void;
  syncing?: boolean;
  cloudSynced?: boolean;
}

const normalizeMatricula = (m: any): string => {
  if (!m) return "";
  let clean = String(m).trim().replace(/[^a-zA-Z0-9]/g, "");
  if (/^\d+$/.test(clean) && clean.length > 0 && clean.length < 8) {
    clean = clean.padStart(8, "0");
  }
  return clean.toLowerCase();
};

const formatMatricula = (m: any): string => {
  if (!m) return "";
  let clean = String(m).trim().replace(/[^a-zA-Z0-9]/g, "");
  if (/^\d+$/.test(clean) && clean.length > 0 && clean.length < 8) {
    clean = clean.padStart(8, "0");
  }
  return clean;
};

const getOfficialServer = (mat: string, fallbackNome: string, servidores: Server[] = []): { matricula: string; nome: string } => {
  if (!mat && !fallbackNome) return { matricula: formatMatricula(mat) || "", nome: fallbackNome || "" };

  const normMat = normalizeMatricula(mat);
  if (normMat && servidores && servidores.length > 0) {
    const srvByMat = servidores.find(s => normalizeMatricula(s.matricula) === normMat);
    if (srvByMat) {
      return { matricula: formatMatricula(srvByMat.matricula), nome: srvByMat.nome };
    }
  }

  if (fallbackNome && servidores && servidores.length > 0) {
    const normNome = fallbackNome.trim().toLowerCase();
    const srvByName = servidores.find(s => s.nome && s.nome.trim().toLowerCase() === normNome);
    if (srvByName) {
      return { matricula: formatMatricula(srvByName.matricula), nome: srvByName.nome };
    }
  }

  return { matricula: formatMatricula(mat) || "", nome: fallbackNome || "" };
};

export default function LancamentoApp({
  state,
  updateState,
  onToast,
  openModal,
  onSwitchToFullApp,
  theme,
  setTheme,
  forceSync,
  syncing,
  cloudSynced
}: LancamentoAppProps) {
  // Drawer and Dialog states
  const [showPendenciasDrawer, setShowPendenciasDrawer] = useState(false);
  const [showRespostasDrawer, setShowRespostasDrawer] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSaveShortcutModal, setShowSaveShortcutModal] = useState(false);
  const [showQueueListDrawer, setShowQueueListDrawer] = useState(false);
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);

  // Listen for PWA beforeinstallprompt event
  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      onToast("Lançador SISREF instalado como aplicativo!", "ok");
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [onToast]);

  // Import State
  const [importTxt, setImportTxt] = useState("");
  const [importResultados, setImportResultados] = useState<QueueServer[]>([]);
  const [importSelected, setImportSelected] = useState<Record<number, boolean>>({});

  // Quick Answers state
  const [respBusca, setRespBusca] = useState("");
  const [respForm, setRespForm] = useState<{ idx: number; nome: string; texto: string } | null>(null);

  // Current Active Queue
  const activeQueueName = state.filaAvulsa?.ativa || "Padrão";
  const currentQueue = state.filaAvulsa?.listas?.[activeQueueName] || { fila: [], idx: 0 };
  const currentQueueServer = currentQueue.fila[currentQueue.idx];

  // Statistics calculation
  const totalServers = currentQueue.fila.length;
  const serversDone = Math.min(totalServers, currentQueue.idx);
  const remainingServers = Math.max(0, totalServers - currentQueue.idx);

  const totalLancamentos = useMemo(() => {
    return currentQueue.fila.reduce((sum, s) => sum + (s.ocorrencias?.length || 0), 0);
  }, [currentQueue.fila]);

  const lancamentosConcluidosPre = useMemo(() => {
    return currentQueue.fila.slice(0, currentQueue.idx).reduce((sum, s) => sum + (s.ocorrencias?.length || 0), 0);
  }, [currentQueue.fila, currentQueue.idx]);

  const lancamentosConcluidosCur = useMemo(() => {
    return currentQueueServer ? currentQueueServer.ocorrencias.filter(o => o.checked).length : 0;
  }, [currentQueueServer]);

  const lancamentosConcluidos = lancamentosConcluidosPre + lancamentosConcluidosCur;
  const remainingLancamentos = Math.max(0, totalLancamentos - lancamentosConcluidos);

  const progressoPct = totalServers > 0 
    ? Math.min(100, Math.round((currentQueue.idx / totalServers) * 100))
    : 0;

  const progressoLancamentosPct = totalLancamentos > 0 
    ? Math.min(100, Math.round((lancamentosConcluidos / totalLancamentos) * 100))
    : 0;

  // Copy Matrícula Helper
  const copiarMatricula = useCallback((mat: string) => {
    if (!mat) return;
    const formatted = formatMatricula(mat);
    navigator.clipboard.writeText(formatted);
    setCopiedRecently(true);
    setTimeout(() => setCopiedRecently(false), 1500);
    onToast(`Matrícula copiada: ${formatted}`, 'info');
  }, [onToast]);

  // Toggle single occurrence check
  const toggleOcorrenciaCheck = useCallback((ocIdx: number) => {
    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName];
      if (!q || !q.fila[q.idx]) return {};

      const nextFila = [...q.fila];
      const nextServer = { ...nextFila[q.idx] };
      const nextOcs = [...nextServer.ocorrencias];
      const isNowChecked = !nextOcs[ocIdx].checked;
      nextOcs[ocIdx] = { 
        ...nextOcs[ocIdx], 
        checked: isNowChecked,
        dataLancamento: isNowChecked ? new Date().toISOString() : undefined
      };
      nextServer.ocorrencias = nextOcs;
      nextFila[q.idx] = nextServer;

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { ...q, fila: nextFila }
          }
        }
      };
    });
  }, [updateState]);

  // Check or uncheck all occurrences for current server
  const toggleAllOccurrences = useCallback(() => {
    if (!currentQueueServer) return;
    const allChecked = currentQueueServer.ocorrencias.every(o => o.checked);
    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName];
      if (!q || !q.fila[q.idx]) return {};

      const nextFila = [...q.fila];
      const nextServer = { ...nextFila[q.idx] };
      const nowIso = new Date().toISOString();
      nextServer.ocorrencias = nextServer.ocorrencias.map(o => ({
        ...o,
        checked: !allChecked,
        dataLancamento: !allChecked ? (o.dataLancamento || nowIso) : undefined
      }));
      nextFila[q.idx] = nextServer;

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { ...q, fila: nextFila }
          }
        }
      };
    });
  }, [currentQueueServer, updateState]);

  // Confirm Server Launch
  const confirmarLancamento = useCallback(() => {
    if (!currentQueueServer) return;

    const official = getOfficialServer(currentQueueServer.matricula, currentQueueServer.nome, state.servidores);
    const checkedOcs = currentQueueServer.ocorrencias.filter(o => o.checked);
    const qtdCalculada = checkedOcs.length > 0 ? checkedOcs.length : 1;

    const applyConfirm = (qtd: number) => {
      updateState(prev => {
        const qName = prev.filaAvulsa?.ativa || "Padrão";
        const q = prev.filaAvulsa?.listas?.[qName];
        if (!q) return {};

        const nowIso = new Date().toISOString();

        const nextFila = [...q.fila];
        const serverIdx = q.idx;
        if (nextFila[serverIdx]) {
          const srv = { ...nextFila[serverIdx] };
          srv.nome = official.nome;
          srv.matricula = official.matricula;
          srv.ocorrencias = srv.ocorrencias.map(oc => oc.checked ? { ...oc, dataLancamento: oc.dataLancamento || nowIso } : oc);
          nextFila[serverIdx] = srv;
        }

        const newLog: HistoryEntry = {
          mat: official.matricula,
          nome: official.nome,
          setor: "Avulsa Fila",
          qtd: qtd,
          ts: nowIso,
          ocorrencias: checkedOcs.length > 0 ? checkedOcs.map(o => o.data ? `${o.tipo} (${o.data})` : o.tipo) : ["Lançamento Avulso"]
        };

        return {
          historico: [newLog, ...(prev.historico || [])].slice(0, 5000),
          filaAvulsa: {
            ...prev.filaAvulsa,
            listas: {
              ...prev.filaAvulsa.listas,
              [qName]: { ...q, fila: nextFila, idx: q.idx + 1 }
            }
          }
        };
      });

      onToast(`Lançamento de ${official.nome} confirmado!`, "ok");
    };

    if (openModal) {
      openModal(official.nome, official.matricula, "SISREF Avulsa", (qtd) => {
        applyConfirm(qtd);
      }, qtdCalculada);
    } else {
      applyConfirm(qtdCalculada);
    }
  }, [currentQueueServer, state.servidores, openModal, updateState, onToast]);

  // Mark as Pending
  const marcarPendente = useCallback(() => {
    if (!currentQueueServer) return;

    const official = getOfficialServer(currentQueueServer.matricula, currentQueueServer.nome, state.servidores);
    const motivo = prompt(`Por que não foi possível realizar o lançamento de ${official.nome}?`);
    if (!motivo || !motivo.trim()) return;

    const pendencia = {
      matricula: official.matricula,
      nome: official.nome,
      tipos: currentQueueServer.tipos || [],
      ocorrencias: currentQueueServer.ocorrencias || [],
      motivo: motivo.trim(),
      dataHora: new Date().toLocaleString("pt-BR")
    };

    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName];
      if (!q) return {};

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          pendencias: [pendencia, ...(prev.filaAvulsa?.pendencias || [])],
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { ...q, idx: q.idx + 1 }
          }
        }
      };
    });

    onToast(`Servidor ${official.nome} movido para pendências.`, "info");
  }, [currentQueueServer, state.servidores, updateState, onToast]);

  // Navigate back / forward in queue
  const navigateQueue = useCallback((delta: number) => {
    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName];
      if (!q) return {};

      const nextIdx = Math.max(0, Math.min(q.fila.length, q.idx + delta));
      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { ...q, idx: nextIdx }
          }
        }
      };
    });
  }, [updateState]);

  // Jump to specific index in queue
  const jumpToQueueIndex = useCallback((targetIdx: number) => {
    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName];
      if (!q) return {};

      const nextIdx = Math.max(0, Math.min(q.fila.length, targetIdx));
      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { ...q, idx: nextIdx }
          }
        }
      };
    });
    setShowQueueListDrawer(false);
  }, [updateState]);

  // Resolve Pending item
  const resolverPendencia = (idx: number) => {
    const p = state.filaAvulsa?.pendencias?.[idx];
    if (!p) return;

    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const q = prev.filaAvulsa?.listas?.[qName] || { fila: [], idx: 0 };
      
      const nextFila = [...q.fila];
      nextFila.splice(q.idx, 0, {
        matricula: p.matricula,
        nome: p.nome,
        tipos: p.tipos,
        ocorrencias: p.ocorrencias
      });

      const nextPendencias = (prev.filaAvulsa?.pendencias || []).filter((_, i) => i !== idx);

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          pendencias: nextPendencias,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: {
              fila: nextFila,
              idx: q.idx
            }
          }
        }
      };
    });

    onToast("Servidor reinserido na fila para lançamento!", "ok");
  };

  // Remove Pending item
  const removerPendencia = (idx: number) => {
    if (!confirm("Deseja realmente remover esta pendência?")) return;
    updateState(prev => ({
      filaAvulsa: {
        ...prev.filaAvulsa,
        pendencias: (prev.filaAvulsa?.pendencias || []).filter((_, i) => i !== idx)
      }
    }));
    onToast("Pendência removida.", "info");
  };

  // Clear / End active queue
  const encerrarFilaAtiva = () => {
    if (!confirm("Deseja realmente limpar e finalizar a fila de lançamentos ativa?")) return;
    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [qName]: { fila: [], idx: 0 }
          }
        }
      };
    });
    onToast("Fila de lançamentos encerrada.", "info");
  };

  // Create new queue
  const criarNovaFila = () => {
    const nome = prompt("Digite o nome da nova fila de lançamento:");
    if (!nome || !nome.trim()) return;
    const fmt = nome.trim();
    if (state.filaAvulsa?.listas?.[fmt]) {
      onToast("Fila com este nome já existe.", "err");
      return;
    }

    updateState(prev => ({
      filaAvulsa: {
        ...prev.filaAvulsa,
        ativa: fmt,
        listas: {
          ...prev.filaAvulsa.listas,
          [fmt]: { fila: [], idx: 0 }
        }
      }
    }));
    onToast(`Fila "${fmt}" criada com sucesso!`, "ok");
  };

  // Parse SISREF Text (Import)
  const parsearSisrefText = (txtToParse: string) => {
    const txt = txtToParse.trim();
    if (!txt) {
      onToast("Cole o texto copiado do SISREF.", "err");
      return;
    }

    const srvByMatMap = new Map<string, Server>();
    const srvByNameMap = new Map<string, Server>();
    (state.servidores || []).forEach(s => {
      if (s.matricula) {
        const nm = normalizeMatricula(s.matricula);
        if (nm) srvByMatMap.set(nm, s);
      }
      if (s.nome) {
        srvByNameMap.set(s.nome.trim().toLowerCase(), s);
      }
    });

    const cedidosNormSet = new Set((state.config?.matriculasCedidos || []).map(m => normalizeMatricula(m)).filter(Boolean));
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
      
      const tipoLimpo = tipo || "Atestado";

      if (!map[finalMatricula]) {
        map[finalMatricula] = { matricula: finalMatricula, nome: finalNome || `Servidor (${finalMatricula})`, tipos: [], ocorrencias: [] };
      } else if (officialServer) {
        map[finalMatricula].nome = officialServer.nome;
      }

      const matchPrevDate = idx > 0 ? (linhas[idx - 1].match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || linhas[idx - 1].match(/(\d{1,2}\/\d{2,4})/)) : null;
      const dataAnterior = matchPrevDate ? matchPrevDate[0] : "";
      map[finalMatricula].ocorrencias.push({
        tipo: tipoLimpo,
        data: data || dataAnterior,
        checked: false
      });

      if (!map[finalMatricula].tipos.includes(tipoLimpo)) {
        map[finalMatricula].tipos.push(tipoLimpo);
      }
    });

    const parsedArr = Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (parsedArr.length === 0) {
      onToast("Nenhum servidor ou ocorrência identificada no texto.", "err");
      return;
    }

    setImportResultados(parsedArr);
    const initialSel: Record<number, boolean> = {};
    parsedArr.forEach((_, i) => {
      initialSel[i] = true;
    });
    setImportSelected(initialSel);

    if (cedidosIgnoradosCount > 0) {
      onToast(`${parsedArr.length} servidores identificados (${cedidosIgnoradosCount} servidores cedidos ignorados)!`, "ok");
    } else {
      onToast(`${parsedArr.length} servidores identificados!`, "ok");
    }
  };

  // Append or Replace Queue with imported servers
  const aplicarImportacaoFila = (appendMode: boolean = false) => {
    const cedidosNormSet = new Set((state.config?.matriculasCedidos || []).map(m => normalizeMatricula(m)).filter(Boolean));
    const selectedServers = importResultados
      .filter((_, i) => importSelected[i])
      .filter(s => !cedidosNormSet.has(normalizeMatricula(s.matricula)))
      .map(s => {
        const official = getOfficialServer(s.matricula, s.nome, state.servidores);
        return {
          ...s,
          matricula: official.matricula,
          nome: official.nome
        };
      });

    if (selectedServers.length === 0) {
      onToast("Selecione pelo menos um servidor para adicionar à fila.", "err");
      return;
    }

    updateState(prev => {
      const qName = prev.filaAvulsa?.ativa || "Padrão";
      const existingQueue = prev.filaAvulsa?.listas?.[qName] || { fila: [], idx: 0 };
      
      const newFila = appendMode ? [...existingQueue.fila, ...selectedServers] : selectedServers;
      const newIdx = appendMode ? existingQueue.idx : 0;

      const updatedListas = { ...(prev.filaAvulsa?.listas || {}) };
      updatedListas[qName] = {
        fila: newFila,
        idx: newIdx
      };

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: updatedListas
        }
      };
    });

    setImportResultados([]);
    setImportTxt("");
    setShowImportModal(false);
    onToast(`${selectedServers.length} servidores ${appendMode ? 'anexados à' : 'carregados na'} fila ativa!`, "ok");
  };

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return; // do not hijack inputs
      }

      if (e.key === 'c' || e.key === 'C') {
        if (currentQueueServer) {
          e.preventDefault();
          copiarMatricula(currentQueueServer.matricula);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (currentQueueServer) {
          e.preventDefault();
          confirmarLancamento();
        }
      } else if (e.key === 'p' || e.key === 'P') {
        if (currentQueueServer) {
          e.preventDefault();
          marcarPendente();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        navigateQueue(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        navigateQueue(-1);
      } else if (e.key === 'a' || e.key === 'A') {
        if (currentQueueServer) {
          e.preventDefault();
          toggleAllOccurrences();
        }
      } else if (e.key >= '1' && e.key <= '9') {
        const num = parseInt(e.key, 10) - 1;
        if (currentQueueServer && currentQueueServer.ocorrencias[num]) {
          e.preventDefault();
          toggleOcorrenciaCheck(num);
        }
      } else if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQueueServer, copiarMatricula, confirmarLancamento, marcarPendente, navigateQueue, toggleAllOccurrences, toggleOcorrenciaCheck]);

  // Fullscreen toggle helper
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Copy app link / shortcut
  const copiarLinkAtalho = () => {
    const origin = window.location.origin + window.location.pathname;
    const url = `${origin}?app=lancamento`;
    navigator.clipboard.writeText(url);
    onToast("Link do App de Lançamento copiado com sucesso!", "ok");
  };

  // Download Windows / Desktop .URL Internet Shortcut
  const baixarAtalhoAreaDeTrabalho = () => {
    try {
      const origin = window.location.origin + window.location.pathname;
      const fullUrl = `${origin}?app=lancamento`;
      
      // Standard Windows .URL Internet Shortcut format
      const shortcutContent = [
        "[InternetShortcut]",
        `URL=${fullUrl}`,
        "IconIndex=0",
        "HotKey=0",
        "IDList=",
        "[{000214A0-0000-0000-C000-000000000046}]",
        "Prop3=19,11",
        ""
      ].join("\r\n");
      
      const blob = new Blob([shortcutContent], { type: "application/internet-shortcut;charset=utf-8" });
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = "Lançador SISREF - NGPESP.url";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadLink.href);

      onToast("Arquivo de atalho baixado! Arraste-o para sua Área de Trabalho.", "ok");
    } catch (err) {
      console.error("Erro ao gerar atalho:", err);
      onToast("Não foi possível gerar o download direto. Use a opção de copiar o link.", "err");
    }
  };

  // Trigger PWA native prompt or guide
  const acionarInstalacaoPwa = async () => {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        if (choiceResult.outcome === "accepted") {
          onToast("Aplicativo instalado com sucesso!", "ok");
          setDeferredInstallPrompt(null);
          setShowSaveShortcutModal(false);
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      onToast("No Google Chrome ou Edge, clique no ícone de instalar na barra de endereços ou no menu ⋮ > Criar atalho.", "info");
    }
  };

  // Open in popup window
  const abrirEmJanelaDedicada = () => {
    const origin = window.location.origin + window.location.pathname;
    const url = `${origin}?app=lancamento`;
    window.open(url, "LancadorSisrefApp", "width=1180,height=840,menubar=no,toolbar=no,location=no,status=no");
  };

  const officialServer = currentQueueServer 
    ? getOfficialServer(currentQueueServer.matricula, currentQueueServer.nome, state.servidores)
    : null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col font-sans transition-colors duration-200">
      {/* APP TOP BAR */}
      <header className="bg-[var(--surface)] border-b border-[var(--border)] sticky top-0 z-30 px-4 py-2.5 shadow-2xs backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          {/* Logo & Queue Switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Zap size={18} className="fill-current" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="font-black text-sm tracking-tight text-[var(--text)]">Lançador SISREF</h1>
                  <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase tracking-wide">
                    Modo Focado
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text2)] font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                  Sincronização Ativa em Tempo Real
                </div>
              </div>
            </div>

            {/* Queue Selector */}
            <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-3 border-l border-[var(--border2)]">
              <span className="text-[11px] font-bold text-[var(--text2)] uppercase">Fila:</span>
              <select
                value={activeQueueName}
                onChange={(e) => updateState(prev => ({ filaAvulsa: { ...prev.filaAvulsa, ativa: e.target.value } }))}
                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border2)] text-[var(--text)] outline-none cursor-pointer"
              >
                {Object.keys(state.filaAvulsa?.listas || { "Padrão": true }).map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={criarNovaFila}
                className="p-1 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-md transition-colors"
                title="Nova Fila"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Queue list inspector toggle */}
            <button
              type="button"
              onClick={() => setShowQueueListDrawer(true)}
              className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--bg)] hover:bg-[var(--border2)] text-[var(--text)] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Ver lista de servidores na fila"
            >
              <ListTodo size={14} className="text-blue-500" />
              <span>Lista ({totalServers})</span>
            </button>

            {/* Pendências Button */}
            <button
              type="button"
              onClick={() => setShowPendenciasDrawer(true)}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer ${
                (state.filaAvulsa?.pendencias || []).length > 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  : 'border-[var(--border2)] bg-[var(--bg)] text-[var(--text2)]'
              }`}
              title="Gerenciar servidores pendentes"
            >
              <AlertOctagon size={14} />
              <span>Pendências ({(state.filaAvulsa?.pendencias || []).length})</span>
            </button>

            {/* Quick Answers Button */}
            <button
              type="button"
              onClick={() => setShowRespostasDrawer(true)}
              className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--bg)] hover:bg-[var(--border2)] text-[var(--text)] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Respostas Rápidas"
            >
              <MessageSquareQuote size={14} className="text-indigo-500" />
              <span className="hidden md:inline">Respostas</span>
            </button>

            {/* Import / Paste Button */}
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Colar texto de novas pendências do SISREF"
            >
              <Plus size={14} />
              <span>Importar</span>
            </button>

            {/* Salvar Atalho na Área de Trabalho Button */}
            <button
              type="button"
              onClick={() => setShowSaveShortcutModal(true)}
              className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white flex items-center gap-1.5 shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
              title="Salvar atalho com ícone na Área de Trabalho"
            >
              <Download size={14} className="text-emerald-200" />
              <span className="hidden sm:inline">Salvar Atalho</span>
              <span className="sm:hidden">Salvar</span>
            </button>

            {/* Cloud Sync Status / Button */}
            {forceSync && (
              <button
                type="button"
                onClick={forceSync}
                disabled={syncing}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold ${
                  syncing 
                    ? "text-blue-500 bg-blue-500/10 animate-spin" 
                    : cloudSynced 
                    ? "text-emerald-500 hover:bg-emerald-500/10" 
                    : "text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)]"
                }`}
                title={syncing ? "Sincronizando com a Nuvem..." : "Sincronizado com todos os dispositivos na Nuvem (Clique para forçar atualização)"}
              >
                <Cloud size={16} />
              </button>
            )}

            {/* Shortcuts Help */}
            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-lg transition-colors cursor-pointer"
              title="Atalhos de Teclado (?)"
            >
              <HelpCircle size={16} />
            </button>

            {/* Open in Popup / Share */}
            <button
              type="button"
              onClick={() => setShowSaveShortcutModal(true)}
              className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-lg transition-colors cursor-pointer"
              title="Opções de Atalho e Compartilhamento"
            >
              <BookmarkPlus size={16} />
            </button>

            <button
              type="button"
              onClick={abrirEmJanelaDedicada}
              className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-lg transition-colors cursor-pointer hidden sm:inline-flex"
              title="Abrir em Janela Pop-up Dedicada"
            >
              <ExternalLink size={16} />
            </button>

            {/* Theme Toggle */}
            <div className="flex items-center border-l border-[var(--border2)] pl-1.5 ml-1">
              <button
                type="button"
                onClick={() => setTheme(theme === 'claro' ? 'escuro' : theme === 'escuro' ? 'petroleo' : 'claro')}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-lg transition-colors cursor-pointer"
                title={`Tema: ${theme}`}
              >
                {theme === 'claro' && <Sun size={16} />}
                {theme === 'escuro' && <Moon size={16} />}
                {theme === 'petroleo' && <Droplet size={16} />}
              </button>
            </div>

            {/* Switch to Full Main App */}
            {onSwitchToFullApp && (
              <button
                type="button"
                onClick={onSwitchToFullApp}
                className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] flex items-center gap-1 transition-colors cursor-pointer ml-1"
                title="Voltar ao Painel Completo"
              >
                <Layers size={13} />
                <span className="hidden lg:inline">Painel Completo</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* REAL-TIME LIVE STATISTICS DASHBOARD */}
      <section className="bg-[var(--surface)] border-b border-[var(--border)] px-4 py-3 shadow-2xs">
        <div className="max-w-7xl mx-auto">
          {/* Progress Bar with Live Stats Header */}
          <div className="flex items-center justify-between gap-4 mb-2 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <span className="font-black text-[var(--text)] uppercase tracking-wider text-[11px]">Progresso da Fila:</span>
              <span className="font-mono font-black text-blue-600 dark:text-blue-400 text-sm">
                {progressoPct}%
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-semibold text-[var(--text2)] flex-wrap">
              <div>
                <span className="text-[var(--text)] font-bold">{serversDone}</span> de <span className="text-[var(--text)] font-bold">{totalServers}</span> servidores ({remainingServers} restantes)
              </div>
              <div className="hidden sm:inline">·</div>
              <div>
                <span className="text-[var(--text)] font-bold">{lancamentosConcluidos}</span> de <span className="text-[var(--text)] font-bold">{totalLancamentos}</span> lançamentos ({remainingLancamentos} restantes)
              </div>
            </div>
          </div>

          {/* Smooth High-Contrast Progress Bar */}
          <div className="w-full bg-[var(--border2)] h-2 rounded-full overflow-hidden relative">
            <div 
              className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressoPct}%` }}
            />
          </div>

          {/* 4 Micro KPI Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border2)] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider">Servidores Faltando</div>
                <div className="text-base font-mono font-black text-[var(--text)] mt-0.5">{remainingServers}</div>
              </div>
              <div className="text-[10px] font-bold text-[var(--text2)] text-right">
                de {totalServers} total
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border2)] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider">Lançamentos Faltando</div>
                <div className="text-base font-mono font-black text-amber-600 dark:text-amber-400 mt-0.5">{remainingLancamentos}</div>
              </div>
              <div className="text-[10px] font-bold text-[var(--text2)] text-right">
                de {totalLancamentos} total
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border2)] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider">Concluídos na Fila</div>
                <div className="text-base font-mono font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{serversDone}</div>
              </div>
              <div className="text-[10px] font-bold text-emerald-600 text-right">
                {progressoPct}%
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border2)] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider">Pendências Ativas</div>
                <div className="text-base font-mono font-black text-red-500 mt-0.5">{(state.filaAvulsa?.pendencias || []).length}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowPendenciasDrawer(true)}
                className="text-[10px] font-bold text-blue-500 hover:underline cursor-pointer"
              >
                Ver
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN LAUNCH CANVAS */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-center">
        {totalServers === 0 ? (
          /* EMPTY QUEUE STATE -> PROMPT TO PASTE SISREF */
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 shadow-sm text-center max-w-2xl mx-auto w-full my-auto">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4">
              <Zap size={32} />
            </div>
            <h2 className="text-xl font-bold text-[var(--text)] mb-2">Fila de Lançamento Vazia</h2>
            <p className="text-xs text-[var(--text2)] mb-6 max-w-md mx-auto leading-relaxed">
              Cole o relatório copiado do SISREF para gerar imediatamente a fila de conferência ultra-rápida. Servidores cedidos serão ignorados automaticamente.
            </p>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl inline-flex items-center gap-2 shadow-sm cursor-pointer transition-all hover:scale-[1.02]"
            >
              <Plus size={18} /> Colar e Iniciar Lançamento
            </button>
          </div>
        ) : currentQueue.idx >= totalServers ? (
          /* COMPLETED QUEUE STATE */
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 sm:p-12 shadow-sm text-center max-w-2xl mx-auto w-full my-auto">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4 ring-8 ring-emerald-500/5">
              <CheckCheck size={40} />
            </div>
            <h2 className="text-2xl font-black text-[var(--text)] mb-2">Fila de Lançamento Concluída!</h2>
            <p className="text-sm text-[var(--text2)] mb-6 leading-relaxed">
              Todos os <strong>{totalServers} servidores</strong> e <strong>{totalLancamentos} ocorrências</strong> desta fila foram processados com sucesso.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => jumpToQueueIndex(0)}
                className="px-4 py-2.5 bg-[var(--bg)] border border-[var(--border2)] text-[var(--text)] font-bold text-xs rounded-xl hover:bg-[var(--border2)] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft size={14} /> Rever Fila do Início
              </button>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Plus size={14} /> Iniciar Nova Fila
              </button>
              <button
                type="button"
                onClick={encerrarFilaAtiva}
                className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/20 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 size={14} /> Limpar Fila
              </button>
            </div>
          </div>
        ) : (
          /* ACTIVE SERVER LAUNCH CARD (HERO FOCUS WORKSPACE) */
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden flex flex-col my-auto transition-all">
            {/* Card Header & Position */}
            <div className="p-4 sm:p-5 border-b border-[var(--border2)] bg-[var(--bg)]/50 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-black text-xs">
                  {currentQueue.idx + 1} / {totalServers}
                </span>
                <span className="text-xs font-bold text-[var(--text2)]">
                  Fila: <strong>{activeQueueName}</strong>
                </span>
              </div>

              {/* Navigation Arrows */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentQueue.idx === 0}
                  onClick={() => navigateQueue(-1)}
                  className="p-1.5 rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Servidor Anterior (Seta Esquerda ou K)"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  disabled={currentQueue.idx >= totalServers - 1}
                  onClick={() => navigateQueue(1)}
                  className="p-1.5 rounded-lg border border-[var(--border2)] bg-[var(--surface)] text-[var(--text2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Próximo Servidor (Seta Direita ou J)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Server Details & Matrícula Hero Section */}
            <div className="p-5 sm:p-7 border-b border-[var(--border2)]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Name and Official Info */}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black text-[var(--blue-mid)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Sparkles size={13} /> Servidor Selecionado
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-[var(--text)] tracking-tight truncate" title={officialServer?.nome}>
                    {officialServer?.nome || "Servidor"}
                  </h3>
                  {officialServer && (
                    <div className="text-xs font-semibold text-[var(--text2)] mt-1 flex items-center gap-2 flex-wrap">
                      <span>{currentQueueServer.ocorrencias.length} ocorrência(s) na fila</span>
                      {currentQueueServer.tipos.length > 0 && (
                        <span>· {currentQueueServer.tipos.join(' · ')}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Big Copyable Matrícula Pill */}
                <div className="flex items-center gap-2 flex-shrink-0 self-start md:self-auto">
                  <div 
                    onClick={() => officialServer && copiarMatricula(officialServer.matricula)}
                    className="p-3 sm:px-4 sm:py-3 bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-500/40 hover:border-blue-600 rounded-xl flex items-center gap-3 cursor-pointer transition-all shadow-xs group"
                    title="Clique ou pressione 'C' para copiar a matrícula"
                  >
                    <div>
                      <div className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Matrícula (C)</div>
                      <div className="text-lg sm:text-xl font-mono font-black text-blue-700 dark:text-blue-300">
                        {officialServer?.matricula || "—"}
                      </div>
                    </div>
                    <div className={`p-2 rounded-lg ${copiedRecently ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white group-hover:scale-105'} transition-all`}>
                      {copiedRecently ? <Check size={16} /> : <Copy size={16} />}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Occurrences Checklist Matrix */}
            <div className="p-5 sm:p-7 bg-[var(--bg)]/30 flex-1">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                  <CheckSquare size={14} className="text-blue-500" />
                  Ocorrências / Atestados ({currentQueueServer.ocorrencias.filter(o => o.checked).length} de {currentQueueServer.ocorrencias.length} marcados)
                </div>
                <button
                  type="button"
                  onClick={toggleAllOccurrences}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  {currentQueueServer.ocorrencias.every(o => o.checked) ? "Desmarcar Todos (A)" : "Marcar Todos (A)"}
                </button>
              </div>

              {/* Checkboxes Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {currentQueueServer.ocorrencias.map((oc, i) => {
                  const isChecked = !!oc.checked;
                  return (
                    <label
                      key={i}
                      className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all select-none ${
                        isChecked 
                          ? 'bg-blue-500/10 border-blue-500/40 text-[var(--text)] shadow-2xs' 
                          : 'bg-[var(--surface)] border-[var(--border2)] hover:border-[var(--border)] text-[var(--text2)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOcorrenciaCheck(i)}
                        className="w-5 h-5 rounded mt-0.5 cursor-pointer accent-blue-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-black truncate ${isChecked ? 'text-[var(--text)]' : 'text-[var(--text2)]'}`}>
                            {oc.tipo}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-[var(--text2)] opacity-70">
                            [{i + 1}]
                          </span>
                        </div>
                        {oc.data ? (
                          <div className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 mt-1">
                            Fato Gerador: {oc.data}
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                            Sem data especificada
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons Bar */}
            <div className="p-4 sm:p-5 bg-[var(--surface)] border-t border-[var(--border2)] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={marcarPendente}
                  className="flex-1 sm:flex-initial px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  title="Marcar Servidor com Pendência (P)"
                >
                  <AlertOctagon size={16} />
                  <span>Pendente (P)</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateQueue(1)}
                  className="px-3 py-3 rounded-xl border border-[var(--border2)] bg-[var(--bg)] hover:bg-[var(--border2)] text-[var(--text2)] font-bold text-xs transition-colors cursor-pointer"
                  title="Pular para próximo servidor sem registrar"
                >
                  Pular
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={confirmarLancamento}
                  className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.02] cursor-pointer"
                  title="Confirmar Lançamento (Enter ou Espaço)"
                >
                  <CheckCheck size={18} />
                  <span>Confirmar Lançamento (Enter)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* QUICK FLOATING SHORTCUTS PILL */}
      <footer className="p-2 bg-[var(--surface)] border-t border-[var(--border)] text-center text-[11px] text-[var(--text2)] font-semibold hidden md:block">
        <div className="max-w-5xl mx-auto flex items-center justify-center gap-6">
          <span><kbd className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded font-mono text-[10px]">C</kbd> Copiar Matrícula</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded font-mono text-[10px]">Enter</kbd> Confirmar</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded font-mono text-[10px]">P</kbd> Pendente</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded font-mono text-[10px]">A</kbd> Marcar Todos</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border2)] rounded font-mono text-[10px]">← / →</kbd> Navegar</span>
        </div>
      </footer>

      {/* 1. MODAL DE IMPORTAÇÃO / COLAR SISREF */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                  <ListTodo size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text)]">Importar Fila do SISREF</h3>
                  <p className="text-xs text-[var(--text2)]">Cole as pendências do SISREF para gerar a fila</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-1.5">
                Conteúdo Copiado do SISREF:
              </label>
              <textarea
                rows={6}
                value={importTxt}
                onChange={(e) => setImportTxt(e.target.value)}
                placeholder="Cole aqui o texto copiado do SISREF..."
                className="w-full p-3 font-mono text-xs rounded-xl border border-[var(--border2)] bg-[var(--bg)] outline-none text-[var(--text)] focus:border-blue-500 resize-y"
              />
            </div>

            <div className="flex justify-end gap-2 mb-4">
              <button
                type="button"
                onClick={() => parsearSisrefText(importTxt)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Zap size={14} /> Analisar Texto
              </button>
            </div>

            {/* Parsed Checklist Area */}
            {importResultados.length > 0 && (
              <div className="border border-[var(--border2)] rounded-xl overflow-hidden mb-4">
                <div className="p-3 bg-[var(--bg)] border-b border-[var(--border2)] flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text)]">
                    {importResultados.length} Servidores Identificados
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const allChecked = importResultados.every((_, i) => importSelected[i]);
                      const next: Record<number, boolean> = {};
                      importResultados.forEach((_, i) => { next[i] = !allChecked; });
                      setImportSelected(next);
                    }}
                    className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    Alternar Todos
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border2)]">
                  {importResultados.map((r, i) => (
                    <label
                      key={i}
                      className="p-3 flex items-center gap-3 hover:bg-[var(--bg)]/50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={!!importSelected[i]}
                        onChange={() => setImportSelected(prev => ({ ...prev, [i]: !prev[i] }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="font-mono font-bold text-[var(--text2)] min-w-[70px]">{formatMatricula(r.matricula)}</span>
                      <span className="font-bold text-[var(--text)] flex-1 truncate">{r.nome}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded">
                        {r.ocorrencias.length} oc.
                      </span>
                    </label>
                  ))}
                </div>

                <div className="p-3 bg-[var(--bg)] border-t border-[var(--border2)] flex gap-2">
                  <button
                    type="button"
                    onClick={() => aplicarImportacaoFila(false)}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
                  >
                    Substituir Fila Ativa
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarImportacaoFila(true)}
                    className="flex-1 py-2.5 bg-[var(--surface)] border border-[var(--border2)] hover:bg-[var(--bg)] text-[var(--text)] font-bold text-xs rounded-xl cursor-pointer"
                  >
                    Anexar à Fila Existente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. DRAWER DE PENDÊNCIAS */}
      {showPendenciasDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[var(--surface)] border-l border-[var(--border)] w-full max-w-md h-full flex flex-col p-6 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border2)]">
              <div className="flex items-center gap-2">
                <AlertOctagon size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">
                  Servidores Pendentes ({(state.filaAvulsa?.pendencias || []).length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPendenciasDrawer(false)}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border2)] pr-1">
              {(state.filaAvulsa?.pendencias || []).length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text2)]">
                  Nenhuma pendência registrada no momento.
                </div>
              ) : (
                state.filaAvulsa?.pendencias?.map((p, idx) => (
                  <div key={idx} className="py-3.5 flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-[var(--text)]">{p.nome}</div>
                        <div className="font-mono text-[10px] text-[var(--text2)]">{formatMatricula(p.matricula)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => resolverPendencia(idx)}
                          className="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-[10px] rounded-lg hover:bg-blue-500/20 flex items-center gap-1 cursor-pointer"
                          title="Reinserir na fila para lançamento"
                        >
                          <CornerUpLeft size={11} /> Reinserir
                        </button>
                        <button
                          type="button"
                          onClick={() => removerPendencia(idx)}
                          className="p-1 text-gray-400 hover:text-red-500 rounded cursor-pointer"
                          title="Excluir"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold italic">
                      Motivo: {p.motivo}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. DRAWER DE RESPOSTAS RÁPIDAS */}
      {showRespostasDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[var(--surface)] border-l border-[var(--border)] w-full max-w-md h-full flex flex-col p-6 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border2)]">
              <div className="flex items-center gap-2">
                <MessageSquareQuote size={18} className="text-indigo-500" />
                <h3 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">
                  Respostas Rápidas
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRespostasDrawer(false)}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
              <input
                type="text"
                placeholder="Buscar respostas..."
                value={respBusca}
                onChange={(e) => setRespBusca(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border2)] bg-[var(--bg)] outline-none text-[var(--text)]"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border2)] pr-1">
              {(state.respostas || [])
                .filter(r => r.nome.toLowerCase().includes(respBusca.toLowerCase()) || r.texto.toLowerCase().includes(respBusca.toLowerCase()))
                .map((r, i) => (
                  <div key={i} className="py-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-xs text-[var(--text)]">{r.nome}</div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(r.texto);
                          onToast(`Resposta "${r.nome}" copiada!`, "ok");
                        }}
                        className="px-2 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 rounded font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={11} /> Copiar
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text2)] line-clamp-3 leading-relaxed">
                      {r.texto}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. DRAWER DA LISTA COMPLETA DA FILA */}
      {showQueueListDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[var(--surface)] border-l border-[var(--border)] w-full max-w-md h-full flex flex-col p-6 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border2)]">
              <div className="flex items-center gap-2">
                <ListTodo size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">
                  Servidores na Fila ({totalServers})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowQueueListDrawer(false)}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border2)] pr-1">
              {currentQueue.fila.map((s, i) => {
                const isDone = i < currentQueue.idx;
                const isCurrent = i === currentQueue.idx;
                return (
                  <div
                    key={i}
                    onClick={() => jumpToQueueIndex(i)}
                    className={`p-3 flex items-center justify-between gap-3 cursor-pointer rounded-xl transition-all ${
                      isCurrent 
                        ? 'bg-blue-500/10 border border-blue-500/40 text-[var(--text)]' 
                        : isDone 
                          ? 'opacity-60 hover:opacity-100 hover:bg-[var(--bg)]' 
                          : 'hover:bg-[var(--bg)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-[var(--text2)] w-5 text-center">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-[var(--text)] truncate">{s.nome}</div>
                        <div className="font-mono text-[10px] text-[var(--text2)]">{formatMatricula(s.matricula)} · {s.ocorrencias.length} oc.</div>
                      </div>
                    </div>
                    <div>
                      {isDone ? (
                        <CheckCheck size={16} className="text-emerald-500" />
                      ) : isCurrent ? (
                        <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-[9px] font-black uppercase">Atual</span>
                      ) : (
                        <span className="text-[10px] text-[var(--text2)]">Pendente</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL DE ATALHOS DE TECLADO */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Atalhos de Alta Velocidade</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="p-1 text-[var(--text2)] hover:text-[var(--text)] rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Copiar Matrícula</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">C</kbd>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Confirmar Lançamento</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">Enter / Espaço</kbd>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Marcar Pendente</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">P</kbd>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Marcar / Desmarcar Todos</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">A</kbd>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Próximo / Anterior</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">← / → ou J / K</kbd>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-[var(--bg)] border border-[var(--border2)]">
                <span className="font-semibold text-[var(--text)]">Alternar Ocorrência 1 a 9</span>
                <kbd className="font-mono font-bold px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">1, 2, 3...</kbd>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL DE SALVAR ATALHO NA ÁREA DE TRABALHO / INSTALAR APP */}
      {showSaveShortcutModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
                  <Zap size={22} className="fill-current text-amber-300" />
                </div>
                <div>
                  <h3 className="text-base font-black text-[var(--text)] tracking-tight">
                    Salvar Atalho na Área de Trabalho
                  </h3>
                  <p className="text-xs text-[var(--text2)] font-medium">
                    Acesso direto ao Lançador SISREF com 1 clique
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSaveShortcutModal(false)}
                className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-xl transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Methods Cards */}
            <div className="mt-5 space-y-4">
              {/* Option 1: Direct .URL File Download */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/30 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                      <Download size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Opção 1 (Recomendada para Windows)
                      </div>
                      <div className="text-sm font-bold text-[var(--text)]">
                        Baixar Atalho para a Área de Trabalho (.url)
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white uppercase tracking-wider">
                    1 Clique
                  </span>
                </div>
                <p className="text-xs text-[var(--text2)] leading-relaxed">
                  Baixa um arquivo de atalho da web com o nome <strong>"Lançador SISREF - NGPESP"</strong>. Basta salvá-lo ou arrastá-lo diretamente para a sua Área de Trabalho!
                </p>
                <button
                  type="button"
                  onClick={() => {
                    baixarAtalhoAreaDeTrabalho();
                  }}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer hover:scale-[1.01]"
                >
                  <Download size={16} />
                  <span>Baixar Atalho .url Agora</span>
                </button>
              </div>

              {/* Option 2: Browser PWA App Install */}
              <div className="p-4 rounded-2xl bg-[var(--bg)]/40 border border-[var(--border2)] flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      <Monitor size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                        Opção 2 (Instalação como Aplicativo)
                      </div>
                      <div className="text-sm font-bold text-[var(--text)]">
                        Instalar no Navegador (Chrome / Edge)
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--text2)] leading-relaxed">
                  Cria um aplicativo dedicado sem barras de navegador, com ícone azul e amarelo personalizado na barra de tarefas e no menu Iniciar.
                </p>
                {deferredInstallPrompt ? (
                  <button
                    type="button"
                    onClick={acionarInstalacaoPwa}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <Zap size={16} className="fill-current text-amber-300" />
                    <span>Instalar Aplicativo Agora</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text2)] space-y-1.5">
                    <div className="font-bold text-[var(--text)] flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-blue-500" />
                      Como instalar manualmente pelo Chrome ou Edge:
                    </div>
                    <ol className="list-decimal list-inside space-y-1 pl-1 text-[11px]">
                      <li>No menu superior do navegador, clique em <strong>⋮ (três pontinhos)</strong>.</li>
                      <li>Vá em <strong>Salvar e Compartilhar</strong> &gt; <strong>Criar atalho...</strong> (ou <em>Instalar Lançador</em>).</li>
                      <li>Marque a opção <strong>"Abrir como janela"</strong> e clique em <strong>Criar</strong>.</li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Option 3: Copy direct link */}
              <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--text)]">Link Direto do Lançador</div>
                  <div className="text-[11px] font-mono text-[var(--text2)] truncate mt-0.5">
                    {window.location.origin + window.location.pathname}?app=lancamento
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copiarLinkAtalho}
                  className="py-2 px-3 bg-[var(--bg)] hover:bg-[var(--border2)] border border-[var(--border2)] text-[var(--text)] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer flex-shrink-0"
                >
                  <Copy size={14} />
                  <span>Copiar Link</span>
                </button>
              </div>

              {/* Option 4: Multi-Device Cloud Sync */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-blue-500/5 to-transparent border border-indigo-500/30 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                      <Cloud size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        Sincronização Automática
                      </div>
                      <div className="text-sm font-bold text-[var(--text)]">
                        Multi-Dispositivo em Tempo Real
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-600 text-white uppercase tracking-wider">
                    Automático
                  </span>
                </div>
                <p className="text-xs text-[var(--text2)] leading-relaxed">
                  Todas as suas listas de fila avulsa, servidores e progresso são sincronizados automaticamente na nuvem Firestore. Ao abrir o aplicativo em qualquer computador, celular ou aba, a fila é carregada imediatamente.
                </p>
                {forceSync && (
                  <button
                    type="button"
                    onClick={() => {
                      forceSync();
                    }}
                    disabled={syncing}
                    className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                  >
                    <UploadCloud size={15} />
                    <span>{syncing ? "Sincronizando com a Nuvem..." : "Sincronizar Filas com a Nuvem Agora"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSaveShortcutModal(false)}
                className="px-5 py-2.5 bg-[var(--border2)] hover:bg-[var(--border)] text-[var(--text)] font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
