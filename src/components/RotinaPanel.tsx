import React, { useState, useEffect } from "react";
import { AppState, Server, SeiProcess, Absence, AtividadeLancamento, ProdutividadeDia } from "../types.js";
import { 
  UploadCloud, Contact, TrendingUp, Server as ServerIcon, 
  Trash2, DownloadCloud, ClipboardPaste, BellRing, FolderOpen, 
  Palmtree, CalendarCheck, Stethoscope, Save, Settings2, Plus, 
  X, Check, Sunrise, Sunset, History, Calendar, FileText, 
  ArrowRight, Edit, AlertTriangle, AlertCircle, CheckCircle,
  Database, RefreshCw, Key, Search, Link as LinkIcon, ExternalLink, Unlink, UserX,
  Cloud, FileDown, FileUp, Star
} from "lucide-react";
import ProdutividadePanel from "./ProdutividadePanel.js";
import VidaFuncionalPanel from "./VidaFuncionalPanel.js";
import ModalCasosEspeciais from "./ModalCasosEspeciais.js";
import { getSnapshotsFromIDB } from "../lib/idbStorage.js";
import { getLocalDateIso, toYmdDate, mergeProdutividade, reconstructProdutividadeFromState, mergeFilaAvulsa } from "../lib/utils.js";

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

interface RotinaPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  forceSync: () => Promise<void>;
  syncing: boolean;
  subTab?: 'importar' | 'vida' | 'produtividade';
  setSubTab?: (t: 'importar' | 'vida' | 'produtividade') => void;
  forcePushThisDeviceToCloud?: () => Promise<void>;
  forcePullFromCloud?: () => Promise<void>;
  exportBackupJson?: () => void;
  importBackupJson?: (file: File) => void;
  prodDataInicial?: string;
}

