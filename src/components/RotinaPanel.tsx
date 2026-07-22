import React, { useState, useEffect } from "react";
import { AppState, Server, SeiProcess, Absence, AtividadeLancamento, ProdutividadeDia } from "../types.js";
import { 
  UploadCloud, Contact, TrendingUp, Server as ServerIcon, 
  Trash2, DownloadCloud, ClipboardPaste, BellRing, FolderOpen, 
  Palmtree, CalendarCheck, Stethoscope, Save, Settings2, Plus, 
  X, Check, Sunrise, Sunset, History, Calendar, FileText, 
  ArrowRight, Edit, AlertTriangle, AlertCircle, CheckCircle,
  Database, RefreshCw, Key, Search, Link as LinkIcon, ExternalLink, Unlink
} from "lucide-react";
import { 
  syncToGoogleSheets, 
  loadServersFromBackup, 
  loadFullStateFromBackup, 
  searchGoogleDriveForBackup, 
  extractSpreadsheetId, 
  DriveBackupFile 
} from "../lib/googleSheetsSync.js";

const normalizeMatricula = (m: any): string => {
  return String(m || "").trim().replace(/[^a-zA-Z0-9]/g, "").replace(/^0+/, "");
};

interface RotinaPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  forceSync: () => Promise<void>;
  syncing: boolean;
  googleUser: any;
  googleToken: string | null;
  onGoogleLogin: () => Promise<string | null>;
  onGoogleLogout: () => Promise<void>;
  subTab?: 'importar' | 'vida' | 'produtividade';
  setSubTab?: (t: 'importar' | 'vida' | 'produtividade') => void;
}

