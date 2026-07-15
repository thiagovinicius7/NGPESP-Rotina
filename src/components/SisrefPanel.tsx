import React, { useState, useEffect } from "react";
import { AppState, Server, HistoryEntry, QueueServer, QueueOcorrencia } from "../types.js";
import { 
  Building2, ListTodo, MessageSquareQuote, Search, UserCheck, 
  Copy, Check, X, ClipboardList, Trash2, Network, ChevronRight, 
  ArrowLeft, CheckCheck, Users, CopyPlus, CheckSquare, Plus, Save,
  AlertOctagon, CornerUpLeft
} from "lucide-react";

interface SisrefPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
  openModal: (nome: string, mat: string, setor: string, onConfirm: (qtd: number) => void, defaultQtd?: number) => void;
}

export default function SisrefPanel({ state, updateState, onToast, openModal }: SisrefPanelProps) {
  const [subTab, setSubTab] = useState<'setores' | 'avulsa' | 'respostas'>('setores');

  // Setores Sub-tab state
  const [buscaInp, setBuscaInp] = useState("");
  const [buscaSetorInp, setBuscaSetorInp] = useState("");
  const [showBuscaDrop, setShowBuscaDrop] = useState(false);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [buscaObs, setBuscaObs] = useState("");
  const [ccLista, setCcLista] = useState(() => {
    return localStorage.getItem("ss_cc_lista") || "";
  });
  const [setoresData, setSetoresData] = useState<{ codigo: string; nome: string; total: number; conferidos: number }[]>([]);
  const [setorAtual, setSetorAtual] = useState<{ codigo: string; nome: string; total: number; conferidos: number } | null>(null);
  const [setorServs, setSetorServs] = useState<Server[]>([]);
  const [setorIdx, setSetorIdx] = useState(0);
  const [setorObs, setSetorObs] = useState("");
  const [showCopiaLote, setShowCopiaLote] = useState(false);
  const [chkCargos, setChkCargos] = useState<string[]>([]);
  const [copiaLoteSel, setCopiaLoteSel] = useState<Record<string, boolean>>({});

  // Avulsa Sub-tab state
  const [avulsaTxt, setAvulsaTxt] = useState("");
  const [avulsaResultados, setAvulsaResultados] = useState<QueueServer[]>([]);
  const [avulsaSelected, setAvulsaSelected] = useState<Record<number, boolean>>({});
  const [showPendencias, setShowPendencias] = useState(false);

  // Respostas Sub-tab state
  const [respBusca, setRespBusca] = useState("");
  const [respForm, setRespForm] = useState<{ idx: number; nome: string; texto: string } | null>(null);

  // Parse setores on mount or state change
  useEffect(() => {
    const map: Record<string, { codigo: string; nome: string; total: number; conferidos: number }> = {};
    
    // Count conferences from history for today
    const hoje = new Date().toISOString().split('T')[0];
    const conferidosHoje = new Set(
      state.historico
        .filter(h => h.ts && h.ts.startsWith(hoje))
        .map(h => h.mat)
    );

    state.servidores.forEach(s => {
      const cod = String(s.codLotacao || "").trim() || String(s.lotacao || "").trim() || "Sem setor";
      const nom = String(s.lotacao || "").trim();
      const nomeValido = (nom && nom !== cod) ? nom : "";
      
      const isConferido = conferidosHoje.has(s.matricula);

      if (!map[cod]) {
        map[cod] = { codigo: cod, nome: nomeValido, total: 0, conferidos: 0 };
      } else if (!map[cod].nome && nomeValido) {
        map[cod].nome = nomeValido;
      }
      map[cod].total++;
      if (isConferido) {
        map[cod].conferidos++;
      }
    });

    setSetoresData(Object.values(map).sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })));
  }, [state.servidores, state.historico]);

  // Handle Sector Click
  const abrirSetor = (codigo: string) => {
    const sData = setoresData.find(s => s.codigo === codigo);
    if (!sData) return;
    
    const srvs = state.servidores.filter(s => {
      const cod = String(s.codLotacao || "").trim() || String(s.lotacao || "").trim() || "Sem setor";
      return cod === codigo;
    });

    setSetorAtual(sData);
    setSetorServs(srvs);
    setSetorIdx(sData.conferidos);
    setSetorObs("");
    setShowCopiaLote(false);
    setCopiaLoteSel({});
    setChkCargos([]);
  };

  const voltarSetores = () => {
    setSetorAtual(null);
  };

  const copiarTexto = (txt: string) => {
    navigator.clipboard.writeText(txt);
    onToast(`Matrícula copiada: ${txt}`, 'info');
  };

  const confirmarSetorPresenca = () => {
    const curr = setorServs[setorIdx];
    if (!curr) return;

    openModal(curr.nome, curr.matricula, setorAtual?.nome || "", (qtd) => {
      const newEntry: HistoryEntry = {
        mat: curr.matricula,
        nome: curr.nome,
        setor: setorAtual?.nome || "SISREF",
        qtd: qtd,
        ts: new Date().toISOString()
      };

      updateState(prev => ({
        historico: [newEntry, ...prev.historico].slice(0, 500)
      }));

      setSetorIdx(prev => prev + 1);
      setSetorObs("");
      onToast("Presença confirmada!", "ok");
    });
  };

  // CC List actions
  const salvarCCListaLocal = (val: string) => {
    setCcLista(val);
    localStorage.setItem("ss_cc_lista", val);
  };

  const copiarCCLista = () => {
    const normalized = ccLista.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).join(',');
    if (!normalized) {
      onToast("Nenhum código de centro de custo inserido", "err");
      return;
    }
    navigator.clipboard.writeText(normalized);
    onToast("Centros de custo copiados formatados", "ok");
  };

  const limparCCLista = () => {
    setCcLista("");
    localStorage.removeItem("ss_cc_lista");
    onToast("Lista de CC limpa", "info");
  };

  // Batch matrículas copier
  const cargosSetor = Array.from(new Set(setorServs.map(s => String(s.denominacao || s.cargo || "").trim()).filter(Boolean))).sort() as string[];

  const toggleCargoFiltro = (cargo: string) => {
    setChkCargos(prev => {
      const next = prev.includes(cargo) ? prev.filter(c => c !== cargo) : [...prev, cargo];
      return next;
    });
  };

  const getFilteredLoteServs = () => {
    if (chkCargos.length === 0) return setorServs;
    return setorServs.filter(s => chkCargos.includes(String(s.denominacao || s.cargo || "").trim()));
  };

  const copiarLoteMatriculas = () => {
    const selectedMats = Object.keys(copiaLoteSel).filter(k => copiaLoteSel[k]);
    if (selectedMats.length === 0) {
      onToast("Nenhuma matrícula selecionada", "err");
      return;
    }
    navigator.clipboard.writeText(selectedMats.join(','));
    onToast(`${selectedMats.length} matrículas copiadas!`, "ok");
    setShowCopiaLote(false);
  };

  const marcarTodosLote = () => {
    const filtered = getFilteredLoteServs();
    const allChecked = filtered.every(s => copiaLoteSel[s.matricula]);
    const next: Record<string, boolean> = { ...copiaLoteSel };
    filtered.forEach(s => {
      next[s.matricula] = !allChecked;
    });
    setCopiaLoteSel(next);
  };

  // Search autocomplete
  const handleBuscaInput = (val: string) => {
    setBuscaInp(val);
    setShowBuscaDrop(val.trim().length >= 2);
  };

  const filteredSearch = state.servidores.filter(s => 
    s.nome.toLowerCase().includes(buscaInp.toLowerCase()) ||
    s.matricula.includes(buscaInp)
  ).slice(0, 10);

  const selecionarDeBusca = (s: Server) => {
    setSelectedServer(s);
    setBuscaInp(s.nome);
    setShowBuscaDrop(false);
    navigator.clipboard.writeText(String(s.matricula).padStart(8, '0'));
    onToast(`Matrícula ${s.matricula} copiada!`, "info");
  };

  const confirmarBuscaConferencia = () => {
    if (!selectedServer) return;
    openModal(selectedServer.nome, selectedServer.matricula, selectedServer.lotacao || "SISREF", (qtd) => {
      const newEntry: HistoryEntry = {
        mat: selectedServer.matricula,
        nome: selectedServer.nome,
        setor: selectedServer.lotacao || "SISREF",
        qtd: qtd,
        ts: new Date().toISOString()
      };

      updateState(prev => ({
        historico: [newEntry, ...prev.historico].slice(0, 500)
      }));

      setSelectedServer(null);
      setBuscaInp("");
      setBuscaObs("");
      onToast("Presença registrada com sucesso", "ok");
    });
  };

  // Parse SISREF parsed queue
  const parsearSisrefText = () => {
    const txt = avulsaTxt.trim();
    if (!txt) {
      onToast("Cole o texto do SISREF primeiro", "err");
      return;
    }

    const map: Record<string, QueueServer> = {};
    const linhas = txt.split(/\n/);

    linhas.forEach((linha, idx) => {
      const dataMatch = linha.match(/(\d{2}\/\d{2}\/\d{4})/);
      const m = linha.match(/(\d{7,}[A-Z0-9]?)\s*-\s*([A-Za-zÀ-ÿ\s]+)/);

      if (m) {
        const matricula = m[1].trim();
        const nome = m[2].trim().split("Anexado")[0].split("Aprovado")[0].trim();
        
        let tipo = linha.split(m[1])[0].trim();
        if (!tipo || tipo.length < 3) tipo = "Afastamento/Atestado";

        let data = dataMatch ? dataMatch[0] : "";
        if (!data && idx > 0) {
          const dataAnterior = linhas[idx - 1].match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dataAnterior) data = dataAnterior[0];
        }

        if (!map[matricula]) {
          map[matricula] = { matricula, nome, tipos: [], ocorrencias: [] };
        }

        const tipoLimpo = tipo.replace(/Anexado|Aprovado|Pendente|0[0-9]\/202[0-9]/g, "").trim();

        map[matricula].ocorrencias.push({
          tipo: tipoLimpo || "Atestado",
          data: data,
          checked: false
        });

        if (!map[matricula].tipos.includes(tipoLimpo)) {
          map[matricula].tipos.push(tipoLimpo);
        }
      }
    });

    const parsedArr = Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (parsedArr.length === 0) {
      onToast("Não foi possível identificar os dados. Verifique o texto.", "err");
      return;
    }

    setAvulsaResultados(parsedArr);
    const initialSel: Record<number, boolean> = {};
    parsedArr.forEach((_, i) => {
      initialSel[i] = true;
    });
    setAvulsaSelected(initialSel);
    onToast(`${parsedArr.length} servidores identificados!`, "ok");
  };

  const iniciarFilaConferencia = () => {
    const selectedServers = avulsaResultados.filter((_, i) => avulsaSelected[i]);
    if (selectedServers.length === 0) {
      onToast("Selecione pelo menos um servidor para a fila", "err");
      return;
    }

    // Save back to general state under current queue
    updateState(prev => {
      const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
      const updatedListas = { ...prev.filaAvulsa.listas };
      updatedListas[activeQueueName] = {
        fila: selectedServers,
        idx: 0
      };

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: updatedListas
        }
      };
    });

    setAvulsaResultados([]);
    setAvulsaTxt("");
    onToast(`${selectedServers.length} servidores adicionados à fila ativa`, "ok");
  };

  const currentQueue = state.filaAvulsa.listas[state.filaAvulsa.ativa || "Padrão"] || { fila: [], idx: 0 };
  const currentQueueServer = currentQueue.fila[currentQueue.idx];

  const totalServers = currentQueue.fila.length;
  const remainingServers = Math.max(0, totalServers - currentQueue.idx);
  const totalLancamentos = currentQueue.fila.reduce((sum, s) => sum + (s.ocorrencias?.length || 0), 0);
  const lancamentosConcluidosPre = currentQueue.fila.slice(0, currentQueue.idx).reduce((sum, s) => sum + (s.ocorrencias?.length || 0), 0);
  const lancamentosConcluidosCur = currentQueueServer ? currentQueueServer.ocorrencias.filter(o => o.checked).length : 0;
  const lancamentosConcluidos = lancamentosConcluidosPre + lancamentosConcluidosCur;
  const remainingLancamentos = Math.max(0, totalLancamentos - lancamentosConcluidos);

  const toggleOcorrenciaCheck = (ocIdx: number) => {
    updateState(prev => {
      const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
      const q = prev.filaAvulsa.listas[activeQueueName];
      if (!q) return {};

      const nextFila = [...q.fila];
      const nextServer = { ...nextFila[q.idx] };
      const nextOcs = [...nextServer.ocorrencias];
      nextOcs[ocIdx] = { ...nextOcs[ocIdx], checked: !nextOcs[ocIdx].checked };
      nextServer.ocorrencias = nextOcs;
      nextFila[q.idx] = nextServer;

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [activeQueueName]: { ...q, fila: nextFila }
          }
        }
      };
    });
  };

  const confirmarAvulsaServer = () => {
    if (!currentQueueServer) return;
    
    const checkedOcs = currentQueueServer.ocorrencias.filter(o => o.checked);
    const qtdCalculada = checkedOcs.length;

    openModal(currentQueueServer.nome, currentQueueServer.matricula, "SISREF Avulsa", (qtd) => {
      updateState(prev => {
        const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
        const q = prev.filaAvulsa.listas[activeQueueName];
        if (!q) return {};

        // Add history entry
        const newLog: HistoryEntry = {
          mat: currentQueueServer.matricula,
          nome: currentQueueServer.nome,
          setor: "Avulsa Fila",
          qtd: qtd,
          ts: new Date().toISOString()
        };

        return {
          historico: [newLog, ...prev.historico].slice(0, 500),
          filaAvulsa: {
            ...prev.filaAvulsa,
            listas: {
              ...prev.filaAvulsa.listas,
              [activeQueueName]: { ...q, idx: q.idx + 1 }
            }
          }
        };
      });

      onToast("Servidor verificado!", "ok");
    }, qtdCalculada);
  };

  const marcarAvulsaPendente = () => {
    if (!currentQueueServer) return;
    
    const motivo = prompt(`Por que não foi possível realizar o lançamento de ${currentQueueServer.nome}?`);
    if (!motivo) return;

    const pendencia = {
      matricula: currentQueueServer.matricula,
      nome: currentQueueServer.nome,
      tipos: currentQueueServer.tipos,
      ocorrencias: currentQueueServer.ocorrencias,
      motivo: motivo.trim(),
      dataHora: new Date().toLocaleString("pt-BR")
    };

    updateState(prev => {
      const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
      const q = prev.filaAvulsa.listas[activeQueueName];
      if (!q) return {};

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          pendencias: [pendencia, ...prev.filaAvulsa.pendencias],
          listas: {
            ...prev.filaAvulsa.listas,
            [activeQueueName]: { ...q, idx: q.idx + 1 }
          }
        }
      };
    });

    onToast("Adicionado às pendências!", "info");
  };

  const resolverPendencia = (idx: number) => {
    const p = state.filaAvulsa.pendencias[idx];
    
    updateState(prev => {
      const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
      const q = prev.filaAvulsa.listas[activeQueueName] || { fila: [], idx: 0 };
      
      const nextFila = [...q.fila];
      nextFila.splice(q.idx, 0, {
        matricula: p.matricula,
        nome: p.nome,
        tipos: p.tipos,
        ocorrencias: p.ocorrencias
      });

      const nextPendencias = prev.filaAvulsa.pendencias.filter((_, i) => i !== idx);

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          pendencias: nextPendencias,
          listas: {
            ...prev.filaAvulsa.listas,
            [activeQueueName]: {
              fila: nextFila,
              idx: q.idx
            }
          }
        }
      };
    });

    onToast("Servidor reinserido na fila", "ok");
  };

  const removerPendencia = (idx: number) => {
    if (!confirm("Deseja realmente remover esta pendência?")) return;
    updateState(prev => ({
      filaAvulsa: {
        ...prev.filaAvulsa,
        pendencias: prev.filaAvulsa.pendencias.filter((_, i) => i !== idx)
      }
    }));
    onToast("Pendência removida", "info");
  };

  const encerrarFilaAvulsa = () => {
    if (!confirm("Deseja encerrar e limpar a fila de conferência ativa?")) return;
    updateState(prev => {
      const activeQueueName = prev.filaAvulsa.ativa || "Padrão";
      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          listas: {
            ...prev.filaAvulsa.listas,
            [activeQueueName]: { fila: [], idx: 0 }
          }
        }
      };
    });
    onToast("Fila de conferência finalizada", "info");
  };

  // Queue actions
  const criarFilaQueue = () => {
    const nome = prompt("Digite o nome da nova fila de conferência:");
    if (!nome || !nome.trim()) return;
    const fmt = nome.trim();
    if (state.filaAvulsa.listas[fmt]) {
      onToast("Fila já existente", "err");
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
    onToast(`Fila "${fmt}" criada`, "ok");
  };

  const excluirFilaQueue = () => {
    const chaves = Object.keys(state.filaAvulsa.listas);
    if (chaves.length <= 1) {
      onToast("Não é possível excluir a única fila", "err");
      return;
    }
    const ativa = state.filaAvulsa.ativa || "Padrão";
    if (!confirm(`Deseja realmente excluir a fila "${ativa}"?`)) return;

    updateState(prev => {
      const nextListas = { ...prev.filaAvulsa.listas };
      delete nextListas[ativa];
      const proximaAtiva = Object.keys(nextListas)[0];

      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          ativa: proximaAtiva,
          listas: nextListas
        }
      };
    });
    onToast("Fila excluída", "info");
  };

  // Respostas CRUD
  const salvarResposta = () => {
    if (!respForm?.nome || !respForm?.texto) {
      onToast("Preencha título e texto", "err");
      return;
    }
    updateState(prev => {
      const nextArr = [...prev.respostas];
      if (respForm.idx >= 0) {
        nextArr[respForm.idx] = { nome: respForm.nome, texto: respForm.texto };
      } else {
        nextArr.unshift({ nome: respForm.nome, texto: respForm.texto });
      }
      return { respostas: nextArr };
    });
    onToast(respForm.idx >= 0 ? "Resposta atualizada" : "Nova resposta criada", "ok");
    setRespForm(null);
  };

  const excluirResposta = (idx: number) => {
    if (!confirm("Deseja realmente excluir esta resposta?")) return;
    updateState(prev => ({
      respostas: prev.respostas.filter((_, i) => i !== idx)
    }));
    onToast("Resposta excluída", "info");
  };

  const copiarResposta = (texto: string) => {
    navigator.clipboard.writeText(texto);
    onToast("Resposta copiada para a área de transferência", "ok");
  };

  // Total sector stats
  const totalSetoresCount = setoresData.length;
  const concluidoSetoresCount = setoresData.filter(s => s.conferidos >= s.total).length;
  const progressoPct = totalSetoresCount > 0 ? Math.round((concluidoSetoresCount / totalSetoresCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Selectors */}
      <div className="flex p-1 bg-[var(--border)] rounded-xl relative gap-1 select-none">
        <button 
          onClick={() => setSubTab('setores')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'setores' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <Building2 size={16} /> Setores
        </button>
        <button 
          onClick={() => setSubTab('avulsa')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'avulsa' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <ListTodo size={16} /> Avulsa
        </button>
        <button 
          onClick={() => setSubTab('respostas')}
          className={`flex-1 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${subTab === 'respostas' ? 'bg-[var(--surface)] text-[var(--blue-mid)] shadow-sm' : 'text-[var(--text2)]'}`}
        >
          <MessageSquareQuote size={16} /> Respostas
        </button>
      </div>

      {/* SETORES TAB CONTENT */}
      {subTab === 'setores' && (
        <div className="flex flex-col gap-6">
          {!setorAtual ? (
            <>
              {/* Autocomplete Search card */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm relative">
                <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Search size={16} /> Buscar servidor
                </div>
                <div className="relative">
                  <label className="text-sm font-medium text-[var(--text2)] block mb-1">Nome ou matrícula</label>
                  <input 
                    type="text" 
                    value={buscaInp}
                    onChange={(e) => handleBuscaInput(e.target.value)}
                    placeholder="Digite para buscar..." 
                    className="w-full text-base p-3 rounded-xl outline-none"
                  />
                  {showBuscaDrop && filteredSearch.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl mt-1 overflow-hidden shadow-lg max-h-60 overflow-y-auto">
                      {filteredSearch.map(s => (
                        <div 
                          key={s.matricula}
                          onClick={() => selecionarDeBusca(s)}
                          className="p-3 border-b border-[var(--border)] hover:bg-[var(--bg)] cursor-pointer flex justify-between items-center"
                        >
                          <span className="font-mono text-sm text-[var(--text2)]">{s.matricula}</span>
                          <span className="font-semibold text-sm flex-1 ml-3 text-[var(--text)]">{s.nome}</span>
                          <span className="text-xs font-medium text-[var(--blue-mid)] bg-[var(--blue-light)] px-2 py-1 rounded">{s.lotacao}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Server Card */}
              {selectedServer && (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-2">
                    <UserCheck size={16} /> Servidor selecionado
                  </div>
                  <div className="bg-[var(--blue-light)] border border-[rgba(37,99,235,0.2)] rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <div className="text-base font-bold text-[var(--text)]">{selectedServer.nome}</div>
                      <div className="text-xs font-semibold text-[var(--blue-mid)] mt-1 font-mono">
                        {selectedServer.matricula} · {selectedServer.cargo}
                      </div>
                    </div>
                    <button 
                      onClick={() => copiarTexto(selectedServer.matricula)}
                      className="border border-[rgba(37,99,235,0.3)] bg-[var(--surface)] text-[var(--blue-mid)] text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[var(--blue-mid)] hover:text-white transition flex items-center gap-1 shadow-sm"
                    >
                      <Copy size={12} /> Copiar mat.
                    </button>
                  </div>
                  <div className="mt-4">
                    <label className="text-sm font-medium text-[var(--text2)] block mb-1">Observação (opcional)</label>
                    <input 
                      type="text" 
                      value={buscaObs}
                      onChange={(e) => setBuscaObs(e.target.value)}
                      placeholder="Ex: atestado, falta..."
                      className="w-full text-base p-3 rounded-xl outline-none"
                    />
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button 
                      onClick={confirmarBuscaConferencia}
                      className="flex-1 py-3 text-sm font-bold bg-[var(--blue)] text-white rounded-xl hover:bg-[var(--blue-mid)] flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Check size={16} /> Confirmar conferência
                    </button>
                    <button 
                      onClick={() => setSelectedServer(null)}
                      className="p-3 border border-[var(--red)] text-[var(--red)] bg-[var(--surface)] hover:bg-[var(--red-light)] rounded-xl"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Progress and Cost Centers */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-2">
                    <Building2 size={16} /> Progresso geral
                  </div>
                  <span className="text-sm font-bold text-[var(--text2)]">{concluidoSetoresCount} / {totalSetoresCount} setores ({progressoPct}%)</span>
                </div>
                <div className="w-full bg-[var(--border)] h-2.5 rounded-full overflow-hidden">
                  <div className="bg-[var(--blue-mid)] h-full transition-all duration-500" style={{ width: `${progressoPct}%` }}></div>
                </div>
              </div>

              {/* Copier Panel */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ClipboardList size={16} /> Centros de Custo para Cópia (SISREF)
                </div>
                <textarea 
                  value={ccLista}
                  onChange={(e) => salvarCCListaLocal(e.target.value)}
                  placeholder="Cole os códigos dos centros de custo aqui (separados por vírgula ou um por linha)..."
                  className="w-full p-3 font-mono text-sm rounded-xl min-h-20 resize-y mb-3"
                />
                <div className="flex gap-3">
                  <button 
                    onClick={copiarCCLista}
                    className="flex-1 py-2.5 text-xs font-semibold bg-[var(--blue)] text-white rounded-lg flex items-center justify-center gap-1 hover:bg-[var(--blue-mid)]"
                  >
                    <Copy size={14} /> Copiar Formatado
                  </button>
                  <button 
                    onClick={limparCCLista}
                    className="py-2.5 px-4 text-xs font-semibold bg-[var(--surface)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-lg flex items-center justify-center gap-1"
                  >
                    <Trash2 size={14} /> Limpar
                  </button>
                </div>
              </div>

              {/* Sectors List */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                <div className="p-5 border-b border-[var(--border)] bg-[var(--bg)]/50">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Network size={16} /> Centros de Custo
                  </div>
                  <input 
                    type="text" 
                    value={buscaSetorInp}
                    onChange={(e) => setBuscaSetorInp(e.target.value)}
                    placeholder="🔍 Buscar código ou nome do setor..." 
                    className="w-full p-2.5 text-sm rounded-lg"
                  />
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {setoresData.filter(s => 
                    s.codigo.includes(buscaSetorInp) || 
                    s.nome.toLowerCase().includes(buscaSetorInp.toLowerCase())
                  ).map(s => {
                    const isDone = s.conferidos >= s.total;
                    return (
                      <div 
                        key={s.codigo}
                        onClick={() => abrirSetor(s.codigo)}
                        className={`p-4 flex items-center justify-between hover:bg-[var(--bg)]/30 cursor-pointer transition-all ${isDone ? 'opacity-60' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-0.5 rounded">
                              {s.codigo}
                            </span>
                            <span className="font-bold text-[var(--text)] text-sm truncate">
                              {s.nome || "Sem nome importado"}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--text2)] mt-1 flex items-center gap-1">
                            <Users size={12} /> {s.total} servidor{s.total !== 1 ? 'es' : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {isDone ? (
                            <span className="text-xs font-semibold bg-[var(--green-light)] text-[var(--green-mid)] px-2 py-1 rounded-full flex items-center gap-0.5">
                              <Check size={12} /> Concluído
                            </span>
                          ) : (
                            <span className="text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] px-2.5 py-1 rounded-full">
                              {s.conferidos} / {s.total}
                            </span>
                          )}
                          <ChevronRight size={18} className="text-[var(--text2)]" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* ACTIVE SECTOR DETAIL VIEW */
            <div className="flex flex-col gap-6">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-4 mb-4">
                  <button 
                    onClick={voltarSetores}
                    className="p-2 border border-[var(--border)] rounded-xl hover:bg-[var(--bg)] transition"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-[var(--text)] truncate">{setorAtual.nome || "Setor sem Nome"}</h3>
                    <div className="text-xs font-semibold text-[var(--text2)] mt-0.5">Lotação: {setorAtual.codigo}</div>
                  </div>
                </div>
                <div className="flex justify-between text-xs font-bold text-[var(--text2)] mb-2 uppercase">
                  <span>Progresso do Setor</span>
                  <span>{setorIdx} de {setorServs.length} conferidos</span>
                </div>
                <div className="w-full bg-[var(--border)] h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-[var(--blue-mid)] h-full transition-all duration-500" 
                    style={{ width: `${setorServs.length > 0 ? (setorIdx / setorServs.length) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>

              {/* Checking Box */}
              {setorIdx < setorServs.length ? (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3">Conferir agora</div>
                  <div className="bg-[var(--blue-light)] border border-[rgba(37,99,235,0.2)] rounded-xl p-4 flex justify-between items-center mb-4">
                    <div className="min-w-0">
                      <div className="text-base font-bold text-[var(--text)] truncate">{setorServs[setorIdx].nome}</div>
                      <div className="text-xs font-semibold text-[var(--blue-mid)] font-mono mt-1">
                        {setorServs[setorIdx].matricula} · {setorServs[setorIdx].cargo || "—"}
                      </div>
                    </div>
                    <button 
                      onClick={() => copiarTexto(setorServs[setorIdx].matricula)}
                      className="border border-[rgba(37,99,235,0.3)] bg-[var(--surface)] text-[var(--blue-mid)] text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[var(--blue-mid)] hover:text-white transition flex items-center gap-1 shadow-sm"
                    >
                      <Copy size={12} /> Copiar
                    </button>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--text2)] block mb-1">Observação (opcional)</label>
                    <input 
                      type="text" 
                      value={setorObs}
                      onChange={(e) => setSetorObs(e.target.value)}
                      placeholder="Ex: atestado, falta..."
                      className="w-full text-base p-3 rounded-xl outline-none"
                    />
                  </div>
                  <button 
                    onClick={confirmarSetorPresenca}
                    className="w-full py-3 mt-4 text-sm font-bold bg-[var(--green-mid)] text-white rounded-xl hover:bg-[var(--green)] flex items-center justify-center gap-2 shadow-sm"
                  >
                    <CheckCheck size={18} /> Confirmar presença
                  </button>
                </div>
              ) : (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 shadow-sm text-center">
                  <CheckCheck className="text-[var(--green-mid)] mx-auto mb-3" size={48} />
                  <div className="font-bold text-lg text-[var(--text)]">Todo o setor conferido!</div>
                  <p className="text-sm text-[var(--text2)] mt-1">Ótimo trabalho! Todos os servidores deste setor foram conferidos hoje.</p>
                </div>
              )}

              {/* Copiar lote panel */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-[var(--border)] flex justify-between items-center flex-wrap gap-2">
                  <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-2">
                    <Users size={16} /> Lista de Servidores
                  </div>
                  <button 
                    onClick={() => setShowCopiaLote(prev => !prev)}
                    className="text-xs font-semibold bg-[var(--blue-light)] text-[var(--blue-mid)] hover:bg-[var(--blue-mid)] hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all"
                  >
                    <CopyPlus size={14} /> Copiar Matrículas em Lote
                  </button>
                </div>

                {/* Batch copies expander */}
                {showCopiaLote && (
                  <div className="p-5 bg-[var(--bg)]/40 border-b border-[var(--border)] flex flex-col gap-4">
                    <div className="flex gap-2 flex-wrap items-center">
                      <span className="text-xs font-bold text-[var(--text2)] mr-2 uppercase">Filtrar por Cargo:</span>
                      {cargosSetor.map(cargo => {
                        const isChecked = chkCargos.includes(cargo);
                        return (
                          <button 
                            key={cargo}
                            onClick={() => toggleCargoFiltro(cargo)}
                            className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${isChecked ? 'bg-[var(--blue-mid)] text-white border-[var(--blue-mid)]' : 'bg-[var(--surface)] text-[var(--text2)] border-[var(--border)] hover:bg-[var(--bg)]'}`}
                          >
                            {cargo}
                          </button>
                        );
                      })}
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-[var(--border)] bg-[var(--surface)] rounded-xl p-2 divide-y divide-[var(--border)]">
                      {getFilteredLoteServs().map(s => {
                        const isSelected = !!copiaLoteSel[s.matricula];
                        return (
                          <label 
                            key={s.matricula}
                            className="flex items-center gap-3 p-2 hover:bg-[var(--bg)]/30 cursor-pointer text-sm font-semibold text-[var(--text)]"
                          >
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={(e) => setCopiaLoteSel(prev => ({ ...prev, [s.matricula]: e.target.checked }))}
                              className="w-4.5 h-4.5 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{s.nome}</div>
                              <div className="text-xs text-[var(--text2)] font-mono">{s.matricula} · {s.cargo || "—"}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={marcarTodosLote}
                        className="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text2)] text-xs font-bold rounded-lg hover:bg-[var(--bg)]"
                      >
                        Marcar / Desmarcar Todos
                      </button>
                      <button 
                        onClick={copiarLoteMatriculas}
                        className="flex-1 py-2 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1 shadow-sm"
                      >
                        <Copy size={14} /> Copiar Matrículas Selecionadas
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-list detail */}
                <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
                  {setorServs.map((s, idx) => {
                    const isConferido = idx < setorIdx;
                    const isCurrent = idx === setorIdx;
                    return (
                      <div 
                        key={s.matricula}
                        className={`p-4 flex items-center justify-between ${isConferido ? 'bg-[var(--bg)]/20 opacity-60' : isCurrent ? 'bg-[var(--blue-light)]/40 border-l-4 border-[var(--blue)]' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-xs font-bold text-[var(--text2)] w-6 text-center">{idx + 1}</span>
                          <div>
                            <div className="font-bold text-sm text-[var(--text)]">{s.nome}</div>
                            <div className="text-xs text-[var(--text2)] font-mono mt-0.5">{s.matricula}</div>
                          </div>
                        </div>
                        {isConferido && (
                          <span className="text-[var(--green-mid)]">
                            <CheckCheck size={18} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AVULSA TAB CONTENT */}
      {subTab === 'avulsa' && (
        <div className="flex flex-col gap-6">
          {/* Active Queue Config */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm flex justify-between items-center flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-[var(--text2)] uppercase tracking-wider">Fila Ativa:</span>
              <select 
                value={state.filaAvulsa.ativa || "Padrão"}
                onChange={(e) => updateState(prev => ({ filaAvulsa: { ...prev.filaAvulsa, ativa: e.target.value } }))}
                className="font-bold px-3 py-1.5 rounded-lg outline-none cursor-pointer text-sm"
              >
                {Object.keys(state.filaAvulsa.listas).map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowPendencias(prev => !prev)}
                className={`text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1 transition-all border ${state.filaAvulsa.pendencias.length > 0 ? 'bg-[var(--red-light)] text-[var(--red)] border-[var(--red)]' : 'bg-[var(--bg)] text-[var(--text2)] border-[var(--border)]'}`}
              >
                <AlertOctagon size={14} /> Pendências ({state.filaAvulsa.pendencias.length})
              </button>
              <button 
                onClick={criarFilaQueue}
                className="text-xs font-bold bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)] px-3 py-2 rounded-lg"
              >
                + Nova Fila
              </button>
              <button 
                onClick={excluirFilaQueue}
                className="text-xs font-bold bg-[var(--surface)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] px-3 py-2 rounded-lg"
              >
                Excluir Fila
              </button>
            </div>
          </div>

          {/* Expanded Pendencias Card */}
          {showPendencias && state.filaAvulsa.pendencias.length > 0 && (
            <div className="bg-[var(--surface)] border-t-4 border-[var(--red)] border-x border-b border-[var(--border)] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
              <div className="text-sm font-bold text-[var(--red)] uppercase tracking-wider">
                Fila de Pendências Pendentes
              </div>
              <div className="divide-y divide-[var(--border)] max-h-60 overflow-y-auto border border-[var(--border)] rounded-xl bg-[var(--bg)]/10">
                {state.filaAvulsa.pendencias.map((p, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between hover:bg-[var(--bg)]/20">
                    <div className="min-w-0 flex-1 pr-4">
                      <div className="font-bold text-sm text-[var(--text)]">{p.nome}</div>
                      <div className="text-xs text-[var(--text2)] font-mono mt-0.5">
                        {p.matricula} · {p.ocorrencias.length} ocorrência(s)
                      </div>
                      <div className="text-xs font-bold text-[var(--red)] mt-2 italic">
                        Motivo: {p.motivo}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => resolverPendencia(idx)}
                        className="px-3 py-1.5 text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] border border-[rgba(59,130,246,0.2)] rounded-lg hover:bg-[var(--blue-mid)] hover:text-white transition flex items-center gap-0.5"
                      >
                        <CornerUpLeft size={12} /> Reatar
                      </button>
                      <button 
                        onClick={() => removerPendencia(idx)}
                        className="px-3 py-1.5 text-xs font-bold bg-[var(--surface)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-lg"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fila Import Workflow Area */}
          {currentQueue.fila.length === 0 ? (
            /* Paste area if active queue has no items */
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-1 rounded">
                  SISREF Import
                </span>
                <span className="text-xs font-semibold text-[var(--text2)]">Cole o relatório de pendências do SISREF</span>
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--text2)] block mb-1">Texto copiado do SISREF</label>
                <textarea 
                  value={avulsaTxt}
                  onChange={(e) => setAvulsaTxt(e.target.value)}
                  placeholder="Cole aqui o conteúdo copiado do SISREF (incluindo matrículas e atestados)..."
                  className="w-full p-3 text-sm rounded-xl min-h-40 resize-y"
                />
              </div>
              <button 
                onClick={parsearSisrefText}
                className="py-3 text-sm font-bold bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white rounded-xl flex items-center justify-center gap-2 shadow-sm"
              >
                <ListTodo size={16} /> Gerar fila de conferência
              </button>

              {/* Parsed results checklist matrix */}
              {avulsaResultados.length > 0 && (
                <div className="border border-[var(--border)] rounded-xl mt-4 overflow-hidden">
                  <div className="p-4 bg-[var(--bg)]/50 border-b border-[var(--border)] flex justify-between items-center flex-wrap gap-2">
                    <span className="text-xs font-bold text-[var(--text2)] uppercase">
                      {avulsaResultados.length} Servidor(es) com pendências
                    </span>
                    <button 
                      onClick={() => {
                        const allSel = avulsaResultados.every((_, i) => avulsaSelected[i]);
                        const next: Record<number, boolean> = {};
                        avulsaResultados.forEach((_, i) => {
                          next[i] = !allSel;
                        });
                        setAvulsaSelected(next);
                      }}
                      className="text-xs font-semibold bg-[var(--surface)] border border-[var(--border)] px-3 py-1 rounded-lg"
                    >
                      Selecionar Todos
                    </button>
                  </div>
                  <div className="divide-y divide-[var(--border)] max-h-60 overflow-y-auto">
                    {avulsaResultados.map((r, i) => (
                      <div 
                        key={i}
                        onClick={() => setAvulsaSelected(prev => ({ ...prev, [i]: !prev[i] }))}
                        className={`p-3.5 flex items-center gap-3 cursor-pointer hover:bg-[var(--bg)]/20 ${avulsaSelected[i] ? 'bg-[var(--blue-light)]/20' : ''}`}
                      >
                        <input 
                          type="checkbox" 
                          checked={!!avulsaSelected[i]}
                          onChange={() => {}} // handled by click container
                          className="w-4.5 h-4.5 rounded"
                        />
                        <span className="font-mono text-xs font-bold text-[var(--text2)] min-w-20">{r.matricula}</span>
                        <span className="font-bold text-sm text-[var(--text)] flex-1 truncate">{r.nome}</span>
                        <span className="text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-0.5 rounded truncate">
                          {r.tipos.join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-[var(--bg)] border-t border-[var(--border)]">
                    <button 
                      onClick={iniciarFilaConferencia}
                      className="w-full py-3 text-sm font-bold bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white rounded-xl flex items-center justify-center gap-2 shadow-sm"
                    >
                      Carregar {avulsaResultados.filter((_, i) => avulsaSelected[i]).length} servidores na fila ativa <CheckSquare size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Active queue conferência workflow */
            <div className="flex flex-col gap-6">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                <div className="p-5 border-b border-[var(--border)] flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[var(--text2)] uppercase flex items-center gap-1">
                      <ListTodo size={14} /> Fila de conferência
                    </span>
                    <span className="text-xs font-bold text-[var(--blue-mid)] bg-[var(--blue-light)] px-2 py-0.5 rounded-full">
                      Fila: {state.filaAvulsa.ativa || "Padrão"}
                    </span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--border2)] flex flex-col gap-1.5 text-xs text-[var(--text2)] font-semibold">
                    <div className="flex justify-between items-center flex-wrap gap-1">
                      <span>Servidores na fila:</span>
                      <span className="font-bold text-[var(--text)] text-right">
                        faltam {remainingServers} servidores de {totalServers} total de servidores na fila
                      </span>
                    </div>
                    <div className="flex justify-between items-center flex-wrap gap-1">
                      <span>Lançamentos na fila:</span>
                      <span className="font-bold text-[var(--text)] text-right">
                        faltam {remainingLancamentos} lançamentos de {totalLancamentos} total de lançamentos na fila
                      </span>
                    </div>
                  </div>
                </div>

                {/* Active check card */}
                {currentQueueServer ? (
                  <div className="p-6 bg-[var(--blue-light)]/20 border-b border-[var(--border)] flex flex-col gap-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold text-[var(--text)] truncate">{currentQueueServer.nome}</div>
                        <div className="text-xs font-bold text-[var(--blue-mid)] font-mono mt-1">
                          Matrícula: {currentQueueServer.matricula}
                        </div>
                        <div className="text-xs font-semibold text-[var(--text2)] mt-1 truncate">
                          Tipos: {currentQueueServer.tipos.join(' · ')}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button 
                          onClick={() => copiarTexto(currentQueueServer.matricula)}
                          className="px-3 py-1.5 bg-white border border-[rgba(37,99,235,0.2)] text-[var(--blue-mid)] hover:bg-[var(--blue-mid)] hover:text-white text-xs font-bold rounded-lg transition"
                        >
                          Copiar mat.
                        </button>
                        <button 
                          onClick={confirmarAvulsaServer}
                          className="px-3 py-1.5 bg-[var(--green-mid)] text-white hover:bg-[var(--green)] text-xs font-bold rounded-lg transition"
                        >
                          Confirmar
                        </button>
                        <button 
                          onClick={marcarAvulsaPendente}
                          className="px-3 py-1.5 bg-[var(--red-light)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-white text-xs font-bold rounded-lg transition"
                        >
                          Pendente
                        </button>
                      </div>
                    </div>

                    {/* Checkboxes grid for doctor cert list */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 border-t border-[var(--border)] pt-4">
                      {currentQueueServer.ocorrencias.map((oc, i) => (
                        <label 
                          key={i}
                          className="flex items-center gap-3 p-2 bg-[var(--surface)] hover:bg-[var(--bg)]/20 border border-[var(--border)] rounded-xl cursor-pointer"
                        >
                          <input 
                            type="checkbox" 
                            checked={!!oc.checked}
                            onChange={() => toggleOcorrenciaCheck(i)}
                            className="w-5 h-5 rounded"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-bold text-[var(--text)] block truncate">{oc.tipo}</span>
                            {oc.data ? (
                              <span className="text-xs font-semibold text-[var(--blue-mid)] font-mono block mt-0.5">
                                Data: {oc.data}
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-[var(--red)] block mt-0.5">
                                Data não identificada
                              </span>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Completed Fila */
                  <div className="p-8 text-center bg-[var(--green-light)]/20">
                    <CheckCheck size={48} className="text-[var(--green-mid)] mx-auto mb-3" />
                    <div className="font-bold text-lg text-[var(--text)]">Fila Concluída!</div>
                    <p className="text-sm text-[var(--text2)] mt-1 mb-4">Todos os servidores desta fila foram verificados com sucesso.</p>
                  </div>
                )}

                {/* Queue Servers List */}
                <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border)]">
                  {currentQueue.fila.map((s, i) => {
                    const isDone = i < currentQueue.idx;
                    const isCurrent = i === currentQueue.idx;
                    return (
                      <div 
                        key={i}
                        className={`p-4 flex items-center justify-between ${isDone ? 'bg-[var(--bg)]/20 opacity-55' : isCurrent ? 'bg-[var(--blue-light)]/30 border-l-4 border-[var(--blue)]' : ''}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-xs text-[var(--text2)] w-6 text-center">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-[var(--text)] truncate">{s.nome}</div>
                            <div className="text-xs text-[var(--text2)] font-mono">{s.matricula}</div>
                          </div>
                        </div>
                        {isDone && (
                          <span className="text-[var(--green-mid)]">
                            <CheckCheck size={18} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="p-4 bg-[var(--bg)] border-t border-[var(--border)]">
                  <button 
                    onClick={encerrarFilaAvulsa}
                    className="w-full py-2.5 text-xs font-bold bg-[var(--surface)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-xl flex items-center justify-center gap-1 shadow-sm"
                  >
                    <Trash2 size={14} /> Encerrar Fila Ativa
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RESPOSTAS TAB CONTENT */}
      {subTab === 'respostas' && (
        <div className="flex flex-col gap-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
            <div className="flex gap-3 mb-4">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
                <input 
                  type="text" 
                  value={respBusca}
                  onChange={(e) => setRespBusca(e.target.value)}
                  placeholder="Pesquisar respostas rápidas..."
                  className="w-full p-3 pl-10 rounded-xl"
                />
              </div>
              <button 
                onClick={() => setRespForm({ idx: -1, nome: "", texto: "" })}
                className="px-4 py-3 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white font-bold rounded-xl flex items-center gap-1 shadow-sm"
              >
                <Plus size={16} /> Nova
              </button>
            </div>

            {/* Editing form */}
            {respForm && (
              <div className="border border-[var(--border)] rounded-xl p-5 mb-4 bg-[var(--bg)]/10">
                <div className="text-sm font-bold text-[var(--text)] mb-3 uppercase flex items-center gap-1">
                  <Save size={16} /> {respForm.idx >= 0 ? "Editar Resposta" : "Nova Resposta Rápida"}
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Título / Descrição</label>
                    <input 
                      type="text" 
                      value={respForm.nome}
                      onChange={(e) => setRespForm(prev => prev ? { ...prev, nome: e.target.value } : null)}
                      placeholder="Ex: Retorno de atestado"
                      className="w-full p-2.5 rounded-lg bg-[var(--surface)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Texto da Resposta</label>
                    <textarea 
                      value={respForm.texto}
                      onChange={(e) => setRespForm(prev => prev ? { ...prev, texto: e.target.value } : null)}
                      placeholder="Digite a resposta completa para copiar..."
                      className="w-full p-2.5 rounded-lg bg-[var(--surface)] min-h-24 resize-y"
                    />
                  </div>
                  <div className="flex gap-3 justify-end mt-2">
                    <button 
                      onClick={() => setRespForm(null)}
                      className="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text2)] text-xs font-bold rounded-lg"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={salvarResposta}
                      className="px-5 py-2 bg-[var(--blue)] text-white text-xs font-bold rounded-lg"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* List responses */}
            <div className="divide-y divide-[var(--border)]">
              {state.respostas
                .filter(r => r.nome.toLowerCase().includes(respBusca.toLowerCase()) || r.texto.toLowerCase().includes(respBusca.toLowerCase()))
                .map((r, i) => (
                  <div key={i} className="py-4 flex justify-between items-start gap-4 hover:bg-[var(--bg)]/10 px-2 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[var(--text)] text-sm">{r.nome}</div>
                      <p className="text-xs text-[var(--text2)] font-medium mt-1 line-clamp-3 leading-relaxed">
                        {r.texto}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button 
                        onClick={() => copiarResposta(r.texto)}
                        className="p-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--blue-light)] rounded-lg text-[var(--blue-mid)]"
                        title="Copiar texto"
                      >
                        <Copy size={14} />
                      </button>
                      <button 
                        onClick={() => setRespForm({ idx: i, nome: r.nome, texto: r.texto })}
                        className="p-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] rounded-lg text-[var(--text2)]"
                        title="Editar"
                      >
                        <Plus size={14} className="rotate-45" /> {/* just edit icon */}
                      </button>
                      <button 
                        onClick={() => excluirResposta(i)}
                        className="p-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--red-light)] rounded-lg text-[var(--red)]"
                        title="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              {state.respostas.length === 0 && (
                <div className="text-center p-8 text-[var(--text2)]">
                  Nenhuma resposta rápida cadastrada ainda.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
