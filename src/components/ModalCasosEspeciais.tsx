import React, { useState, useMemo } from "react";
import { AppState, Server, CasoEspecialItem } from "../types.js";
import { formatMatricula, normalizeMatricula } from "../lib/utils.js";
import { 
  X, Plus, Trash2, Edit3, Search, Star, AlertTriangle, 
  Copy, Check, FileText, CheckCircle2, ShieldAlert, ArrowRight, CornerDownLeft
} from "lucide-react";

interface ModalCasosEspeciaisProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

const PRESET_MOTIVOS = [
  "Contrato Temporário",
  "Horário Especial",
  "Afastamento Singular",
  "Processo SEI",
  "Atenção Especial no SISREF"
];

export default function ModalCasosEspeciais({
  isOpen,
  onClose,
  state,
  updateState,
  onToast
}: ModalCasosEspeciaisProps) {
  const [activeTab, setActiveTab] = useState<'lista' | 'incluir' | 'lote'>('lista');
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedMat, setCopiedMat] = useState<string | null>(null);

  // Form for single addition
  const [matriculaInp, setMatriculaInp] = useState("");
  const [nomeInp, setNomeInp] = useState("");
  const [motivoInp, setMotivoInp] = useState("Contrato Temporário");
  const [obsInp, setObsInp] = useState("");

  // Form for batch paste
  const [loteTxt, setLoteTxt] = useState("");
  const [loteMotivo, setLoteMotivo] = useState("Contrato Temporário");

  // Editing state
  const [editingItem, setEditingItem] = useState<CasoEspecialItem | null>(null);
  const [editMat, setEditMat] = useState("");
  const [editNome, setEditNome] = useState("");
  const [editMotivo, setEditMotivo] = useState("");
  const [editObs, setEditObs] = useState("");

  const casosList: CasoEspecialItem[] = useMemo(() => {
    return state.config?.casosEspeciais || state.casosEspeciais || [];
  }, [state.config?.casosEspeciais, state.casosEspeciais]);

  // Lookup server when matricula changes in single add
  const matchedServer = useMemo(() => {
    const formatted = formatMatricula(matriculaInp);
    const norm = normalizeMatricula(formatted);
    if (!norm) return null;
    return (state.servidores || []).find(s => normalizeMatricula(s.matricula) === norm) || null;
  }, [matriculaInp, state.servidores]);

  // Parse batch items
  const parsedLote = useMemo(() => {
    if (!loteTxt.trim()) return [];
    const lines = loteTxt.split(/\n/);
    const results: { matricula: string; nome: string; motivo: string; existe: boolean }[] = [];
    const existingNorms = new Set(casosList.map(c => normalizeMatricula(c.matricula)));

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Extract matricula: match numbers with 6 to 9 digits, or digits possibly with X
      const matMatch = trimmed.match(/\b(\d{6,9}[a-zA-Z]?)\b/);
      let mat = matMatch ? matMatch[1] : "";

      if (!mat) {
        // Try any clean numbers
        const cleanOnly = trimmed.replace(/\D/g, "");
        if (cleanOnly.length >= 6) {
          mat = cleanOnly;
        }
      }

      if (mat) {
        const formatted = formatMatricula(mat);
        const norm = normalizeMatricula(formatted);
        const srv = (state.servidores || []).find(s => normalizeMatricula(s.matricula) === norm);
        
        // Extract possible custom text/reason from rest of line
        let customReason = loteMotivo;
        let rest = trimmed.replace(mat, "").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();
        if (rest && rest.length > 2 && !/^\d+$/.test(rest)) {
          if (!srv) {
            // Might be a name or reason
            if (rest.length > 25) {
              customReason = rest.slice(0, 50);
            }
          }
        }

        results.push({
          matricula: formatted,
          nome: srv ? srv.nome : (rest && /^[A-Za-zÀ-ÿ\s]{4,}$/.test(rest) ? rest : ""),
          motivo: customReason,
          existe: existingNorms.has(norm)
        });
      }
    });

    return results;
  }, [loteTxt, loteMotivo, casosList, state.servidores]);

  const handleCopy = (mat: string) => {
    navigator.clipboard.writeText(mat);
    setCopiedMat(mat);
    setTimeout(() => setCopiedMat(null), 1500);
    onToast(`Matrícula ${mat} copiada!`, "ok");
  };

  const handleSaveSingle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matriculaInp.trim()) {
      onToast("Informe a matrícula do servidor.", "err");
      return;
    }

    const formattedMat = formatMatricula(matriculaInp);
    const norm = normalizeMatricula(formattedMat);

    if (!norm) {
      onToast("Matrícula inválida.", "err");
      return;
    }

    const existingIdx = casosList.findIndex(c => normalizeMatricula(c.matricula) === norm);
    if (existingIdx >= 0) {
      onToast("Esta matrícula já está cadastrada na lista de casos especiais.", "err");
      return;
    }

    const nomeFinal = nomeInp.trim() || (matchedServer ? matchedServer.nome : "");
    const motivoFinal = motivoInp.trim() || "Contrato Temporário";

    const newItem: CasoEspecialItem = {
      id: "ce_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      matricula: formattedMat,
      nome: nomeFinal,
      motivo: motivoFinal,
      observacao: obsInp.trim() || undefined,
      criadoEm: new Date().toLocaleDateString("pt-BR")
    };

    const nextList = [newItem, ...casosList];

    updateState(prev => ({
      casosEspeciais: nextList,
      config: {
        ...prev.config,
        casosEspeciais: nextList
      }
    }));

    setMatriculaInp("");
    setNomeInp("");
    setObsInp("");
    setActiveTab("lista");
    onToast(`Caso especial ${formattedMat} adicionado com sucesso!`, "ok");
  };

  const handleSaveLote = () => {
    const toAdd = parsedLote.filter(p => !p.existe);
    if (toAdd.length === 0) {
      onToast("Nenhum caso novo a ser adicionado (ou todos já constam na lista).", "err");
      return;
    }

    const newItems: CasoEspecialItem[] = toAdd.map(item => ({
      id: "ce_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      matricula: item.matricula,
      nome: item.nome || undefined,
      motivo: item.motivo || loteMotivo || "Contrato Temporário",
      criadoEm: new Date().toLocaleDateString("pt-BR")
    }));

    const nextList = [...newItems, ...casosList];

    updateState(prev => ({
      casosEspeciais: nextList,
      config: {
        ...prev.config,
        casosEspeciais: nextList
      }
    }));

    setLoteTxt("");
    setActiveTab("lista");
    onToast(`${newItems.length} caso(s) especial(is) importado(s) com sucesso!`, "ok");
  };

  const handleStartEdit = (item: CasoEspecialItem) => {
    setEditingItem(item);
    setEditMat(formatMatricula(item.matricula));
    setEditNome(item.nome || "");
    setEditMotivo(item.motivo || "Contrato Temporário");
    setEditObs(item.observacao || "");
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const formattedMat = formatMatricula(editMat);
    const norm = normalizeMatricula(formattedMat);

    if (!norm) {
      onToast("Matrícula inválida.", "err");
      return;
    }

    const nextList = casosList.map(item => {
      if (item.id === editingItem.id || normalizeMatricula(item.matricula) === normalizeMatricula(editingItem.matricula)) {
        return {
          ...item,
          matricula: formattedMat,
          nome: editNome.trim() || undefined,
          motivo: editMotivo.trim() || "Contrato Temporário",
          observacao: editObs.trim() || undefined
        };
      }
      return item;
    });

    updateState(prev => ({
      casosEspeciais: nextList,
      config: {
        ...prev.config,
        casosEspeciais: nextList
      }
    }));

    setEditingItem(null);
    onToast("Caso especial atualizado com sucesso!", "ok");
  };

  const handleDelete = (id: string, mat: string) => {
    if (!confirm(`Deseja realmente remover o caso especial da matrícula ${mat}?`)) return;

    const nextList = casosList.filter(c => c.id !== id && normalizeMatricula(c.matricula) !== normalizeMatricula(mat));

    updateState(prev => ({
      casosEspeciais: nextList,
      config: {
        ...prev.config,
        casosEspeciais: nextList
      }
    }));

    onToast(`Matrícula ${mat} removida dos casos especiais.`, "info");
  };

  const handleClearAll = () => {
    if (!confirm("ATENÇÃO: Deseja realmente excluir todos os casos especiais cadastrados?")) return;

    updateState(prev => ({
      casosEspeciais: [],
      config: {
        ...prev.config,
        casosEspeciais: []
      }
    }));

    onToast("Todos os casos especiais foram removidos.", "info");
  };

  const filteredList = useMemo(() => {
    if (!searchTerm.trim()) return casosList;
    const q = searchTerm.trim().toLowerCase();
    const qNormMat = normalizeMatricula(q);

    return casosList.filter(item => {
      const m = item.matricula.toLowerCase();
      const n = (item.nome || "").toLowerCase();
      const mot = (item.motivo || "").toLowerCase();
      const obs = (item.observacao || "").toLowerCase();
      const normItemMat = normalizeMatricula(item.matricula);

      return m.includes(q) || 
             n.includes(q) || 
             mot.includes(q) || 
             obs.includes(q) ||
             (qNormMat && normItemMat.includes(qNormMat));
    });
  }, [casosList, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div 
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden text-[var(--text)] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-[var(--border)] bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <Star size={20} className="fill-current" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-[var(--text)] truncate">
                  Casos Especiais SISREF
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  {casosList.length} cadastrado(s)
                </span>
              </div>
              <p className="text-xs text-[var(--text2)] font-medium truncate mt-0.5">
                Exibe um selo de atenção em destaque nos lançamentos das Filas Avulsas (ex: Contrato Temporário)
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--bg)] rounded-xl transition cursor-pointer flex-shrink-0"
            title="Fechar (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Sub-Tabs */}
        <div className="flex border-b border-[var(--border)] bg-[var(--bg)]/40 p-1.5 gap-1.5 px-6">
          <button
            type="button"
            onClick={() => { setActiveTab('lista'); setEditingItem(null); }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'lista'
                ? 'bg-[var(--surface)] text-amber-600 dark:text-amber-400 shadow-2xs border border-[var(--border)]'
                : 'text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            <span>📋 Lista de Casos ({casosList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('incluir'); setEditingItem(null); }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'incluir'
                ? 'bg-[var(--surface)] text-amber-600 dark:text-amber-400 shadow-2xs border border-[var(--border)]'
                : 'text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            <Plus size={14} />
            <span>Incluir Novo</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('lote'); setEditingItem(null); }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'lote'
                ? 'bg-[var(--surface)] text-amber-600 dark:text-amber-400 shadow-2xs border border-[var(--border)]'
                : 'text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            <FileText size={14} />
            <span>Colar Lista em Lote</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* TAB 1: LIST VIEW */}
          {activeTab === 'lista' && !editingItem && (
            <div className="flex flex-col gap-4">
              {/* Search & Actions Bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text2)] opacity-60" />
                  <input
                    type="text"
                    placeholder="Filtrar por matrícula (com ou sem 0), nome ou motivo..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {casosList.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 size={13} /> Limpar Todos
                  </button>
                )}
              </div>

              {/* List Cards */}
              {casosList.length === 0 ? (
                <div className="py-12 px-4 text-center bg-[var(--bg)]/40 border-2 border-dashed border-[var(--border)] rounded-2xl">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
                    <Star size={24} />
                  </div>
                  <h3 className="text-sm font-bold text-[var(--text)] mb-1">Nenhum caso especial cadastrado</h3>
                  <p className="text-xs text-[var(--text2)] max-w-md mx-auto mb-4">
                    Cadastre matrículas que precisam de atenção especial (ex: Contrato Temporário). O sistema alertará com um selo visível durante os lançamentos do SISREF.
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('incluir')}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Plus size={14} /> Incluir Individual
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('lote')}
                      className="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--bg)] text-[var(--text)] font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <FileText size={14} /> Colar Lista
                    </button>
                  </div>
                </div>
              ) : filteredList.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text2)] font-semibold">
                  Nenhum caso especial corresponde à busca "{searchTerm}".
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredList.map((item) => {
                    const normMat = normalizeMatricula(item.matricula);
                    const srv = (state.servidores || []).find(s => normalizeMatricula(s.matricula) === normMat);
                    const displayNome = item.nome || (srv ? srv.nome : "Nome não informado");
                    const formattedDisplay = formatMatricula(item.matricula);

                    return (
                      <div
                        key={item.id || item.matricula}
                        className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50 hover:bg-amber-500/10 transition-all flex flex-col justify-between gap-3 shadow-2xs group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono font-black text-sm text-[var(--text)] tracking-wider">
                                {formattedDisplay}
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-2xs flex items-center gap-1">
                                ⭐ {item.motivo || "Caso Especial"}
                              </span>
                              {srv && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded">
                                  SIGRH
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-bold text-[var(--text)] truncate" title={displayNome}>
                              {displayNome}
                            </div>
                            {item.observacao && (
                              <div className="text-[11px] text-[var(--text2)] mt-1 italic">
                                Obs: {item.observacao}
                              </div>
                            )}
                            {srv?.lotacao && (
                              <div className="text-[10px] text-[var(--text2)] opacity-70 truncate mt-0.5">
                                {srv.lotacao}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCopy(formattedDisplay)}
                            className="p-1.5 rounded-lg border border-amber-500/30 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 transition-colors cursor-pointer flex-shrink-0"
                            title="Copiar matrícula"
                          >
                            {copiedMat === formattedDisplay ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          </button>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-amber-500/20 text-[10px] font-semibold text-[var(--text2)]">
                          <span>{item.criadoEm ? `Desde: ${item.criadoEm}` : "Ativo"}</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(item)}
                              className="px-2.5 py-1 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 rounded-md transition cursor-pointer font-bold flex items-center gap-1"
                            >
                              <Edit3 size={11} /> Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id, item.matricula)}
                              className="px-2.5 py-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition cursor-pointer font-bold flex items-center gap-1"
                            >
                              <Trash2 size={11} /> Excluir
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* EDIT FORM (WHEN EDITING) */}
          {editingItem && (
            <form onSubmit={handleSaveEdit} className="bg-[var(--bg)]/50 border border-amber-500/30 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
                  <Edit3 size={16} /> Editando Caso Especial: {editingItem.matricula}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="text-xs text-[var(--text2)] hover:underline cursor-pointer"
                >
                  Cancelar Edição
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Matrícula (8 dígitos - 0 à esquerda incluído automaticamente):
                  </label>
                  <input
                    type="text"
                    value={editMat}
                    onChange={(e) => setEditMat(e.target.value)}
                    onBlur={() => setEditMat(formatMatricula(editMat))}
                    placeholder="Ex: 01234567"
                    className="w-full p-2.5 font-mono text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Nome do Servidor:
                  </label>
                  <input
                    type="text"
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    placeholder="Nome completo..."
                    className="w-full p-2.5 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Motivo / Selo de Aviso:
                  </label>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {PRESET_MOTIVOS.map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEditMotivo(preset)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition cursor-pointer ${
                          editMotivo === preset 
                            ? 'bg-amber-500 text-white border-amber-600' 
                            : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text2)] hover:border-amber-500'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={editMotivo}
                    onChange={(e) => setEditMotivo(e.target.value)}
                    placeholder="Ex: Contrato Temporário"
                    className="w-full p-2.5 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Observação Interna (opcional):
                  </label>
                  <input
                    type="text"
                    value={editObs}
                    onChange={(e) => setEditObs(e.target.value)}
                    placeholder="Ex: Não homologar pelo SIGRH / Prazo até 15/12..."
                    className="w-full p-2.5 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text2)] hover:bg-[var(--surface)] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: INCLUIR INDIVIDUAL */}
          {activeTab === 'incluir' && (
            <form onSubmit={handleSaveSingle} className="flex flex-col gap-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-200">
                <strong>Dica das matrículas:</strong> Caso a matrícula tenha menos de 8 dígitos (por exemplo 7 dígitos), o sistema adiciona o <strong>0 à esquerda</strong> automaticamente ao digitar ou salvar.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Matrícula (8 dígitos):
                  </label>
                  <input
                    type="text"
                    value={matriculaInp}
                    onChange={(e) => setMatriculaInp(e.target.value)}
                    onBlur={() => setMatriculaInp(formatMatricula(matriculaInp))}
                    placeholder="Ex: 01234567 ou 1234567"
                    className="w-full p-3 font-mono text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                    required
                    autoFocus
                  />
                  {matriculaInp && (
                    <div className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400 mt-1">
                      Formatado para 8 dígitos: {formatMatricula(matriculaInp)}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Nome do Servidor:
                  </label>
                  <input
                    type="text"
                    value={nomeInp || (matchedServer ? matchedServer.nome : "")}
                    onChange={(e) => setNomeInp(e.target.value)}
                    placeholder={matchedServer ? matchedServer.nome : "Nome completo ou auto-detectado..."}
                    className="w-full p-3 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                  />
                  {matchedServer && (
                    <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={13} /> Localizado no SIGRH: {matchedServer.lotacao}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Motivo do Selo de Atenção:
                  </label>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {PRESET_MOTIVOS.map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setMotivoInp(preset)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition cursor-pointer ${
                          motivoInp === preset 
                            ? 'bg-amber-500 text-white border-amber-600' 
                            : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text2)] hover:border-amber-500'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={motivoInp}
                    onChange={(e) => setMotivoInp(e.target.value)}
                    placeholder="Ex: Contrato Temporário"
                    className="w-full p-3 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1">
                    Observação Interna (opcional):
                  </label>
                  <input
                    type="text"
                    value={obsInp}
                    onChange={(e) => setObsInp(e.target.value)}
                    placeholder="Ex: Verificar termo aditivo, conferir horas extras..."
                    className="w-full p-3 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setActiveTab('lista')}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-[var(--text2)] hover:bg-[var(--surface)] cursor-pointer"
                >
                  Voltar à Lista
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl text-xs font-black bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Plus size={15} /> Adicionar Caso Especial
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: BATCH PASTE */}
          {activeTab === 'lote' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-200">
                Cole aqui uma lista de matrículas (ou linhas contendo matrículas e nomes). Todas as matrículas serão <strong>formatadas com 8 dígitos</strong> (incluindo o zero à esquerda) e associadas ao motivo configurado.
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1.5">
                  Motivo Padrão para este Lote:
                </label>
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {PRESET_MOTIVOS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setLoteMotivo(preset)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition cursor-pointer ${
                        loteMotivo === preset 
                          ? 'bg-amber-500 text-white border-amber-600' 
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text2)] hover:border-amber-500'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={loteMotivo}
                  onChange={(e) => setLoteMotivo(e.target.value)}
                  placeholder="Ex: Contrato Temporário"
                  className="w-full p-2.5 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500 mb-3"
                />

                <label className="block text-[10px] font-black uppercase text-[var(--text2)] mb-1.5">
                  Cole o Texto / Lista de Casos Especiais:
                </label>
                <textarea
                  rows={6}
                  value={loteTxt}
                  onChange={(e) => setLoteTxt(e.target.value)}
                  placeholder={`Exemplo:\n01234567 - JOAO SILVA\n1234567\n07654321 Contrato Temporário\n1431603x`}
                  className="w-full p-3 font-mono text-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-amber-500 resize-y"
                />
              </div>

              {/* Preview of recognized cases */}
              {parsedLote.length > 0 && (
                <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg)]/30">
                  <div className="px-4 py-2.5 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between text-xs font-bold text-[var(--text2)]">
                    <span>{parsedLote.length} matrícula(s) identificada(s)</span>
                    <span className="text-amber-600 dark:text-amber-400">
                      {parsedLote.filter(p => !p.existe).length} nova(s) / {parsedLote.filter(p => p.existe).length} já cadastrada(s)
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-[var(--border)]">
                    {parsedLote.map((item, idx) => (
                      <div key={idx} className="px-4 py-2 flex items-center justify-between text-xs gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-[var(--text)]">{item.matricula}</span>
                          {item.nome && <span className="text-[var(--text2)] truncate">• {item.nome}</span>}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold truncate">
                            {item.motivo}
                          </span>
                        </div>
                        {item.existe ? (
                          <span className="text-[10px] font-bold text-gray-400 flex-shrink-0">Já cadastrada</span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">Nova</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setActiveTab('lista')}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-[var(--text2)] hover:bg-[var(--surface)] cursor-pointer"
                >
                  Voltar à Lista
                </button>
                <button
                  type="button"
                  disabled={parsedLote.filter(p => !p.existe).length === 0}
                  onClick={handleSaveLote}
                  className="px-6 py-2.5 rounded-xl text-xs font-black bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Check size={15} /> Importar {parsedLote.filter(p => !p.existe).length} Casos Novos
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Note */}
        <div className="px-6 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 flex items-center justify-between text-[11px] text-[var(--text2)] font-medium">
          <span>
            As alterações são salvas e sincronizadas automaticamente em tempo real.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