export default function RotinaPanel({ 
  state, 
  updateState, 
  onToast, 
  forceSync, 
  syncing,
  googleUser,
  googleToken,
  onGoogleLogin,
  onGoogleLogout,
  subTab: controlledSubTab,
  setSubTab: setControlledSubTab
}: RotinaPanelProps) {
  const [localSubTab, setLocalSubTab] = useState<'importar' | 'vida' | 'produtividade'>('importar');

  const subTab = controlledSubTab !== undefined ? controlledSubTab : localSubTab;
  const setSubTab = setControlledSubTab !== undefined ? setControlledSubTab : setLocalSubTab;

  // GAS connection and syncing
  const [gasUrl, setGasUrl] = useState(state.gasUrl || "");
  const [testingGAS, setTestingGAS] = useState(false);
  const [syncingGAS, setSyncingGAS] = useState(false);
  const [showGasHelp, setShowGasHelp] = useState(false);
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

  // Google Sheets Direct API Backup States
  const [googleSyncStatus, setGoogleSyncStatus] = useState<string>("");
  const [googleSyncType, setGoogleSyncType] = useState<'info' | 'ok' | 'err' | ''>("");
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
  const [manualSheetInput, setManualSheetInput] = useState("");
  const [foundDriveFiles, setFoundDriveFiles] = useState<DriveBackupFile[]>([]);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);

  const getValidToken = async (): Promise<string | null> => {
    if (googleToken) return googleToken;
    onToast("Iniciando conexão com a conta Google...", "info");
    const freshToken = await onGoogleLogin();
    if (!freshToken) {
      onToast("É necessário autorizar a conta Google para esta operação.", "err");
    }
    return freshToken;
  };

  const handleSearchDriveBackups = async () => {
    const token = await getValidToken();
    if (!token) return;

    setIsSearchingDrive(true);
    setGoogleSyncType("info");
    setGoogleSyncStatus("Pesquisando planilhas de backup no seu Google Drive...");
    try {
      const files = await searchGoogleDriveForBackup(token);
      setFoundDriveFiles(files);
      if (files.length === 0) {
        setGoogleSyncType("info");
        setGoogleSyncStatus("Nenhuma planilha 'NGPESP' encontrada no seu Google Drive. Você pode criar uma nova ou colar o ID/link manualmente.");
      } else {
        setGoogleSyncType("ok");
        setGoogleSyncStatus(`Encontrada(s) ${files.length} planilha(s) no seu Google Drive.`);
      }
    } catch (err: any) {
      setGoogleSyncType("err");
      setGoogleSyncStatus(`Erro ao buscar no Drive: ${err.message || err}`);
    } finally {
      setIsSearchingDrive(false);
    }
  };

  const handleLinkAndRestoreSpreadsheet = async (sheetIdOrUrl: string) => {
    const sheetId = extractSpreadsheetId(sheetIdOrUrl);
    if (!sheetId) {
      onToast("Por favor, informe o ID ou link de uma planilha válida.", "err");
      return;
    }

    const token = await getValidToken();
    if (!token) return;

    setIsGoogleSyncing(true);
    setGoogleSyncType("info");
    setGoogleSyncStatus("Carregando dados da planilha do Google Drive...");

    try {
      const fullData = await loadFullStateFromBackup(token, sheetId, (prog) => {
        setGoogleSyncStatus(prog.message);
        setGoogleSyncType(prog.type);
      });

      updateState(prev => {
        // 1. Merge Servidores
        const existingMap = new Map();
        prev.servidores.forEach(s => {
          const norm = normalizeMatricula(s.matricula);
          if (norm) existingMap.set(norm, s);
        });

        fullData.servidores.forEach(srv => {
          const norm = normalizeMatricula(srv.matricula);
          if (norm) {
            if (existingMap.has(norm)) {
              const existingSrv = existingMap.get(norm);
              existingMap.set(norm, { ...existingSrv, ...srv, matricula: existingSrv.matricula });
            } else {
              existingMap.set(norm, srv);
            }
          }
        });

        // 2. Merge Historico
        const histSet = new Set(prev.historico.map(h => `${h.mat}_${h.ts}`));
        const newHist = [...prev.historico];
        fullData.historico.forEach(h => {
          const key = `${h.mat}_${h.ts}`;
          if (!histSet.has(key)) {
            histSet.add(key);
            newHist.push(h);
          }
        });

        // 3. Respostas
        const respMap = new Map(prev.respostas.map(r => [r.nome, r.texto]));
        (fullData.respostas || []).forEach(r => {
          if (r.nome) respMap.set(r.nome, r.texto);
        });

        // 4. Afastamentos
        const afastSet = new Set(prev.afastamentos.map(a => `${a.dia}_${a.mes}_${a.tipo}_${a.sisref}`));
        const newAfast = [...prev.afastamentos];
        (fullData.afastamentos || []).forEach(a => {
          const key = `${a.dia}_${a.mes}_${a.tipo}_${a.sisref}`;
          if (!afastSet.has(key)) {
            afastSet.add(key);
            newAfast.push(a);
          }
        });

        // 5. FAQ
        const faqMap = new Map(prev.faq.map(f => [f.titulo, f.resposta]));
        (fullData.faq || []).forEach(f => {
          if (f.titulo) faqMap.set(f.titulo, f.resposta);
        });

        // 6. Produtividade
        const newProdutividade = { ...prev.produtividade, ...(fullData.produtividade || {}) };

        // 7. Fila Avulsa
        const newFilaAvulsa = (fullData.filaAvulsa && fullData.filaAvulsa.listas && Object.keys(fullData.filaAvulsa.listas).length)
          ? fullData.filaAvulsa
          : prev.filaAvulsa;

        // 8. Codigos
        const codMap = new Map(prev.codigos.map(c => [c.num, c]));
        (fullData.codigos || []).forEach(c => { if (c.num) codMap.set(c.num, c); });

        // 9. Processos SEI
        const seiMap = new Map(prev.sei.map(s => [s.num, s]));
        (fullData.sei || []).forEach(s => { if (s.num) seiMap.set(s.num, s); });

        // 10. Ferias
        const newFerias = { ...prev.ferias, ...(fullData.ferias || {}) };

        // 11. Abonos
        const newAbonos = { ...prev.abonos, ...(fullData.abonos || {}) };

        // 12. Balcao Atendimentos
        const newBalcao = { ...prev.balcaoAtendimentos, ...(fullData.balcaoAtendimentos || {}) };

        const importedMatriculas = fullData.servidores.map(srv => normalizeMatricula(srv.matricula)).filter(Boolean);
        const importedCount = fullData.servidores.length;
        const dateStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        return {
          servidores: Array.from(existingMap.values()),
          historico: newHist,
          respostas: Array.from(respMap.entries()).map(([nome, texto]) => ({ nome, texto })),
          afastamentos: newAfast,
          faq: Array.from(faqMap.entries()).map(([titulo, resposta]) => ({ titulo, resposta })),
          produtividade: newProdutividade,
          filaAvulsa: newFilaAvulsa,
          codigos: Array.from(codMap.values()),
          sei: Array.from(seiMap.values()),
          ferias: newFerias,
          abonos: newAbonos,
          balcaoAtendimentos: newBalcao,
          config: {
            ...prev.config,
            ...(fullData.config || {}),
            spreadsheetId: sheetId,
            backupEnabled: true,
            ultimoUpdateServidores: importedCount ? `${dateStr} (${importedCount} servidores)` : prev.config.ultimoUpdateServidores,
            lastImportedMatriculas: importedMatriculas.length ? importedMatriculas : prev.config.lastImportedMatriculas,
            lastImportCount: importedCount || prev.config.lastImportCount
          }
        };
      });

      setGoogleSyncType("ok");
      setGoogleSyncStatus(`Planilha vinculada e ${fullData.servidores.length} servidores sincronizados do backup!`);
      onToast(`Planilha vinculada com sucesso! ${fullData.servidores.length} servidores restaurados.`, "ok");
      setManualSheetInput("");
      setFoundDriveFiles([]);
    } catch (err: any) {
      setGoogleSyncType("err");
      setGoogleSyncStatus(`Erro ao vincular planilha: ${err.message || err}`);
      onToast(`Erro ao vincular planilha: ${err.message || err}`, "err");
    } finally {
      setIsGoogleSyncing(false);
    }
  };

  const handleDirectBackupSync = async () => {
    const token = await getValidToken();
    if (!token) return;

    setIsGoogleSyncing(true);
    setGoogleSyncType("info");
    setGoogleSyncStatus("Iniciando backup...");
    try {
      const currentId = state.config.spreadsheetId || null;
      const sheetId = await syncToGoogleSheets(token, state, currentId, (prog) => {
        setGoogleSyncStatus(prog.message);
        setGoogleSyncType(prog.type);
      });
      
      // Update state with spreadsheetId if new or empty
      if (sheetId !== currentId) {
        updateState(prev => ({
          config: {
            ...prev.config,
            spreadsheetId: sheetId,
            backupEnabled: true
          }
        }));
      }
      onToast("Backup sincronizado com sucesso no Google Sheets!", "ok");
    } catch (err: any) {
      setGoogleSyncType("err");
      setGoogleSyncStatus(`Erro ao salvar backup: ${err.message || err}`);
      onToast("Erro na sincronização do Google Sheets", "err");
    } finally {
      setIsGoogleSyncing(false);
    }
  };

  const handleRestoreFromGoogleBackup = async () => {
    const sheetId = state.config.spreadsheetId;
    if (!sheetId) {
      onToast("Nenhuma planilha de backup configurada.", "err");
      return;
    }
    
    const token = await getValidToken();
    if (!token) return;

    if (!confirm("Isso irá mesclar os dados da planilha de backup no Google Drive com seus dados locais. Deseja prosseguir?")) {
      return;
    }
    
    await handleLinkAndRestoreSpreadsheet(sheetId);
  };

  // Vida Funcional
  const [seiForm, setSeiForm] = useState<{ idx: number; num: string; desc: string } | null>(null);
  const [afasForm, setAfasForm] = useState<{ idx: number; dia: string; mes: string; tipo: string; sisref: string } | null>(null);
  const [feriasAno, setFeriasAno] = useState(new Date().getFullYear().toString());
  const [abonosAno, setAbonosAno] = useState(new Date().getFullYear().toString());

  // Produtividade
  const [prodData, setProdData] = useState(new Date().toISOString().split("T")[0]);
  const [prodCfgOpen, setProdCfgOpen] = useState(false);
  const [cfgTipos, setCfgTipos] = useState("");
  const [cfgSistemas, setCfgSistemas] = useState("");
  const [histFiltroMes, setHistFiltroMes] = useState(new Date().toISOString().slice(0, 7));
  const [expandedHistDia, setExpandedHistDia] = useState<string | null>(null);

  useEffect(() => {
    setGasUrl(state.gasUrl || "");
  }, [state.gasUrl]);

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

  // Pull all state from Google Apps Script Web App
  const pullFromGAS = async () => {
    if (!gasUrl.trim()) {
      onToast("Por favor, configure a URL do Apps Script primeiro.", "err");
      return;
    }
    setSyncingGAS(true);
    updateState({ gasUrl: gasUrl.trim() });

    try {
      const res = await fetch("/api/gas-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gasUrl: gasUrl.trim(), action: "pull" })
      });
      if (res.ok) {
        const body = await res.json();
        if (body.status === "success" && body.data) {
          const remoteState = body.data;
          updateState(prev => ({
            ...prev,
            ...remoteState,
            servidores: (remoteState.servidores && remoteState.servidores.length > 0) ? remoteState.servidores : prev.servidores,
            respostas: (remoteState.respostas && remoteState.respostas.length > 0) ? remoteState.respostas : prev.respostas,
            faq: (remoteState.faq && remoteState.faq.length > 0) ? remoteState.faq : prev.faq,
          }));
          onToast(`Dados importados com sucesso! ${remoteState.servidores?.length || 0} servidores e demais dados carregados.`, "ok");
        } else {
          onToast(body.message || "Falha ao ler dados da Planilha.", "err");
        }
      } else {
        const body = await res.json().catch(() => ({}));
        onToast(body.message || "Erro HTTP ao conectar com Apps Script.", "err");
      }
    } catch (err: any) {
      onToast(err.message || "Erro de rede ao conectar com Apps Script.", "err");
    } finally {
      setSyncingGAS(false);
    }
  };

  // Push local state to Google Apps Script Web App
  const pushToGAS = async () => {
    if (!gasUrl.trim()) {
      onToast("Por favor, configure a URL do Apps Script primeiro.", "err");
      return;
    }
    setSyncingGAS(true);
    updateState({ gasUrl: gasUrl.trim() });

    try {
      const res = await fetch("/api/gas-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gasUrl: gasUrl.trim(), action: "push", state })
      });
      if (res.ok) {
        const body = await res.json();
        if (body.status === "success") {
          onToast("Dados sincronizados e exportados para a Planilha com sucesso!", "ok");
        } else {
          onToast(body.message || "Falha ao enviar dados para a Planilha.", "err");
        }
      } else {
        const body = await res.json().catch(() => ({}));
        onToast(body.message || "Erro HTTP ao enviar dados.", "err");
      }
    } catch (err: any) {
      onToast(err.message || "Erro de rede ao conectar com Apps Script.", "err");
    } finally {
      setSyncingGAS(false);
    }
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
          matricula: r['MATRICULA'] || r['MATRÍCULA'] || r['MAT'] || '',
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
        const data = rawRows.map(r => {
          const matricula = r['MATRICULA'] || r['MATRÍCULA'] || r['MAT'] || '';
          const nome = r['NOME'] || r['NOME COMPLETO'] || '';
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
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed && typeof parsed === "object") {
          updateState(parsed);
          onToast("Backup local restaurado com sucesso!", "ok");
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
    return state.produtividade[prodData] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
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
      
      {/* Sub Tabs selectors */}
      <div className="flex p-1 bg-[var(--border)] rounded-xl gap-1 select-none">
        <button 
          onClick={() => setSubTab('importar')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'importar' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <UploadCloud size={16} /> Importar & Conexão
        </button>
        <button 
          onClick={() => setSubTab('vida')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'vida' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <Contact size={16} /> Vida Funcional
        </button>
        <button 
          onClick={() => setSubTab('produtividade')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'produtividade' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <TrendingUp size={16} /> Produtividade
        </button>
      </div>

      {/* IMPORT TAB CONTENT */}
      {subTab === 'importar' && (
        <div className="flex flex-col gap-6">

          {/* GOOGLE SHEETS DIRECT API SYNCHRONIZER (SECURE BACKUP) */}
          <div className="bg-[var(--surface)] border-2 border-[var(--blue-mid)] rounded-2xl p-6 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 bg-[var(--blue-mid)] text-white px-3 py-1 rounded-bl-xl text-[10px] font-black uppercase tracking-wider">
              Backup Seguro
            </div>
            <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Database className="text-[var(--blue-mid)]" size={16} /> Backup Direto no Google Sheets
            </div>
            <p className="text-xs text-[var(--text2)] mb-4 font-semibold leading-relaxed">
              Evite perdas! Faça login com o Google para salvar e sincronizar todos os seus servidores, histórico, respostas rápidas e perguntas frequentes diretamente em uma planilha no seu Google Drive.
            </p>

            {!googleUser ? (
              <div className="bg-[var(--bg)] border border-[var(--border2)] rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[var(--blue-mid)]/10 flex items-center justify-center text-[var(--blue-mid)]">
                  <Key size={24} />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-[var(--text)]">Conectar Conta Google</h4>
                  <p className="text-[10px] text-[var(--text2)] font-semibold mt-1">
                    É necessária autorização de leitura e escrita para salvar a planilha de backup.
                  </p>
                </div>
                <button
                  onClick={onGoogleLogin}
                  className="flex items-center gap-3 px-5 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-xl shadow-xs text-gray-700 font-bold text-xs transition-all duration-200 cursor-pointer"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                  Conectar com o Google
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between p-3 bg-[var(--bg)] border border-[var(--border2)] rounded-xl">
                  <div className="flex items-center gap-3">
                    {googleUser.photoURL ? (
                      <img src={googleUser.photoURL} alt={googleUser.displayName} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-[var(--border2)]" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--blue-mid)] text-white font-bold flex items-center justify-center text-xs">
                        {googleUser.displayName?.[0] || googleUser.email?.[0]}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-black text-[var(--text)]">{googleUser.displayName || "Usuário Conectado"}</div>
                      <div className="text-[10px] text-[var(--text2)] font-semibold">{googleUser.email}</div>
                    </div>
                  </div>
                  <button
                    onClick={onGoogleLogout}
                    className="px-3 py-1.5 border border-red-200 text-red-500 hover:bg-red-50 text-[10px] font-bold rounded-lg cursor-pointer transition-all"
                  >
                    Desconectar
                  </button>
                </div>

                <div className="border border-[var(--border2)] rounded-xl p-4 bg-[var(--bg)]/30">
                  <div className="text-xs font-bold text-[var(--text)] mb-2 flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${state.config.spreadsheetId ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                    {state.config.spreadsheetId ? "Planilha de Backup Ativa" : "Nenhum Backup Criado Ainda"}
                  </div>

                  {state.config.spreadsheetId ? (
                    <div className="flex flex-col gap-3">
                      <div className="p-2.5 bg-[var(--bg)] border border-[var(--border2)] rounded-lg font-mono text-[10px] text-[var(--text2)] break-all select-all flex items-center justify-between">
                        <span>Spreadsheet ID: {state.config.spreadsheetId}</span>
                        <button
                          onClick={() => {
                            if (confirm("Deseja desvincular esta planilha? Seus dados locais permanecerão salvos.")) {
                              updateState(prev => ({ config: { ...prev.config, spreadsheetId: "" } }));
                              onToast("Planilha desvinculada. Você pode buscar ou vincular outra planilha.", "info");
                            }
                          }}
                          className="text-amber-500 hover:text-amber-600 font-bold text-[10px] flex items-center gap-1 cursor-pointer ml-2 flex-shrink-0"
                          title="Desvincular planilha atual para escolher outra"
                        >
                          <Unlink size={12} /> Desvincular
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <button
                          onClick={handleDirectBackupSync}
                          disabled={isGoogleSyncing}
                          className="px-4 py-2 bg-[var(--blue-mid)] hover:bg-[var(--blue)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                          title="Cria todas as abas faltantes na planilha (Produtividade, Fila Avulsa, etc.) e envia os dados do sistema para lá"
                        >
                          <RefreshCw size={14} className={isGoogleSyncing ? "animate-spin" : ""} />
                          Sincronizar (Enviar Dados para a Planilha)
                        </button>
                        <button
                          onClick={handleRestoreFromGoogleBackup}
                          disabled={isGoogleSyncing}
                          className="px-4 py-2 bg-[var(--surface)] hover:bg-[var(--border)] border border-[var(--border2)] disabled:opacity-50 text-[var(--text)] text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                          title="Lê os dados existentes na planilha e traz para o seu navegador"
                        >
                          <DownloadCloud size={14} />
                          Importar (Receber da Planilha)
                        </button>
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${state.config.spreadsheetId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer no-underline"
                        >
                          <FolderOpen size={14} />
                          Abrir no Google Planilhas
                        </a>
                      </div>
                      <p className="text-[10px] text-[var(--text2)] font-semibold mt-1">
                        💡 <strong>Dica:</strong> Para criar as abas novas na sua planilha (Produtividade, Fila Avulsa, Códigos, etc.) e enviar seus dados locais para lá, clique em <strong>"Sincronizar (Enviar Dados para a Planilha)"</strong>.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <p className="text-xs text-[var(--text2)] font-semibold leading-relaxed">
                        Se você já criou uma planilha de backup anteriormente (ou em outro dispositivo), busque-a abaixo no seu Google Drive ou insira o link/ID da planilha para sincronizar seus dados.
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleSearchDriveBackups}
                          disabled={isSearchingDrive || isGoogleSyncing}
                          className="px-4 py-2 bg-[var(--blue-mid)] hover:bg-[var(--blue)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                        >
                          <Search size={14} className={isSearchingDrive ? "animate-spin" : ""} />
                          Procurar Minha Planilha no Google Drive
                        </button>

                        <button
                          onClick={handleDirectBackupSync}
                          disabled={isGoogleSyncing}
                          className="px-4 py-2 bg-[var(--surface)] hover:bg-[var(--border)] border border-[var(--border2)] disabled:opacity-50 text-[var(--text)] text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                        >
                          <Plus size={14} className={isGoogleSyncing ? "animate-spin" : ""} />
                          Criar Nova Planilha do Zero
                        </button>
                      </div>

                      {/* Discovered Drive Files List */}
                      {foundDriveFiles.length > 0 && (
                        <div className="p-3 bg-[var(--bg)] border border-[var(--blue-mid)] rounded-xl flex flex-col gap-2">
                          <div className="text-xs font-bold text-[var(--blue-mid)] flex items-center gap-1.5">
                            <FolderOpen size={14} /> Planilhas Encontradas no Seu Google Drive:
                          </div>
                          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                            {foundDriveFiles.map(file => (
                              <div key={file.id} className="p-2.5 bg-[var(--surface)] border border-[var(--border2)] rounded-lg flex items-center justify-between gap-3 text-xs">
                                <div className="truncate">
                                  <div className="font-extrabold text-[var(--text)] truncate">{file.name}</div>
                                  <div className="text-[10px] text-[var(--text2)] font-mono">
                                    Modificada em: {new Date(file.modifiedTime).toLocaleString('pt-BR')}
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleLinkAndRestoreSpreadsheet(file.id)}
                                  disabled={isGoogleSyncing}
                                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg flex items-center gap-1 cursor-pointer flex-shrink-0"
                                >
                                  <LinkIcon size={12} /> Vincular e Restaurar
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Manual Input for Spreadsheet ID or Link */}
                      <div className="pt-2 border-t border-[var(--border2)] flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1">
                          <LinkIcon size={12} /> Ou cole o link ou ID de uma planilha existente:
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="https://docs.google.com/spreadsheets/d/1ABC.../edit ou ID da planilha"
                            value={manualSheetInput}
                            onChange={(e) => setManualSheetInput(e.target.value)}
                            className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border2)] rounded-xl text-xs text-[var(--text)] focus:outline-none focus:border-[var(--blue-mid)] font-mono"
                          />
                          <button
                            onClick={() => handleLinkAndRestoreSpreadsheet(manualSheetInput)}
                            disabled={!manualSheetInput.trim() || isGoogleSyncing}
                            className="px-4 py-2 bg-[var(--blue-mid)] hover:bg-[var(--blue)] disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer shadow-xs"
                          >
                            <LinkIcon size={14} /> Vincular
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {googleSyncStatus && (
                    <div className="mt-4 p-3 bg-gray-900 border border-gray-800 rounded-lg flex items-center gap-2.5 font-mono text-[10px] leading-relaxed">
                      {isGoogleSyncing && <RefreshCw size={12} className="text-blue-400 animate-spin flex-shrink-0" />}
                      <span className={googleSyncType === 'ok' ? 'text-green-400' : googleSyncType === 'err' ? 'text-red-400' : 'text-blue-400'}>
                        {googleSyncStatus}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* CONFIGURAÇÃO DE SENHA DO SISTEMA */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Key className="text-[var(--blue-mid)]" size={16} /> Senha de Segurança do Sistema
            </div>
            <p className="text-xs text-[var(--text2)] mb-4 font-semibold leading-relaxed">
              Defina a senha numérica de acesso necessária para visualizar e operar este painel de conferência. Senha atual padrão se não configurada: <strong className="font-mono text-[var(--blue-mid)]">456321</strong>.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 max-w-md">
              <div className="relative flex-1">
                <input 
                  type={showPass ? "text" : "password"} 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nova senha (ex: 456321)"
                  className="w-full p-3 text-xs rounded-xl font-mono border border-[var(--border2)] bg-[var(--bg)] outline-none text-[var(--text)] pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-[var(--text2)] hover:text-[var(--text)] cursor-pointer"
                >
                  {showPass ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <button 
                onClick={handleUpdatePassword}
                className="px-5 py-3 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all"
              >
                <Save size={14} /> Atualizar Senha
              </button>
            </div>
            <div className="mt-2 text-[10px] text-[var(--text2)] font-semibold">
              Senha atualmente em uso: <span className="font-mono font-black text-[var(--text)]">{state.config.appPassword || "456321 (Padrão)"}</span>
            </div>
          </div>
          
          {/* 1. GOOGLE SHEETS ACTIVE SYNCHRONIZER (APPS SCRIPT) */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-2 flex items-center gap-2">
              <ServerIcon className="text-[var(--blue-mid)]" size={16} /> Sincronização Ativa com Google Planilhas
            </div>
            <p className="text-xs text-[var(--text2)] mb-4 font-semibold leading-relaxed">
              Integração bidirecional direta via Google Apps Script. Salve e recupere servidores, respostas, dúvidas e todo o estado do sistema na nuvem de forma segura.
            </p>
            
            <div className="flex flex-col md:flex-row gap-3">
              <input 
                type="text" 
                value={gasUrl}
                onChange={(e) => setGasUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 p-3 text-xs rounded-xl font-mono border border-[var(--border2)] bg-[var(--bg)] outline-none"
              />
              
              <div className="flex gap-2">
                <button 
                  onClick={pullFromGAS}
                  disabled={syncingGAS}
                  className="px-4 py-2 bg-[var(--blue-mid)] hover:bg-[var(--blue)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <DownloadCloud size={14} /> Importar da Nuvem
                </button>
                <button 
                  onClick={pushToGAS}
                  disabled={syncingGAS}
                  className="px-4 py-2 bg-[var(--green-mid)] hover:bg-green-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <UploadCloud size={14} /> Enviar para Nuvem
                </button>
              </div>
            </div>

            {/* Expander to install GAS on sheets */}
            <div className="mt-4 border-t border-[var(--border2)] pt-4">
              <button 
                onClick={() => setShowGasHelp(!showGasHelp)}
                className="text-xs font-bold text-[var(--blue-mid)] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {showGasHelp ? "▲ Ocultar instruções de configuração" : "▼ Como configurar a planilha com o Apps Script?"}
              </button>
              
              {showGasHelp && (
                <div className="mt-3 bg-[var(--bg)] border border-[var(--border2)] rounded-xl p-4 text-xs text-[var(--text2)] font-semibold leading-relaxed">
                  <ol className="list-decimal list-inside space-y-2">
                    <li>Abra sua planilha do <strong>Google Sheets</strong> de trabalho.</li>
                    <li>No menu superior, vá em <strong>Extensões &gt; Apps Script</strong>.</li>
                    <li>Apague todo o código existente e cole o código gerado abaixo:</li>
                  </ol>

                  {/* Code Block display with Copy trigger */}
                  <div className="mt-3 relative">
                    <button 
                      onClick={() => {
                        const code = `function doPost(e) {
  var JSON_SHEET_NAME = "App_State_JSON";
  var SERVIDORES_SHEET_NAME = "Servidores";
  var RESPOSTAS_SHEET_NAME = "Respostas";
  var DUVIDAS_SHEET_NAME = "Duvidas";
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var payload = JSON.parse(e.postData.contents);
  var action = payload.action;
  
  if (action === "pull") {
    var state = {};
    
    // 1. Read from App_State_JSON
    var jsonSheet = ss.getSheetByName(JSON_SHEET_NAME);
    if (jsonSheet) {
      try {
        var val = jsonSheet.getRange(1, 1).getValue();
        if (val) state = JSON.parse(val);
      } catch (err) {}
    }
    
    // 2. Read Servidores
    var servSheet = ss.getSheetByName(SERVIDORES_SHEET_NAME);
    if (servSheet) {
      var rows = servSheet.getDataRange().getValues();
      var servidores = [];
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        if (!row[0] && !row[1]) continue;
        servidores.push({
          matricula: String(row[0] || ""),
          nome: String(row[1] || ""),
          cargo: String(row[2] || ""),
          denominacao: String(row[3] || ""),
          codLotacao: String(row[4] || ""),
          lotacao: String(row[5] || ""),
          admissao: String(row[6] || ""),
          situacao: String(row[7] || "")
        });
      }
      state.servidores = servidores;
    }
    
    // 3. Read Respostas
    var respSheet = ss.getSheetByName(RESPOSTAS_SHEET_NAME);
    if (respSheet) {
      var rows = respSheet.getDataRange().getValues();
      var respostas = [];
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        if (!row[0]) continue;
        respostas.push({
          nome: String(row[0] || ""),
          texto: String(row[1] || "")
        });
      }
      state.respostas = respostas;
    }

    // 4. Read Duvidas
    var duvSheet = ss.getSheetByName(DUVIDAS_SHEET_NAME);
    if (duvSheet) {
      var rows = duvSheet.getDataRange().getValues();
      var faq = [];
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        if (!row[0]) continue;
        faq.push({
          titulo: String(row[0] || ""),
          resposta: String(row[1] || "")
        });
      }
      state.faq = faq;
    }
    
    return ContentService.createTextOutput(JSON.stringify(state))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "push") {
    var state = payload.state;
    
    // 1. Save full state to App_State_JSON
    var jsonSheet = ss.getSheetByName(JSON_SHEET_NAME);
    if (!jsonSheet) {
      jsonSheet = ss.insertSheet(JSON_SHEET_NAME);
    }
    jsonSheet.clear();
    jsonSheet.getRange(1, 1).setValue(JSON.stringify(state));
    
    // 2. Save Servidores
    if (state.servidores && state.servidores.length > 0) {
      var servSheet = ss.getSheetByName(SERVIDORES_SHEET_NAME);
      if (!servSheet) {
        servSheet = ss.insertSheet(SERVIDORES_SHEET_NAME);
      }
      servSheet.clear();
      servSheet.appendRow(["Matrícula", "Nome", "Cargo", "Denominação", "Código Lotação", "Lotação", "Admissão", "Situação"]);
      var rowsToAppend = state.servidores.map(function(s) {
        return [s.matricula, s.nome, s.cargo, s.denominacao, s.codLotacao, s.lotacao, s.admissao, s.situacao];
      });
      if (rowsToAppend.length > 0) {
        servSheet.getRange(2, 1, rowsToAppend.length, 8).setValues(rowsToAppend);
      }
    }
    
    // 3. Save Respostas
    if (state.respostas && state.respostas.length > 0) {
      var respSheet = ss.getSheetByName(RESPOSTAS_SHEET_NAME);
      if (!respSheet) {
        respSheet = ss.insertSheet(RESPOSTAS_SHEET_NAME);
      }
      respSheet.clear();
      respSheet.appendRow(["Nome", "Texto"]);
      var rowsToAppend = state.respostas.map(function(r) {
        return [r.nome, r.texto];
      });
      if (rowsToAppend.length > 0) {
        respSheet.getRange(2, 1, rowsToAppend.length, 2).setValues(rowsToAppend);
      }
    }

    // 4. Save Duvidas
    if (state.faq && state.faq.length > 0) {
      var duvSheet = ss.getSheetByName(DUVIDAS_SHEET_NAME);
      if (!duvSheet) {
        duvSheet = ss.insertSheet(DUVIDAS_SHEET_NAME);
      }
      duvSheet.clear();
      duvSheet.appendRow(["Título", "Resposta"]);
      var rowsToAppend = state.faq.map(function(d) {
        return [d.titulo, d.resposta];
      });
      if (rowsToAppend.length > 0) {
        duvSheet.getRange(2, 1, rowsToAppend.length, 2).setValues(rowsToAppend);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput("Serviço de Sincronização NGPESP ativo!")
                       .setMimeType(ContentService.MimeType.TEXT);
}`;
                        navigator.clipboard.writeText(code);
                        onToast("Código copiado para a área de transferência!", "ok");
                      }}
                      className="absolute right-3 top-3 bg-[var(--blue-mid)] hover:bg-[var(--blue)] text-white text-[10px] font-extrabold px-3 py-1.5 rounded-lg shadow-sm"
                    >
                      Copiar Código
                    </button>
                    <pre className="p-3 bg-gray-900 text-green-400 rounded-xl overflow-x-auto font-mono text-[10px] max-h-48 leading-relaxed">
{`function doPost(e) {
  var JSON_SHEET_NAME = "App_State_JSON";
  var SERVIDORES_SHEET_NAME = "Servidores";
  var RESPOSTAS_SHEET_NAME = "Respostas";
  var DUVIDAS_SHEET_NAME = "Duvidas";
  ... (Clique em Copiar para obter o script completo)
}`}
                    </pre>
                  </div>

                  <ol className="list-decimal list-inside space-y-2 mt-4">
                    <li>Clique em <strong>Implantar &gt; Nova implantação</strong> no canto superior direito.</li>
                    <li>Selecione o tipo <strong>App da Web</strong> (ícone de engrenagem).</li>
                    <li>Configure: Executar como <strong>"Você"</strong> e quem pode acessar como <strong>"Qualquer pessoa" (Anyone)</strong>.</li>
                    <li>Clique em <strong>Implantar</strong>, autorize as permissões de acesso do Google e copie a <strong>URL do App da Web</strong> gerada!</li>
                  </ol>
                </div>
              )}
            </div>
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

          {/* 3. JSON STATE BACKUP AND RESTORE */}
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
        <div className="flex flex-col gap-6">
          {/* GMOV renewal tracking calendar alert */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <BellRing size={16} /> Renovação GMOV
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Última renovação realizada</label>
                <input 
                  type="date" 
                  value={state.config.gmov_data}
                  onChange={(e) => handleGmovChange(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-[var(--bg)] font-semibold"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Próxima renovação prevista</label>
                <div className="p-2.5 font-bold text-sm text-[var(--text)]">
                  {getGMOVAlert()?.nextDate || "—"}
                </div>
              </div>
            </div>

            {getGMOVAlert() && (
              <div className={`mt-4 p-3 rounded-lg text-xs font-bold flex items-center gap-2 
                ${getGMOVAlert()?.type === "red" ? 'bg-[var(--red-light)] text-[var(--red)] border border-[var(--red)]' : 
                  getGMOVAlert()?.type === "amber" ? 'bg-[var(--amber-light)] text-[var(--amber-mid)] border border-[var(--amber-mid)]' : 
                  'bg-[var(--green-light)] text-[var(--green-mid)] border border-[var(--green-mid)]'}`}>
                {getGMOVAlert()?.type === "red" ? <AlertTriangle size={14} /> : 
                 getGMOVAlert()?.type === "amber" ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                {getGMOVAlert()?.text}
              </div>
            )}
          </div>

          {/* Processos SEI CRUD */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
              <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                <FolderOpen size={16} /> Processos SEI
              </div>
              <button 
                onClick={() => setSeiForm({ idx: -1, num: "", desc: "" })}
                className="px-3 py-1.5 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg shadow-sm"
              >
                + Novo Processo
              </button>
            </div>

            {seiForm && (
              <div className="p-4 bg-[var(--bg)]/20 border border-[var(--border2)] rounded-xl mb-4 flex flex-col gap-3">
                <div className="text-xs font-bold uppercase text-[var(--text)]">
                  {seiForm.idx >= 0 ? "Editar Processo SEI" : "Novo Processo SEI"}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text2)]">Número SEI</label>
                    <input 
                      type="text" 
                      value={seiForm.num}
                      onChange={(e) => setSeiForm(prev => prev ? { ...prev, num: e.target.value } : null)}
                      placeholder="Ex: 00060-00..."
                      className="w-full p-2 bg-[var(--surface)] text-xs rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text2)]">Descrição / Assunto</label>
                    <input 
                      type="text" 
                      value={seiForm.desc}
                      onChange={(e) => setSeiForm(prev => prev ? { ...prev, desc: e.target.value } : null)}
                      placeholder="Ex: Atestados folha Jan"
                      className="w-full p-2 bg-[var(--surface)] text-xs rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setSeiForm(null)} className="px-3 py-1 bg-white text-xs border border-[var(--border2)] rounded hover:bg-[var(--bg)]">Cancelar</button>
                  <button onClick={salvarSei} className="px-4 py-1 bg-[var(--blue-mid)] text-white text-xs font-bold rounded hover:bg-[var(--blue)]">Salvar</button>
                </div>
              </div>
            )}

            <div className="divide-y divide-[var(--border)]">
              {state.sei.map((s, i) => (
                <div key={i} className="py-3 flex justify-between items-center gap-4 text-xs font-semibold hover:bg-[var(--bg)]/10 px-2 rounded-lg">
                  <div>
                    <div className="font-mono text-[var(--blue-mid)] font-bold">{s.num}</div>
                    <div className="text-[11px] text-[var(--text2)] mt-0.5">{s.desc || "Sem descrição"}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setSeiForm({ idx: i, num: s.num, desc: s.desc })} className="p-1.5 border border-[var(--border)] rounded text-[var(--text2)] hover:bg-[var(--bg)] bg-white"><Edit size={11} /></button>
                    <button onClick={() => excluirSei(i)} className="p-1.5 border border-[var(--border)] rounded text-[var(--red)] hover:bg-[var(--red-light)] bg-white"><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
              {state.sei.length === 0 && (
                <div className="text-center p-4 text-xs text-[var(--text2)]">Nenhum processo cadastrado.</div>
              )}
            </div>
          </div>

          {/* Férias Scheduler period planner */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                <Palmtree size={16} /> Férias programadas
              </div>
              <select 
                value={feriasAno}
                onChange={(e) => setFeriasAno(e.target.value)}
                className="px-2.5 py-1 text-xs font-bold rounded bg-[var(--bg)]"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-4">
              {[0, 1, 2].map((idx) => {
                const yearFerias = state.ferias[feriasAno] || [{}, {}, {}];
                const item = yearFerias[idx] || {};
                return (
                  <div key={idx} className="p-4 bg-[var(--bg)]/15 border border-[var(--border)] rounded-xl flex flex-col gap-3">
                    <div className="text-[10px] font-black text-[var(--text2)] uppercase tracking-wider">Período de Férias {idx + 1}</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-[var(--text2)]">Início</label>
                        <input 
                          type="date" 
                          value={item.inicio || ""}
                          onChange={(e) => handleFeriasChange(idx, "inicio", e.target.value)}
                          className="w-full p-2 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[var(--text2)]">Fim</label>
                        <input 
                          type="date" 
                          value={item.fim || ""}
                          onChange={(e) => handleFeriasChange(idx, "fim", e.target.value)}
                          className="w-full p-2 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[var(--text2)]">Processo SEI</label>
                        <input 
                          type="text" 
                          value={item.processo || ""}
                          onChange={(e) => handleFeriasChange(idx, "processo", e.target.value)}
                          placeholder="SEI..."
                          className="w-full p-2 rounded text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Abonos Days scheduler */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                <CalendarCheck size={16} /> Abonos autorizados
              </div>
              <select 
                value={abonosAno}
                onChange={(e) => setAbonosAno(e.target.value)}
                className="px-2.5 py-1 text-xs font-bold rounded bg-[var(--bg)]"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((idx) => {
                const yearAbonos = state.abonos[abonosAno] || [{}, {}, {}, {}, {}];
                const item = yearAbonos[idx] || {};
                return (
                  <div key={idx} className="p-3 bg-[var(--bg)]/10 border border-[var(--border)] rounded-xl flex items-center justify-between flex-wrap gap-3">
                    <span className="text-[10px] font-black text-[var(--text2)] uppercase">Abono {idx + 1}</span>
                    <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                      <input 
                        type="date" 
                        value={item.data || ""}
                        onChange={(e) => handleAbonosChange(idx, "data", e.target.value)}
                        className="p-1.5 text-xs rounded border border-[var(--border2)]"
                      />
                      <input 
                        type="text" 
                        value={item.processo || ""}
                        onChange={(e) => handleAbonosChange(idx, "processo", e.target.value)}
                        placeholder="Processo SEI..."
                        className="p-1.5 text-xs rounded border border-[var(--border2)] flex-1 font-mono"
                      />
                    </div>
                    {item.data ? (
                      <span className="text-[var(--green-mid)]"><Check size={16} /></span>
                    ) : (
                      <span className="text-xs text-[var(--text2)] italic">Pendente</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Afastamentos leaves tracker planner */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                <Stethoscope size={16} /> Afastamentos / Ausências
              </div>
              <button 
                onClick={() => setAfasForm({ idx: -1, dia: "", mes: new Date().toISOString().slice(0, 7), tipo: "", sisref: "nao" })}
                className="px-3 py-1.5 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg shadow-sm"
              >
                + Registrar afastamento
              </button>
            </div>

            {afasForm && (
              <div className="p-4 bg-[var(--bg)]/20 border border-[var(--border2)] rounded-xl mb-4 flex flex-col gap-3">
                <div className="text-xs font-bold uppercase text-[var(--text)]">Novo Afastamento</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold block mb-0.5">Dia (DD)</label>
                    <input 
                      type="number" 
                      min="1" max="31"
                      value={afasForm.dia}
                      onChange={(e) => setAfasForm(prev => prev ? { ...prev, dia: e.target.value } : null)}
                      placeholder="DD"
                      className="w-full p-2 text-xs rounded border"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold block mb-0.5">Mês / Ano</label>
                    <input 
                      type="month" 
                      value={afasForm.mes}
                      onChange={(e) => setAfasForm(prev => prev ? { ...prev, mes: e.target.value } : null)}
                      className="w-full p-2 text-xs rounded border"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold block mb-0.5">Tipo / Evento</label>
                    <input 
                      type="text" 
                      value={afasForm.tipo}
                      onChange={(e) => setAfasForm(prev => prev ? { ...prev, tipo: e.target.value } : null)}
                      placeholder="Atestado, L.M..."
                      className="w-full p-2 text-xs rounded border"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold block mb-0.5">Lançado SISREF?</label>
                    <select 
                      value={afasForm.sisref}
                      onChange={(e) => setAfasForm(prev => prev ? { ...prev, sisref: e.target.value } : null)}
                      className="w-full p-2 text-xs rounded border font-semibold outline-none bg-white text-[var(--text)]"
                    >
                      <option value="nao">Não</option>
                      <option value="sim">Sim</option>
                      <option value="pendente">Pendente</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAfasForm(null)} className="px-3 py-1 bg-white text-xs border rounded">Cancelar</button>
                  <button onClick={salvarAfas} className="px-4 py-1 bg-[var(--blue-mid)] text-white text-xs font-bold rounded">Salvar</button>
                </div>
              </div>
            )}

            <div className="border border-[var(--border)] rounded-xl overflow-hidden text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[var(--bg)]/40 text-[var(--text2)]">
                    <th className="p-3 text-left w-14">Dia</th>
                    <th className="p-3 text-left w-28">Mês</th>
                    <th className="p-3 text-left">Tipo</th>
                    <th className="p-3 text-left w-24">SISREF</th>
                    <th className="p-3 text-right w-20">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] text-sm font-semibold">
                  {state.afastamentos.map((a, i) => (
                    <tr key={i} className="hover:bg-[var(--bg)]/10 text-xs text-[var(--text)]">
                      <td className="p-3 font-bold text-center">{a.dia}</td>
                      <td className="p-3 font-mono">{a.mes}</td>
                      <td className="p-3">{a.tipo}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${a.sisref === 'sim' ? 'bg-[var(--green-light)] text-[var(--green-mid)]' : 'bg-[var(--red-light)] text-[var(--red)]'}`}>
                          {a.sisref === 'sim' ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setAfasForm({ idx: i, dia: a.dia, mes: a.mes, tipo: a.tipo, sisref: a.sisref })} className="p-1 border bg-white rounded"><Edit size={10} /></button>
                          <button onClick={() => excluirAfas(i)} className="p-1 border bg-white text-[var(--red)] rounded"><Trash2 size={10} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {state.afastamentos.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-xs text-[var(--text2)]">Nenhum afastamento planejado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PRODUTIVIDADE TAB CONTENT */}
      {subTab === 'produtividade' && (
        <div className="flex flex-col gap-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-bold text-[var(--text2)] block mb-1">Data do registro diário</label>
                <input 
                  type="date" 
                  value={prodData}
                  onChange={(e) => setProdData(e.target.value)}
                  className="p-2.5 rounded-xl font-bold bg-[var(--bg)]"
                />
              </div>
              <div className="flex gap-2 items-center flex-wrap pt-2">
                {getDayEscalaBadge()}
                <button 
                  onClick={openCfgForm}
                  className="px-3.5 py-2.5 bg-[var(--surface)] border border-[var(--border2)] rounded-xl flex items-center justify-center text-[var(--text2)] hover:bg-[var(--bg)] transition"
                  title="Configurar campos"
                >
                  <Settings2 size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Configuration Prod Form overlay */}
          {prodCfgOpen && (
            <div className="bg-[var(--surface)] border border-[var(--border)] p-6 rounded-2xl shadow-md">
              <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Settings2 size={16} /> Configurar Produtividade
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-semibold block mb-1">Tipos de Atividade (separados por vírgula)</label>
                  <textarea 
                    value={cfgTipos}
                    onChange={(e) => setCfgTipos(e.target.value)}
                    className="w-full p-2 border rounded-lg text-xs"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Sistemas Usados (separados por vírgula)</label>
                  <textarea 
                    value={cfgSistemas}
                    onChange={(e) => setCfgSistemas(e.target.value)}
                    className="w-full p-2 border rounded-lg text-xs"
                    rows={2}
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setProdCfgOpen(false)} className="flex-1 py-2 text-xs border rounded-lg">Cancelar</button>
                  <button onClick={handleSaveProdConfig} className="flex-1 py-2 text-xs font-bold bg-[var(--blue-mid)] text-white rounded-lg">Salvar</button>
                </div>
              </div>
            </div>
          )}

          {/* Turn sheets lists Manhã vs Tarde */}
          {["normal", "ferias", "abono", "atestado", "afastamento", "folga"].includes(currentDia.situacao) && (
            <div className="flex flex-col gap-6">
              
              {/* Situation Picker */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3">Situação do dia</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {["normal", "ferias", "abono", "atestado", "afastamento", "folga"].map(sit => (
                    <button 
                      key={sit}
                      onClick={() => setSituacaoDia(sit)}
                      className={`py-2 text-xs font-bold rounded-lg border transition ${currentDia.situacao === sit ? 'bg-[var(--blue-mid)] text-white border-[var(--blue-mid)]' : 'bg-white text-[var(--text2)] border-[var(--border)] hover:bg-[var(--bg)]'}`}
                    >
                      {sit === "normal" ? "Dia normal" : 
                       sit === "ferias" ? "Férias" : 
                       sit === "abono" ? "Abono" : 
                       sit === "atestado" ? "Atestado" : 
                       sit === "afastamento" ? "Afastamento" : "Folga/Feriado"}
                    </button>
                  ))}
                </div>
                
                {["ferias", "abono", "atestado", "afastamento"].includes(currentDia.situacao) && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]">
                    <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Anotações / Justificativa</label>
                    <input 
                      type="text" 
                      value={currentDia.sitObs || ""}
                      onChange={(e) => setSituacaoObs(e.target.value)}
                      placeholder="Insira as observações..."
                      className="w-full p-2.5 rounded-lg border text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Manha turn activities block */}
              {currentDia.situacao === "normal" && (
                <>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                    <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1">
                      <Sunrise className="text-[var(--amber-mid)]" size={16} /> Turno da Manhã
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      {(currentDia.manha || []).map((l, idx) => (
                        <div key={idx} className="p-4 bg-[var(--bg)]/15 border border-[var(--border)] rounded-xl flex flex-col gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                            <div className="sm:col-span-1">
                              <label className="text-[10px] font-bold block mb-0.5 text-center">Qtd</label>
                              <input 
                                type="number" 
                                value={l.qtd}
                                onChange={(e) => updateAtividadeField("manha", idx, "qtd", e.target.value)}
                                className={`w-full p-1.5 text-center text-sm font-black rounded border ${l.sistema === 'SEI' ? 'bg-[var(--bg)] text-[var(--text2)]' : 'bg-white'}`}
                                placeholder="0"
                                disabled={l.sistema === 'SEI'}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[10px] font-bold block mb-0.5">Tipo</label>
                              <select 
                                value={l.tipo}
                                onChange={(e) => updateAtividadeField("manha", idx, "tipo", e.target.value)}
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              >
                                {state.filaAvulsa.configProd.tipos.map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[10px] font-bold block mb-0.5">Sistema</label>
                              <select 
                                value={l.sistema}
                                onChange={(e) => updateAtividadeField("manha", idx, "sistema", e.target.value)}
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              >
                                {state.filaAvulsa.configProd.sistemas.map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[10px] font-bold block mb-0.5">Detalhes</label>
                              <input 
                                type="text" 
                                value={l.desc}
                                onChange={(e) => updateAtividadeField("manha", idx, "desc", e.target.value)}
                                placeholder="Ex: atestado, abono..."
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              />
                            </div>
                            <div className="sm:col-span-1 text-right pt-4">
                              <button 
                                onClick={() => removeAtividade("manha", idx)}
                                className="p-2 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-lg bg-white inline-flex"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Dynamic Processos SEI comma-separated input list */}
                          {l.sistema === "SEI" && (
                            <div className="border-t border-dashed border-[var(--border)] pt-2.5 mt-1">
                              <label className="text-[10px] font-bold text-[var(--text2)] block mb-1">
                                Processos SEI (separados por vírgula para quantificação automática)
                              </label>
                              <input 
                                type="text" 
                                value={l.processosSei || ""}
                                onChange={(e) => updateAtividadeField("manha", idx, "processosSei", e.target.value)}
                                placeholder="Ex: 00060-00..., 00060-00..."
                                className="w-full p-2 font-mono text-xs rounded border bg-white"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {(currentDia.manha || []).length === 0 && (
                        <div className="text-center p-4 text-xs text-[var(--text2)]">Nenhuma atividade lançada na manhã.</div>
                      )}
                    </div>

                    <button 
                      onClick={() => addAtividade("manha")}
                      className="w-full py-2 bg-[var(--blue-light)] text-[var(--blue-mid)] hover:bg-[var(--blue-mid)] hover:text-white border border-[rgba(59,130,246,0.2)] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 mt-4 transition-all"
                    >
                      <Plus size={14} /> Adicionar atividade na manhã
                    </button>
                  </div>

                  {/* Tarde turn activities block */}
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                    <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-1">
                      <Sunset className="text-[var(--teal-mid)]" size={16} /> Turno da Tarde
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      {(currentDia.tarde || []).map((l, idx) => (
                        <div key={idx} className="p-4 bg-[var(--bg)]/15 border border-[var(--border)] rounded-xl flex flex-col gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                            <div className="sm:col-span-1">
                              <label className="text-[10px] font-bold block mb-0.5 text-center">Qtd</label>
                              <input 
                                type="number" 
                                value={l.qtd}
                                onChange={(e) => updateAtividadeField("tarde", idx, "qtd", e.target.value)}
                                className={`w-full p-1.5 text-center text-sm font-black rounded border ${l.sistema === 'SEI' ? 'bg-[var(--bg)] text-[var(--text2)]' : 'bg-white'}`}
                                placeholder="0"
                                disabled={l.sistema === 'SEI'}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[10px] font-bold block mb-0.5">Tipo</label>
                              <select 
                                value={l.tipo}
                                onChange={(e) => updateAtividadeField("tarde", idx, "tipo", e.target.value)}
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              >
                                {state.filaAvulsa.configProd.tipos.map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[10px] font-bold block mb-0.5">Sistema</label>
                              <select 
                                value={l.sistema}
                                onChange={(e) => updateAtividadeField("tarde", idx, "sistema", e.target.value)}
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              >
                                {state.filaAvulsa.configProd.sistemas.map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[10px] font-bold block mb-0.5">Detalhes</label>
                              <input 
                                type="text" 
                                value={l.desc}
                                onChange={(e) => updateAtividadeField("tarde", idx, "desc", e.target.value)}
                                placeholder="Ex: atestado, abono..."
                                className="w-full p-1.5 text-xs rounded border bg-white"
                              />
                            </div>
                            <div className="sm:col-span-1 text-right pt-4">
                              <button 
                                onClick={() => removeAtividade("tarde", idx)}
                                className="p-2 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-lg bg-white inline-flex"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Dynamic Processos SEI comma-separated input list */}
                          {l.sistema === "SEI" && (
                            <div className="border-t border-dashed border-[var(--border)] pt-2.5 mt-1">
                              <label className="text-[10px] font-bold text-[var(--text2)] block mb-1">
                                Processos SEI (separados por vírgula para quantificação automática)
                              </label>
                              <input 
                                type="text" 
                                value={l.processosSei || ""}
                                onChange={(e) => updateAtividadeField("tarde", idx, "processosSei", e.target.value)}
                                placeholder="Ex: 00060-00..., 00060-00..."
                                className="w-full p-2 font-mono text-xs rounded border bg-white"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {(currentDia.tarde || []).length === 0 && (
                        <div className="text-center p-4 text-xs text-[var(--text2)]">Nenhuma atividade lançada na tarde.</div>
                      )}
                    </div>

                    <button 
                      onClick={() => addAtividade("tarde")}
                      className="w-full py-2 bg-[var(--blue-light)] text-[var(--blue-mid)] hover:bg-[var(--blue-mid)] hover:text-white border border-[rgba(59,130,246,0.2)] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 mt-4 transition-all"
                    >
                      <Plus size={14} /> Adicionar atividade na tarde
                    </button>
                  </div>

                  {/* Turn summary preview box */}
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                    <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4">
                      Resumo da produção diária ({prodData})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="border border-[var(--border)] p-4 rounded-xl">
                        <div className="text-2xl font-black text-[var(--blue-mid)]">{totalSumProduced}</div>
                        <div className="text-xs text-[var(--text2)] font-bold mt-1 uppercase">Total de Itens Lançados</div>
                      </div>
                      <div className="border border-[var(--border)] p-4 rounded-xl">
                        <div className="text-2xl font-black text-[var(--text)]">{totalActCount}</div>
                        <div className="text-xs text-[var(--text2)] font-bold mt-1 uppercase">Atividades Registradas</div>
                      </div>
                      <div className="border border-[var(--border)] p-4 rounded-xl">
                        <div className="text-sm font-black text-[var(--text)] truncate">{systemUsedStr}</div>
                        <div className="text-xs text-[var(--text2)] font-bold mt-1 uppercase">Sistemas Utilizados</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Monthly log history view list */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                <div className="p-5 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg)]/30 flex-wrap gap-2">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
                    <History size={16} /> Atividade Histórica Mensal
                  </div>
                  <select 
                    value={histFiltroMes}
                    onChange={(e) => setHistFiltroMes(e.target.value)}
                    className="p-1.5 text-xs font-bold rounded"
                  >
                    {monthListOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
                  {listHistoryDates.map(iso => {
                    const diaItem = state.produtividade[iso] || { situacao: "normal", sitObs: "", manha: [], tarde: [] };
                    const isExpanded = expandedHistDia === iso;
                    const items = [...(diaItem.manha || []), ...(diaItem.tarde || [])];
                    const numProds = items.reduce((s, a) => s + (parseInt(String(a.qtd)) || 0), 0);
                    const formattedDate = new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

                    return (
                      <div key={iso} className="flex flex-col">
                        <div 
                          onClick={() => setExpandedHistDia(isExpanded ? null : iso)}
                          className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/10 cursor-pointer text-xs transition"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-sm text-[var(--text)] capitalize">{formattedDate}</span>
                            <span className={`px-2 py-0.5 font-bold rounded-full ${diaItem.situacao === 'normal' ? 'bg-[var(--blue-light)] text-[var(--blue-mid)]' : 'bg-[var(--amber-light)] text-[var(--amber-mid)]'}`}>
                              {diaItem.situacao === "normal" ? "Dia normal" : diaItem.situacao}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[var(--text2)] font-bold">
                            {numProds > 0 && (
                              <span className="text-[var(--blue-mid)]">{numProds} lançamentos</span>
                            )}
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setProdData(iso);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className="px-2 py-1 bg-white border rounded text-[var(--blue-mid)] flex items-center gap-0.5 hover:bg-[var(--blue-light)]"
                            >
                              Editar <ArrowRight size={10} />
                            </button>
                          </div>
                        </div>

                        {isExpanded && items.length > 0 && (
                          <div className="px-5 pb-4 text-xs font-semibold text-[var(--text2)] flex flex-col gap-1.5 bg-[var(--bg)]/5">
                            {items.map((it, actIdx) => (
                              <div key={actIdx} className="flex justify-between border-b border-[var(--border)] border-dashed py-1">
                                <span>{it.tipo} ({it.sistema}) - {it.desc || "Sem detalhes"}</span>
                                <span className="font-black text-[var(--text)]">{it.qtd}x</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {listHistoryDates.length === 0 && (
                    <div className="text-center p-8 text-xs font-bold text-[var(--text2)]">Nenhum registro para o mês filtrado.</div>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      )}

    </div>
  );
}