export default function RotinaPanel({ 
  state, 
  updateState, 
  onToast, 
  forceSync, 
  syncing,
  subTab: controlledSubTab,
  setSubTab: setControlledSubTab,
  forcePushThisDeviceToCloud,
  forcePullFromCloud,
  exportBackupJson,
  importBackupJson,
  prodDataInicial
}: RotinaPanelProps) {
  const [localSubTab, setLocalSubTab] = useState<'importar' | 'vida' | 'produtividade'>('importar');

  const subTab = controlledSubTab !== undefined ? controlledSubTab : localSubTab;
  const setSubTab = setControlledSubTab !== undefined ? setControlledSubTab : setLocalSubTab;

  // Importador de dados
  const [tsvText, setTsvText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [importType, setImportType] = useState<'servidores' | 'respostas' | 'faq' | 'filaAvulsa' | 'produtividade' | 'balcaoAtendimentos' | 'afastamentos'>('servidores');

  // Passcode settings state
  const [newPassword, setNewPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleUpdatePassword = () => {
    if (!newPassword.trim()) {
      onToast("A senha não pode estar em branco.", "err");
      return;
    }
    
    updateState(prev => ({
      config: {
        ...prev.config,
        appPassword: newPassword.trim()
      }
    }));
    
    onToast("Senha do sistema alterada com sucesso!", "ok");
    setNewPassword("");
  };

  // Servidores Cedidos / Ignorados state
  const [cedidosInput, setCedidosInput] = useState("");
  const [cedidosSearch, setCedidosSearch] = useState("");
  const [showCasosModal, setShowCasosModal] = useState(false);

  const handleAddCedidos = () => {
    if (!cedidosInput.trim()) {
      onToast("Digite ou cole ao menos uma matrícula.", "err");
      return;
    }

    const rawList = cedidosInput.split(/[\n,; \t]+/).map(s => s.trim()).filter(Boolean);
    const validMatriculas: string[] = [];

    rawList.forEach(item => {
      const formatted = formatMatricula(item);
      if (formatted) {
        validMatriculas.push(formatted);
      }
    });

    if (validMatriculas.length === 0) {
      onToast("Nenhuma matrícula válida identificada.", "err");
      return;
    }

    let addedCount = 0;

    updateState(prev => {
      const currentList = prev.config?.matriculasCedidos || [];
      const setNorm = new Set(currentList.map(m => normalizeMatricula(m)));
      const added: string[] = [];

      validMatriculas.forEach(mat => {
        const norm = normalizeMatricula(mat);
        if (norm && !setNorm.has(norm)) {
          setNorm.add(norm);
          added.push(mat);
        }
      });

      addedCount = added.length;

      if (added.length === 0) {
        return {};
      }

      return {
        config: {
          ...prev.config,
          matriculasCedidos: [...currentList, ...added]
        }
      };
    });

    if (addedCount > 0) {
      setCedidosInput("");
      onToast(`${addedCount} matrícula(s) de cedido adicionada(s) à lista!`, "ok");
    } else {
      onToast("As matrículas informadas já constam na lista de cedidos.", "info");
    }
  };

  const handleRemoveCedido = (mat: string) => {
    const norm = normalizeMatricula(mat);
    updateState(prev => ({
      config: {
        ...prev.config,
        matriculasCedidos: (prev.config?.matriculasCedidos || []).filter(m => normalizeMatricula(m) !== norm)
      }
    }));
    onToast(`Matrícula ${mat} removida da lista de cedidos.`, "info");
  };

  const handleClearCedidos = () => {
    if (confirm("Deseja realmente limpar toda a lista de servidores cedidos a ignorar?")) {
      updateState(prev => ({
        config: {
          ...prev.config,
          matriculasCedidos: []
        }
      }));
      onToast("Lista de servidores cedidos foi limpa.", "info");
    }
  };


  // Baixa a cópia automática mais recente guardada neste navegador (IndexedDB)
  const handleDownloadLatestLocalCopy = async () => {
    try {
      const snaps = await getSnapshotsFromIDB(1);
      const ultima: any = snaps[0];
      if (!ultima || !ultima.state) {
        onToast("Nenhuma cópia automática encontrada neste navegador.", "info");
        return;
      }
      const blob = new Blob([JSON.stringify(ultima.state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NGPESP_copia_automatica_${new Date(ultima.timestamp).toISOString().slice(0, 16).replace(":", "h")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToast(`Cópia de ${ultima.dateFormatted} baixada (${ultima.summary}).`, "ok");
    } catch (e: any) {
      onToast("Não foi possível ler a cópia automática: " + (e?.message || e), "err");
    }
  };

  // Vida Funcional
  const [seiForm, setSeiForm] = useState<{ idx: number; num: string; desc: string } | null>(null);
  const [afasForm, setAfasForm] = useState<{ idx: number; dia: string; mes: string; tipo: string; sisref: string } | null>(null);
  const [feriasAno, setFeriasAno] = useState(new Date().getFullYear().toString());
  const [abonosAno, setAbonosAno] = useState(new Date().getFullYear().toString());

  // Produtividade
  const [prodData, setProdData] = useState(getLocalDateIso());
  const [prodCfgOpen, setProdCfgOpen] = useState(false);
  const [cfgTipos, setCfgTipos] = useState("");
  const [cfgSistemas, setCfgSistemas] = useState("");
  const [histFiltroMes, setHistFiltroMes] = useState(getLocalDateIso().slice(0, 7));
  const [expandedHistDia, setExpandedHistDia] = useState<string | null>(null);

  // GMOV dates renewal computation
  const getGMOVAlert = () => {
    if (!state.config.gmov_data) return null;
    const start = new Date(state.config.gmov_data + "T12:00:00");
    const next = new Date(start);
    next.setMonth(next.getMonth() + 12);
    const today = new Date();
    const diffTime = next.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const fmtNext = next.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    if (diffDays < 0) {
      return { text: `GMOV vencido há ${Math.abs(diffDays)} dia(s)!`, type: "red", nextDate: fmtNext };
    } else if (diffDays <= 30) {
      return { text: `Renovação necessária em ${diffDays} dia(s).`, type: "amber", nextDate: fmtNext };
    } else {
      return { text: `Renovação em dia. Próxima em ${diffDays} dias.`, type: "green", nextDate: fmtNext };
    }
  };

  const handleGmovChange = (val: string) => {
    updateState(prev => ({ config: { ...prev.config, gmov_data: val } }));
  };

  // Universal CSV/TSV parser
  const handleMultiImportText = (text: string, type: typeof importType) => {
    try {
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        onToast("Nenhum dado válido identificado no importador. Certifique-se de incluir a linha de cabeçalho e os dados.", "err");
        return;
      }
      let sep = ",";
      if (lines[0].includes("\t")) {
        sep = "\t";
      } else if (lines[0].includes(";")) {
        sep = ";";
      } else if (lines[0].includes(",")) {
        sep = ",";
      }

      const splitCSVLine = (line: string, separator: string): string[] => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
          } else if (char === separator && !inQuotes) {
            result.push(current);
            current = "";
          } else {
            current += char;
          }
        }
        result.push(current);
        return result;
      };

      const headers = splitCSVLine(lines[0], sep).map(h => h.trim().toUpperCase().replace(/['"]/g, ''));
      
      const rawRows = lines.slice(1).map(l => {
        const cols = splitCSVLine(l, sep);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = (cols[i] || '').trim().replace(/^["']|["']$/g, '');
        });
        return obj;
      });

      if (type === 'servidores') {
        const data: Server[] = rawRows.map(r => ({
          matricula: formatMatricula(r['MATRICULA'] || r['MATRÍCULA'] || r['MAT'] || ''),
          nome: r['NOME'] || r['NOME COMPLETO'] || '',
          cargo: r['CARGO'] || '',
          denominacao: r['DENOMINACAO'] || r['DENOMINAÇÃO'] || '',
          codLotacao: r['CODIGO DA LOTACAO'] || r['CÓDIGO DA LOTAÇÃO'] || r['CODIGO LOTACAO'] || r['CÓDIGO LOTAÇÃO'] || r['COD LOTACAO'] || r['CODLOTACAO'] || '',
          lotacao: r['DESCRICAO DA LOTACAO'] || r['DESCRIÇÃO DA LOTAÇÃO'] || r['NOME DA LOTACAO'] || r['NOME DA LOTAÇÃO'] || r['NOME DO SETOR'] || r['LOTACAO'] || r['LOTAÇÃO'] || r['SETOR'] || '',
          admissao: r['DATA ADMISSAO'] || r['DATA ADMISSÃO'] || r['ADMISSAO'] || r['ADMISSÃO'] || '',
          situacao: r['SITUACAO FUNCIONAL'] || r['SITUAÇÃO FUNCIONAL'] || r['SITUACAO'] || r['SITUAÇÃO'] || ''
        })).filter(r => r.matricula || r.nome);

        if (data.length === 0) {
          onToast("Nenhum dado de servidor válido identificado.", "err");
          return;
        }

        updateState(prev => {
          const existingMap = new Map();
          prev.servidores.forEach(s => {
            const norm = normalizeMatricula(s.matricula);
            if (norm) {
              existingMap.set(norm, s);
            }
          });

          let addedCount = 0;
          let updatedCount = 0;

          data.forEach(srv => {
            const norm = normalizeMatricula(srv.matricula);
            if (norm) {
              if (existingMap.has(norm)) {
                const existingSrv = existingMap.get(norm);
                existingMap.set(norm, { 
                  ...existingSrv, 
                  ...srv,
                  matricula: existingSrv.matricula // Preserve original formatting
                });
                updatedCount++;
              } else {
                existingMap.set(norm, srv);
                addedCount++;
              }
            }
          });

          const importedMatriculas = data
            .map(srv => normalizeMatricula(srv.matricula))
            .filter(Boolean);
          const importedCount = data.length;
          const dateStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

          return {
            servidores: Array.from(existingMap.values()),
            config: {
              ...prev.config,
              ultimoUpdateServidores: `${dateStr} (${importedCount} servidores)`,
              lastImportedMatriculas: importedMatriculas,
              lastImportCount: importedCount
            }
          };
        });
        
        onToast(`${data.length} servidores processados com sucesso (novos adicionados e antigos preservados)!`, "ok");
      }
      
      else if (type === 'respostas') {
        const data = rawRows.map(r => ({
          nome: r['NOME'] || r['TITULO'] || r['CHAVE'] || '',
          texto: r['TEXTO'] || r['CONTEUDO'] || r['RESPOSTA'] || ''
        })).filter(r => r.nome && r.texto);

        if (data.length === 0) {
          onToast("Nenhuma resposta rápida válida identificada.", "err");
          return;
        }
        updateState({ respostas: data });
        onToast(`${data.length} respostas rápidas importadas com sucesso!`, "ok");
      }
      
      else if (type === 'faq') {
        const data = rawRows.map(r => ({
          titulo: r['TITULO'] || r['PERGUNTA'] || r['DÚVIDA'] || r['DUVIDA'] || '',
          resposta: r['RESPOSTA'] || r['CONTEUDO'] || r['TEXTO'] || ''
        })).filter(r => r.titulo && r.resposta);

        if (data.length === 0) {
          onToast("Nenhuma dúvida válida identificada.", "err");
          return;
        }
        updateState({ faq: data });
        onToast(`${data.length} itens do banco de dúvidas importados!`, "ok");
      }

      else if (type === 'filaAvulsa') {
        const normMat = (m: any) => normalizeMatricula(m);
        const data = rawRows.map(r => {
          const rawMat = r['MATRICULA'] || r['MATRÍCULA'] || r['MAT'] || '';
          let matricula = formatMatricula(rawMat);
          let nome = r['NOME'] || r['NOME COMPLETO'] || '';
          
          if (rawMat && state.servidores && state.servidores.length > 0) {
            const found = state.servidores.find(s => normMat(s.matricula) === normMat(rawMat));
            if (found) {
              matricula = found.matricula;
              nome = found.nome;
            }
          }

          const tiposRaw = r['TIPOS'] || r['TAGS'] || '';
          const tipos = tiposRaw ? tiposRaw.split('|').map((t: string) => t.trim()) : [];
          return {
            matricula,
            nome,
            tipos,
            ocorrencias: []
          };
        }).filter(r => r.matricula && r.nome);

        if (data.length === 0) {
          onToast("Nenhum registro de fila válido identificado.", "err");
          return;
        }
        
        updateState(prev => {
          const listas = { ...prev.filaAvulsa.listas };
          const ativa = prev.filaAvulsa.ativa || "Padrão";
          if (!listas[ativa]) {
            listas[ativa] = { fila: [], idx: 0 };
          }
          listas[ativa].fila = [...listas[ativa].fila, ...data];
          return {
            filaAvulsa: {
              ...prev.filaAvulsa,
              listas
            }
          };
        });
        onToast(`${data.length} servidores adicionados à fila avulsa!`, "ok");
      }

      else if (type === 'produtividade') {
        const logsByDate: Record<string, { manha: AtividadeLancamento[], tarde: AtividadeLancamento[] }> = {};
        
        rawRows.forEach(r => {
          const data = r['DATA'] || r['DIA'] || '';
          const tipo = r['TIPO'] || 'documento';
          const sistema = r['SISTEMA'] || 'SISREF';
          const desc = r['DESCRICAO'] || r['DESCRIÇÃO'] || r['OBS'] || '';
          const qtd = parseInt(r['QUANTIDADE'] || r['QTD'] || '1') || 1;
          const periodo = (r['PERIODO'] || r['TURNO'] || 'manha').toLowerCase().includes('tarde') ? 'tarde' : 'manha';
          
          if (!data) return;
          
          const fmtData = data.includes('/') ? data.split('/').reverse().join('-') : data;
          
          if (!logsByDate[fmtData]) {
            logsByDate[fmtData] = { manha: [], tarde: [] };
          }
          
          const item: AtividadeLancamento = { qtd, tipo, sistema, desc };
          if (periodo === 'tarde') {
            logsByDate[fmtData].tarde.push(item);
          } else {
            logsByDate[fmtData].manha.push(item);
          }
        });

        const dates = Object.keys(logsByDate);
        if (dates.length === 0) {
          onToast("Nenhum registro de produtividade válido identificado.", "err");
          return;
        }

        updateState(prev => {
          const produtividade = { ...prev.produtividade };
          dates.forEach(d => {
            if (!produtividade[d]) {
              produtividade[d] = { situacao: "Trabalho Normal", sitObs: "", manha: [], tarde: [] };
            }
            produtividade[d].manha = [...produtividade[d].manha, ...logsByDate[d].manha];
            produtividade[d].tarde = [...produtividade[d].tarde, ...logsByDate[d].tarde];
          });
          return { produtividade };
        });
        onToast(`Dados de produtividade importados para ${dates.length} dias!`, "ok");
      }

      else if (type === 'balcaoAtendimentos') {
        const updates: Record<string, string> = {};
        rawRows.forEach(r => {
          const data = r['DATA'] || r['DIA'] || '';
          const notas = r['NOTAS'] || r['NOTA'] || r['ATENDIMENTOS'] || r['ATENDIMENTO'] || r['TEXTO'] || '';
          if (!data || !notas) return;
          const fmtData = data.includes('/') ? data.split('/').reverse().join('-') : data;
          updates[fmtData] = (updates[fmtData] ? updates[fmtData] + "\n" : "") + notas;
        });

        const dates = Object.keys(updates);
        if (dates.length === 0) {
          onToast("Nenhum registro de atendimento no balcão identificado.", "err");
          return;
        }

        updateState(prev => {
          const balcaoAtendimentos = { ...prev.balcaoAtendimentos };
          dates.forEach(d => {
            balcaoAtendimentos[d] = balcaoAtendimentos[d] ? balcaoAtendimentos[d] + "\n" + updates[d] : updates[d];
          });
          return { balcaoAtendimentos };
        });
        onToast(`Registros de balcão importados para ${dates.length} dias!`, "ok");
      }

      else if (type === 'afastamentos') {
        const data: Absence[] = rawRows.map(r => ({
          dia: String(r['DIA'] || ''),
          mes: String(r['MES'] || ''),
          tipo: String(r['TIPO'] || ''),
          sisref: String(r['SISREF'] || '')
        })).filter(r => r.dia && r.mes && r.tipo);

        if (data.length === 0) {
          onToast("Nenhum afastamento válido identificado.", "err");
          return;
        }

        updateState(prev => ({
          afastamentos: [...prev.afastamentos, ...data]
        }));
        onToast(`${data.length} afastamentos importados com sucesso!`, "ok");
      }

    } catch (e) {
      onToast("Erro ao processar arquivo/texto", "err");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = ev => {
      const result = ev.target?.result as string;
      handleMultiImportText(result, importType);
    };
    r.readAsText(file, "UTF-8");
  };

  const handleBackupDownload = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dt = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `sisref_backup_${dt}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onToast("Backup baixado para a máquina local", "ok");
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        // Aceita o backup (.json) e também o arquivo de cópia automática com { state: ... }
        const parsed = raw && typeof raw === "object" && raw.state && raw.state.servidores ? raw.state : raw;
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.servidores)) {
          const resumo = `${parsed.servidores.length} servidores, ${(parsed.historico || []).length} registros de histórico`;
          if (!confirm(`Restaurar este backup?\n(${resumo})\n\nOs dados atuais serão substituídos e enviados para a nuvem.`)) return;
          updateState(parsed);
          onToast("Backup restaurado e enviado para a nuvem!", "ok");
        } else {
          onToast("Arquivo de backup com formato inválido", "err");
        }
      } catch (_) {
        onToast("Erro ao decodificar arquivo JSON", "err");
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  // Processos SEI
  const salvarSei = () => {
    if (!seiForm?.num) return;
    updateState(prev => {
      const nextArr = [...prev.sei];
      const obj = { num: seiForm.num.trim(), desc: seiForm.desc.trim() };
      if (seiForm.idx >= 0) {
        nextArr[seiForm.idx] = obj;
      } else {
        nextArr.push(obj);
      }
      return { sei: nextArr };
    });
    onToast("Processo SEI atualizado", "ok");
    setSeiForm(null);
  };

  const excluirSei = (idx: number) => {
    if (!confirm("Excluir processo?")) return;
    updateState(prev => ({ sei: prev.sei.filter((_, i) => i !== idx) }));
    onToast("Processo removido", "info");
  };

  // Férias & Abonos scheduling
  const handleFeriasChange = (idx: number, field: "inicio" | "fim" | "processo", val: string) => {
    updateState(prev => {
      const nextFerias = { ...prev.ferias };
      if (!nextFerias[feriasAno]) {
        nextFerias[feriasAno] = [{}, {}, {}];
      }
      while (nextFerias[feriasAno].length < 3) nextFerias[feriasAno].push({});
      nextFerias[feriasAno][idx] = { ...nextFerias[feriasAno][idx], [field]: val };
      return { ferias: nextFerias };
    });
  };

  const handleAbonosChange = (idx: number, field: "data" | "processo", val: string) => {
    updateState(prev => {
      const nextAbonos = { ...prev.abonos };
      if (!nextAbonos[abonosAno]) {
        nextAbonos[abonosAno] = [{}, {}, {}, {}, {}];
      }
      while (nextAbonos[abonosAno].length < 5) nextAbonos[abonosAno].push({});
      nextAbonos[abonosAno][idx] = { ...nextAbonos[abonosAno][idx], [field]: val };
      return { abonos: nextAbonos };
    });
  };

  // Afastamentos
  const salvarAfas = () => {
    if (!afasForm?.dia || !afasForm?.mes || !afasForm?.tipo) {
      onToast("Preencha todos os campos obrigatórios", "err");
      return;
    }
    updateState(prev => {
      const nextArr = [...prev.afastamentos];
      const obj: Absence = { 
        dia: afasForm.dia.trim(), 
        mes: afasForm.mes.trim(), 
        tipo: afasForm.tipo.trim(), 
        sisref: afasForm.sisref 
      };
      if (afasForm.idx >= 0) {
        nextArr[afasForm.idx] = obj;
      } else {
        nextArr.push(obj);
      }
      return { afastamentos: nextArr };
    });
    onToast("Afastamento registrado", "ok");
    setAfasForm(null);
  };

  const excluirAfas = (idx: number) => {
    if (!confirm("Remover afastamento?")) return;
    updateState(prev => ({ afastamentos: prev.afastamentos.filter((_, i) => i !== idx) }));
    onToast("Removido", "info");
  };

  // Produtividade calculations and logs
  const getDayData = (): ProdutividadeDia => {
    if (state.produtividade[prodData]) return state.produtividade[prodData];
    const dParts = prodData.split('-');
    if (dParts.length === 3) {
      const ddmm = `${dParts[2]}/${dParts[1]}/${dParts[0]}`;
      if (state.produtividade[ddmm]) return state.produtividade[ddmm];
    }
    const matchKey = Object.keys(state.produtividade || {}).find(k => toYmdDate(k) === prodData);
    if (matchKey && state.produtividade[matchKey]) return state.produtividade[matchKey];
    return { situacao: "normal", sitObs: "", manha: [], tarde: [] };
  };

  const handleReconstructProdutividade = () => {
    const reconstructed = reconstructProdutividadeFromState(state);
    updateState({ produtividade: reconstructed });
    const totalDays = Object.keys(reconstructed).length;
    onToast(`Produtividade recuperada para ${totalDays} dia(s) a partir dos lançamentos e ocorrências!`, "ok");
  };

  const setSituacaoDia = (sit: string) => {
    updateState(prev => {
      const nextProd = { ...prev.produtividade };
      const current = nextProd[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
      nextProd[prodData] = { ...current, situacao: sit };
      return { produtividade: nextFrases(nextArrWithUpdatedProd(nextProd)) };
    });
  };

  // Helper inside updater
  const nextArrWithUpdatedProd = (nextProd: Record<string, ProdutividadeDia>) => nextProd;
  const nextFrases = (p: Record<string, ProdutividadeDia>) => p;

  const setSituacaoObs = (obs: string) => {
    updateState(prev => {
      const nextProd = { ...prev.produtividade };
      const current = nextProd[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
      nextProd[prodData] = { ...current, sitObs: obs };
      return { produtividade: nextProd };
    });
  };

  const addAtividade = (turno: "manha" | "tarde") => {
    updateState(prev => {
      const nextProd = { ...prev.produtividade };
      const current = nextProd[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
      const nextTurnoList = [...(current[turno] || [])];
      
      const configT = prev.filaAvulsa.configProd.tipos;
      const configS = prev.filaAvulsa.configProd.sistemas;

      nextTurnoList.push({
        qtd: "",
        tipo: configT[0] || "documento",
        sistema: configS[0] || "SISREF",
        desc: ""
      });

      nextProd[prodData] = {
        ...current,
        [turno]: nextTurnoList
      };

      return { produtividade: nextProd };
    });
  };

  const updateAtividadeField = (turno: "manha" | "tarde", idx: number, field: keyof AtividadeLancamento, val: string) => {
    updateState(prev => {
      const nextProd = { ...prev.produtividade };
      const current = nextProd[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
      const nextTurnoList = [...(current[turno] || [])];
      
      const updatedItem = { ...nextTurnoList[idx], [field]: val };

      // Handle custom SEI processes quantity updater automatically
      if (field === "sistema") {
        if (val !== "SEI") {
          updatedItem.processosSei = "";
        }
      }

      if (field === "processosSei" && val) {
        // Quantify processed SEIs count from list of comma-separated items
        const numProcesses = val.split(",").map(p => p.trim()).filter(Boolean).length;
        updatedItem.qtd = numProcesses;
      }

      nextTurnoList[idx] = updatedItem;
      nextProd[prodData] = { ...current, [turno]: nextTurnoList };
      return { produtividade: nextProd };
    });
  };

  const removeAtividade = (turno: "manha" | "tarde", idx: number) => {
    updateState(prev => {
      const nextProd = { ...prev.produtividade };
      const current = nextProd[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
      const nextTurnoList = (current[turno] || []).filter((_, i) => i !== idx);
      
      nextProd[prodData] = { ...current, [turno]: nextTurnoList };
      return { produtividade: nextProd };
    });
  };

  const handleSaveProdConfig = () => {
    const tipos = cfgTipos.split(",").map(x => x.trim()).filter(Boolean);
    const sistemas = cfgSistemas.split(",").map(x => x.trim()).filter(Boolean);

    if (tipos.length === 0 || sistemas.length === 0) {
      onToast("Preencha as configurações de tipos e sistemas", "err");
      return;
    }

    updateState(prev => ({
      filaAvulsa: {
        ...prev.filaAvulsa,
        configProd: { tipos, sistemas }
      }
    }));

    onToast("Configurações atualizadas!", "ok");
    setProdCfgOpen(false);
  };

  const openCfgForm = () => {
    setCfgTipos(state.filaAvulsa.configProd.tipos.join(", "));
    setCfgSistemas(state.filaAvulsa.configProd.sistemas.join(", "));
    setProdCfgOpen(true);
  };

  const currentDia = getDayData();
  const listActivities = [...(currentDia.manha || []), ...(currentDia.tarde || [])];
  const totalSumProduced = listActivities.reduce((s, a) => s + (parseInt(String(a.qtd)) || 0), 0);
  const totalActCount = listActivities.length;
  const systemUsedStr = Array.from(new Set(listActivities.map(a => a.sistema).filter(Boolean))).join(", ") || "Nenhum";

  const getDayEscalaBadge = () => {
    const d = new Date(prodData + "T12:00:00");
    const dayOfWeek = d.getDay();
    const isEscala = [1, 3].includes(dayOfWeek); // matching legacy ESCALA_DIAS=[1,3]
    return isEscala ? (
      <span className="text-xs font-bold bg-[var(--green-light)] text-[var(--green-mid)] px-2.5 py-1 rounded-full flex items-center gap-0.5">
        <Check size={12} /> Dia de escala (7h-12h / 13h-18h)
      </span>
    ) : (
      <span className="text-xs font-semibold bg-[var(--border2)] text-[var(--text2)] px-2.5 py-1 rounded-full">
        Fora da escala regular
      </span>
    );
  };

  // Generate Year option elements
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear - 2; y <= currentYear + 3; y++) {
    yearOptions.push(y);
  }

  // Generate Month list options
  const monthListOptions = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(currentYear, new Date().getMonth() - m, 1);
    monthListOptions.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    });
  }

  const listHistoryDates = Object.keys(state.produtividade)
    .filter(d => d.startsWith(histFiltroMes))
    .sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex flex-col gap-6">

      {/* IMPORT TAB CONTENT */}
      {subTab === 'importar' && (
        <div className="flex flex-col gap-6">

          {/* 0. CLOUD MULTI-DEVICE FIRESTORE SYNCHRONIZATION (PRIMARY ENGINE) */}
          <div className="bg-gradient-to-br from-emerald-500/10 via-[var(--surface)] to-emerald-500/5 border-2 border-emerald-500/40 rounded-2xl p-6 shadow-sm overflow-hidden relative">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <Cloud size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[var(--text)] uppercase tracking-wider">
                    Sincronização em Nuvem em Tempo Real (Multi-Dispositivo)
                  </h3>
                  <p className="text-xs text-[var(--text2)] font-semibold mt-0.5">
                    Seus dados sincronizados automaticamente entre todos os seus computadores e celulares via Firestore.
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-full flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Nuvem Ativa
              </span>
            </div>

            {/* Quick Metrics of this device */}
            <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border2)] grid grid-cols-3 gap-2 text-center mb-4">
              <div>
                <span className="text-base font-black text-[var(--blue-mid)]">{state.servidores?.length || 0}</span>
                <div className="text-[9px] uppercase font-bold text-[var(--text2)]">Servidores</div>
              </div>
              <div>
                <span className="text-base font-black text-amber-500">{state.filaAvulsa?.listas?.[state.filaAvulsa?.ativa || "Padrão"]?.fila?.length || 0}</span>
                <div className="text-[9px] uppercase font-bold text-[var(--text2)]">Fila SISREF</div>
              </div>
              <div>
                <span className="text-base font-black text-emerald-500">{state.historico?.length || 0}</span>
                <div className="text-[9px] uppercase font-bold text-[var(--text2)]">Lançamentos</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-[var(--surface)] border border-emerald-500/30 flex flex-col justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1.5">
                    <UploadCloud size={15} /> Computador com Dados Reais
                  </div>
                  <p className="text-xs text-[var(--text2)] font-semibold leading-relaxed">
                    Clique aqui no computador onde você tem todos os dados salvos para enviá-los e disponibilizá-los imediatamente na nuvem.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={forcePushThisDeviceToCloud || forceSync}
                  disabled={syncing}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-all"
                >
                  <UploadCloud size={16} />
                  <span>{syncing ? "Gravando na Nuvem..." : "Salvar Este Computador na Nuvem Agora"}</span>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-[var(--surface)] border border-blue-500/30 flex flex-col justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1.5">
                    <RefreshCw size={14} /> Outro Computador / Celular
                  </div>
                  <p className="text-xs text-[var(--text2)] font-semibold leading-relaxed">
                    Se você abriu o aplicativo em outro computador ou celular e a tela está em branco, baixe os dados da nuvem.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={forcePullFromCloud || forceSync}
                  disabled={syncing}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-all"
                >
                  <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
                  <span>{syncing ? "Buscando na Nuvem..." : "Baixar Dados da Nuvem para Este Dispositivo"}</span>
                </button>
              </div>
            </div>

          </div>

          {/* CASOS ESPECIAIS SISREF (SELO DE ATENÇÃO ROTATIVO) */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-2">
                <Star className="text-amber-500 fill-current" size={16} /> Casos Especiais SISREF (Selo de Atenção no Lançamento)
              </div>
              <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-black rounded-full">
                {(state.config?.casosEspeciais || state.casosEspeciais || []).length} cadastrado(s)
              </span>
            </div>
            
            <p className="text-xs text-[var(--text2)] mb-4 font-semibold leading-relaxed">
              Lista rotativa de servidores com casos especiais (ex: <strong>Contrato Temporário</strong>, horários diferenciados). O sistema exibe um <strong>selo de aviso em destaque</strong> na conferência e no lançamento das Filas Avulsas do SISREF. Matrículas com 7 dígitos recebem o <strong>0 à esquerda</strong> automaticamente.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCasosModal(true)}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
              >
                <Star size={14} className="fill-current" /> Gerenciar Casos Especiais (Incluir, Editar, Excluir)
              </button>
            </div>
          </div>
          
          {/* SERVIDORES CEDIDOS / IGNORADOS (FILA AVULSA SISREF) */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-2">
                <UserX className="text-amber-500" size={16} /> Servidores Cedidos (Ignorar nas Filas Avulsas do SISREF)
              </div>
              <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-black rounded-full">
                {(state.config?.matriculasCedidos || []).length} cadastrado(s)
              </span>
            </div>
            
            <p className="text-xs text-[var(--text2)] mb-4 font-semibold leading-relaxed">
              Cadastre as matrículas de servidores que estão cedidos para outros órgãos. Mesmo que apareçam nos relatórios ou filas avulsas do SISREF, o sistema <strong>descartará automaticamente essas matrículas</strong> durante a importação do texto, evitando lançamentos indevidos.
            </p>

            {/* Inserção de Matrículas */}
            <div className="bg-[var(--bg)] border border-[var(--border2)] rounded-xl p-4 mb-4">
              <label className="block text-[10px] font-black text-[var(--text2)] uppercase tracking-wider mb-1.5">
                Adicionar Matrículas de Cedidos (digite ou cole uma ou várias separadas por vírgula, espaço ou linha):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={2}
                  value={cedidosInput}
                  onChange={(e) => setCedidosInput(e.target.value)}
                  placeholder="Ex: 01234567, 07654321, 1458923..."
                  className="flex-1 p-2.5 text-xs font-mono rounded-xl border border-[var(--border2)] bg-[var(--surface)] outline-none text-[var(--text)] focus:border-[var(--blue-mid)] resize-y min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={handleAddCedidos}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all self-stretch sm:self-auto flex-shrink-0"
                >
                  <Plus size={14} /> Adicionar à Lista
                </button>
              </div>
            </div>

            {/* Lista de Matrículas de Cedidos */}
            {(state.config?.matriculasCedidos || []).length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)] opacity-60" />
                    <input
                      type="text"
                      placeholder="Buscar matrícula ou nome..."
                      value={cedidosSearch}
                      onChange={(e) => setCedidosSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border2)] bg-[var(--bg)] outline-none text-[var(--text)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleClearCedidos}
                    className="text-xs text-red-500 hover:text-red-600 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 size={12} /> Limpar Todos
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                  {(state.config?.matriculasCedidos || [])
                    .filter(mat => {
                      if (!cedidosSearch.trim()) return true;
                      const q = cedidosSearch.trim().toLowerCase();
                      const normMat = normalizeMatricula(mat);
                      const srv = state.servidores.find(s => normalizeMatricula(s.matricula) === normMat);
                      return mat.toLowerCase().includes(q) || (srv && srv.nome.toLowerCase().includes(q));
                    })
                    .map((mat) => {
                      const normMat = normalizeMatricula(mat);
                      const srv = state.servidores.find(s => normalizeMatricula(s.matricula) === normMat);
                      return (
                        <div
                          key={mat}
                          className="p-2.5 bg-[var(--bg)] border border-[var(--border2)] rounded-xl flex items-center justify-between gap-2 shadow-2xs hover:border-[var(--border)] transition-all"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-black text-xs text-[var(--text)]">
                                {formatMatricula(mat)}
                              </span>
                              {srv && (
                                <span className="text-[9px] px-1.5 py-0.2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded font-bold">
                                  SIGRH
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-semibold text-[var(--text2)] truncate" title={srv?.nome || "Servidor não localizado no cadastro geral"}>
                              {srv ? srv.nome : "Fora do cadastro"}
                            </div>
                            {srv?.lotacao && (
                              <div className="text-[9px] text-[var(--text2)] opacity-70 truncate">
                                {srv.lotacao}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCedido(mat)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg cursor-pointer transition-colors flex-shrink-0"
                            title={`Remover matrícula ${mat} da lista de cedidos`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-[var(--bg)]/40 border border-dashed border-[var(--border2)] rounded-xl text-center">
                <p className="text-xs text-[var(--text2)] font-semibold">
                  Nenhuma matrícula de servidor cedido cadastrada. Adicione matrículas no campo acima para que o SISREF as ignore automaticamente.
                </p>
              </div>
            )}
          </div>
          
          {/* 2. UNIVERSAL COPY-PASTE DATA MULTI-IMPORTER */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ClipboardPaste className="text-[var(--blue-mid)]" size={16} /> Importador Central Multisseções (Excel / Sheets / CSV)
            </div>
            <p className="text-xs text-[var(--text2)] font-semibold mb-4 leading-relaxed">
              Migre todo o seu histórico do App Script ou Excel de uma só vez. Selecione a seção desejada, copie as colas da sua planilha e cole aqui no campo abaixo.
            </p>

            {/* Dropdown / selector for section type */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { id: 'servidores', label: 'Cadastro de Servidores', icon: <Contact size={14} />, count: state.servidores.length },
                { id: 'respostas', label: 'Respostas Rápidas', icon: <FileText size={14} />, count: state.respostas.length },
                { id: 'faq', label: 'Banco de Dúvidas / FAQ', icon: <AlertCircle size={14} />, count: state.faq.length },
                { id: 'filaAvulsa', label: 'Fila Avulsa de Conferência', icon: <History size={14} />, count: state.filaAvulsa.listas[state.filaAvulsa.ativa || "Padrão"]?.fila.length || 0 },
                { id: 'produtividade', label: 'Produtividade de Lançamentos', icon: <TrendingUp size={14} />, count: Object.keys(state.produtividade).length },
                { id: 'balcaoAtendimentos', label: 'Atendimentos de Balcão', icon: <ServerIcon size={14} />, count: Object.keys(state.balcaoAtendimentos).length },
                { id: 'afastamentos', label: 'Afastamentos / Licenças', icon: <Palmtree size={14} />, count: state.afastamentos.length },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setImportType(opt.id as any)}
                  className={`px-3 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 border transition cursor-pointer
                    ${importType === opt.id 
                      ? 'bg-[var(--blue-light)] text-[var(--blue-mid)] border-[var(--blue-mid)]' 
                      : 'bg-white text-[var(--text2)] border-[var(--border2)] hover:bg-[var(--bg)]'}`}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                  <span className="bg-[var(--border)] px-1.5 py-0.5 rounded-full text-[10px] font-extrabold">
                    {opt.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Expected format helper card */}
            <div className="bg-[var(--bg)] border border-[var(--border2)] rounded-xl p-4 text-xs font-semibold text-[var(--text2)] mb-4 leading-relaxed">
              <span className="text-[var(--blue-mid)] font-bold block mb-1">Colunas esperadas no cabeçalho (TSV / CSV):</span>
              {importType === 'servidores' && (
                <code>MATRICULA | NOME | CARGO | LOTACAO | ADMISSAO | SITUACAO</code>
              )}
              {importType === 'respostas' && (
                <code>NOME | TEXTO (ou CONTEUDO)</code>
              )}
              {importType === 'faq' && (
                <code>TITULO (ou PERGUNTA) | RESPOSTA</code>
              )}
              {importType === 'filaAvulsa' && (
                <code>MATRICULA | NOME | TIPOS (separados por | se houver múltiplos)</code>
              )}
              {importType === 'produtividade' && (
                <code>DATA (ex: YYYY-MM-DD ou DD/MM/YYYY) | TURNO (manha/tarde) | TIPO | SISTEMA | QUANTIDADE | DESCRICAO</code>
              )}
              {importType === 'balcaoAtendimentos' && (
                <code>DATA (ex: YYYY-MM-DD) | NOTAS (ou ATENDIMENTOS)</code>
              )}
              {importType === 'afastamentos' && (
                <code>DIA | MES | TIPO | SISREF</code>
              )}
              <span className="text-[var(--text2)] block mt-1.5 opacity-85">
                * Dica: Você pode copiar um bloco de linhas diretamente da sua planilha do Excel ou Sheets (incluindo o cabeçalho) e colar abaixo. O sistema detectará as colunas automaticamente!
              </span>
            </div>

            {/* File Drag-Drop Area */}
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  const r = new FileReader();
                  r.onload = ev => handleMultiImportText(ev.target?.result as string, importType);
                  r.readAsText(file, "UTF-8");
                }
              }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition mb-4 ${isDragOver ? 'bg-[var(--blue-light)]/30 border-[var(--blue-mid)]' : 'border-[var(--border2)] hover:bg-[var(--bg)]/40'}`}
            >
              <UploadCloud className="text-[var(--blue-mid)] mx-auto mb-2" size={28} />
              <div className="text-xs font-bold text-[var(--text)]">Arraste um arquivo (.csv, .tsv) ou use o seletor</div>
              <input 
                type="file" 
                accept=".csv,.tsv,.txt" 
                onChange={handleFileChange}
                className="hidden" 
                id="central-loader-file"
              />
              <button 
                onClick={() => document.getElementById("central-loader-file")?.click()}
                className="mt-2 px-3 py-1.5 bg-white border border-[var(--border2)] text-[10px] font-bold rounded-lg hover:bg-gray-50"
              >
                Selecionar arquivo do computador
              </button>
            </div>

            {/* Direct Paste Text Area */}
            <textarea 
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              placeholder={`Cole suas linhas copiadas aqui...\nExemplo:\nNOME\tTEXTO\nTemplate 1\tOlá, tudo bem?`}
              className="w-full p-3 font-mono text-xs rounded-xl min-h-32 resize-y bg-[var(--bg)] border border-[var(--border2)] outline-none"
            />
            
            <div className="flex gap-2 mt-3">
              <button 
                onClick={() => {
                  if (!tsvText.trim()) {
                    onToast("Por favor, cole algum texto antes de clicar em importar.", "err");
                    return;
                  }
                  handleMultiImportText(tsvText, importType);
                  setTsvText("");
                }}
                className="flex-1 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-sm"
              >
                <ClipboardPaste size={14} /> Importar Texto Colado
              </button>
              
              <button 
                onClick={() => {
                  if (confirm(`Deseja realmente limpar todos os dados da seção selecionada (${importType})? Esta ação não pode ser desfeita.`)) {
                    if (importType === 'servidores') updateState({ servidores: [] });
                    else if (importType === 'respostas') updateState({ respostas: [] });
                    else if (importType === 'faq') updateState({ faq: [] });
                    else if (importType === 'afastamentos') updateState({ afastamentos: [] });
                    else if (importType === 'balcaoAtendimentos') updateState({ balcaoAtendimentos: {} });
                    else if (importType === 'produtividade') updateState({ produtividade: {} });
                    else if (importType === 'filaAvulsa') {
                      updateState(prev => {
                        const listas = { ...prev.filaAvulsa.listas };
                        const ativa = prev.filaAvulsa.ativa || "Padrão";
                        if (listas[ativa]) listas[ativa].fila = [];
                        return { filaAvulsa: { ...prev.filaAvulsa, listas } };
                      });
                    }
                    onToast("Dados da seção limpos com sucesso", "info");
                  }
                }}
                className="px-4 py-2.5 border border-red-300 hover:bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={14} /> Limpar Seção
              </button>
            </div>
          </div>

          {/* 3. CÓPIA AUTOMÁTICA DESTE COMPUTADOR (SEGURANÇA) */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[var(--text1)] flex items-center gap-2">
                <History size={16} /> Cópia automática deste computador
              </span>
              <span className="text-[10px] font-bold uppercase bg-[var(--surface2)] text-[var(--text2)] px-2 py-0.5 rounded-full">Automático</span>
            </div>
            <p className="text-xs text-[var(--text2)]">
              Este navegador guarda sozinho uma cópia dos dados a cada alteração. Se algo der errado com a nuvem,
              baixe a cópia mais recente e use "Restaurar arquivo de backup" logo abaixo (ou envie para análise).
            </p>
            <button
              type="button"
              onClick={handleDownloadLatestLocalCopy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border)] bg-[var(--surface2)] text-[var(--text1)] hover:opacity-90 cursor-pointer"
            >
              <FileDown size={15} /> Baixar cópia automática mais recente
            </button>
          </div>
          {/* 4. JSON STATE BACKUP AND RESTORE */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-2">
              Cópia de Segurança do Banco (Backup Completo .json)
            </div>
            <p className="text-xs text-[var(--text2)] mb-4 leading-relaxed font-semibold">
              Salve ou restaure todo o estado unificado do sistema local em um único arquivo .json para backup off-line.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button 
                onClick={handleBackupDownload}
                className="py-2.5 px-4 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <DownloadCloud size={16} /> Baixar arquivo de backup (.json)
              </button>
              
              <label className="py-2.5 px-4 bg-[var(--surface)] hover:bg-[var(--bg)] border border-[var(--border2)] text-[var(--text)] text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-sm">
                <UploadCloud size={16} /> Restaurar arquivo de backup (.json)
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleBackupUpload}
                  className="hidden" 
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* VIDA FUNCIONAL TAB CONTENT */}
      {subTab === 'vida' && (
        <VidaFuncionalPanel state={state} updateState={updateState} onToast={onToast} />
      )}

      {/* PRODUTIVIDADE TAB CONTENT */}
      {subTab === 'produtividade' && (
        <ProdutividadePanel state={state} updateState={updateState} onToast={onToast} dataInicial={prodDataInicial} />
      )}

      {/* Modal Casos Especiais */}
      <ModalCasosEspeciais
        isOpen={showCasosModal}
        onClose={() => setShowCasosModal(false)}
        state={state}
        updateState={updateState}
        onToast={onToast}
      />
    </div>
  );
}
