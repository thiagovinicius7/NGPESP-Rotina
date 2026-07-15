import React, { useState, useEffect } from "react";
import { AppState, LaunchCode, NatalAnalysis } from "../types.js";
import { 
  Calculator, FileCode, Image as ImageIcon, Gift, Plus, Search, 
  Trash2, FileUp, X, Save, Edit2, ExternalLink, FilePlus2, 
  History, Clock, AlertTriangle, AlertCircle, CheckCircle, Check
} from "lucide-react";

interface SigrhPanelProps {
  state: AppState;
  updateState: (newState: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string, type?: 'ok' | 'err' | 'info') => void;
}

export default function SigrhPanel({ state, updateState, onToast }: SigrhPanelProps) {
  // Calculadora
  const [calcData, setCalcData] = useState(new Date().toISOString().split("T")[0]);
  const [calcDias, setCalcDias] = useState("");
  const [calcOp, setCalcOp] = useState<"soma" | "sub">("soma");
  const [calcUteis, setCalcUteis] = useState(false);
  const [calcResultado, setCalcResultado] = useState<{ fmtCurto: string; fmtLongo: string; info: string } | null>(null);

  // Códigos de lançamento
  const [codBusca, setCodBusca] = useState("");
  const [codForm, setCodForm] = useState<{ idx: number; num: string; nome: string; periodo: string } | null>(null);

  // Imagens de referência (Base64)
  const [imgRef1, setImgRef1] = useState<string | null>(null);
  const [imgRef2, setImgRef2] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  // Abono Natalício
  const [natalForm, setNatalForm] = useState<{
    show: boolean;
    idx: number;
    sei: string;
    criterios: { id: string; desc: string; checked: boolean }[];
    novoCritDesc: string;
  } | null>(null);

  const defaultNatalCriterios = [
    { id: "não-temporario", desc: "Servidor NÃO é temporário?", checked: false },
    { id: "atrasos-008", desc: "Atrasos (Cod 008) ≤ 9?", checked: false },
    { id: "faltas-240", desc: "Faltas Injustificadas (240) ≤ 3?", checked: false },
    { id: "disciplina", desc: "Sem suspensão (5 anos) ou advertência (3 anos)?", checked: false },
    { id: "aniversario", desc: "Aniversário em dia de trabalho regular ou escala?", checked: false },
    { id: "folhas", desc: "Todas as folhas apuradas ou disponibilizadas?", checked: false },
    { id: "cadhis31", desc: "CADHIS31 (cód. 316 e 244)?", checked: false },
    { id: "pagfrq31", desc: "PAGFRQ31 (cód. 44830 e 40050)?", checked: false }
  ];

  // Load Base64 images on mount
  useEffect(() => {
    try {
      const im1 = localStorage.getItem("ss_dep_img1");
      const im2 = localStorage.getItem("ss_dep_img2");
      if (im1) setImgRef1(im1);
      if (im2) setImgRef2(im2);
    } catch (_) {}
  }, []);

  // Calculadora action
  const calcularDataResult = () => {
    if (!calcData || !calcDias) {
      onToast("Selecione a data inicial e preencha a quantidade de dias", "err");
      return;
    }

    const start = new Date(calcData + "T00:00:00");
    const numDays = parseInt(calcDias) || 0;
    let curr = new Date(start);

    if (calcUteis) {
      // business days seg-sex
      let added = 0;
      while (added < numDays) {
        curr.setDate(curr.getDate() + (calcOp === "soma" ? 1 : -1));
        const day = curr.getDay();
        if (day !== 0 && curr.getDay() !== 6) {
          added++;
        }
      }
    } else {
      curr.setDate(curr.getDate() + (calcOp === "soma" ? numDays : -numDays));
    }

    const fmtCurto = curr.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const fmtLongo = curr.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const info = `${fmtLongo} · ${calcUteis ? "dias úteis" : "dias corridos"} · ${numDays} dias ${calcUteis ? "(seg-sex)" : ""}`;

    setCalcResultado({ fmtCurto, fmtLongo, info });
    navigator.clipboard.writeText(fmtCurto);
    onToast(`Data calculada e copiada: ${fmtCurto}`, "ok");
  };

  // Launch codes actions
  const salvarCodigo = () => {
    if (!codForm?.num || !codForm?.nome) {
      onToast("Preencha código e nome", "err");
      return;
    }

    updateState(prev => {
      const nextArr = [...prev.codigos];
      const obj = { num: codForm.num, nome: codForm.nome, periodo: codForm.periodo || "—" };
      if (codForm.idx >= 0) {
        nextArr[codForm.idx] = obj;
      } else {
        nextArr.push(obj);
      }
      return { codigos: nextArr };
    });

    onToast(codForm.idx >= 0 ? "Código atualizado" : "Código cadastrado com sucesso!", "ok");
    setCodForm(null);
  };

  const excluirCodigo = (idx: number) => {
    if (!confirm("Deseja realmente excluir este código?")) return;
    updateState(prev => ({
      codigos: prev.codigos.filter((_, i) => i !== idx)
    }));
    onToast("Código removido", "info");
  };

  // Upload image Base64 handlers
  const handleImageUpload = (slot: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const b64 = evt.target?.result as string;
      if (slot === 1) {
        setImgRef1(b64);
        localStorage.setItem("ss_dep_img1", b64);
      } else {
        setImgRef2(b64);
        localStorage.setItem("ss_dep_img2", b64);
      }
      onToast(`Documento ${slot} carrgado com sucesso!`, "ok");
    };
    reader.readAsDataURL(file);
  };

  const removerImage = (slot: 1 | 2) => {
    if (!confirm("Remover imagem de referência?")) return;
    if (slot === 1) {
      setImgRef1(null);
      localStorage.removeItem("ss_dep_img1");
    } else {
      setImgRef2(null);
      localStorage.removeItem("ss_dep_img2");
    }
    onToast("Documento removido", "info");
  };

  // Abono Natalício operations
  const abrirNovoNatal = () => {
    setNatalForm({
      show: true,
      idx: -1,
      sei: "",
      criterios: defaultNatalCriterios.map(c => ({ ...c })),
      novoCritDesc: ""
    });
  };

  const adicionarNatalCriterio = () => {
    if (!natalForm || !natalForm.novoCritDesc.trim()) return;
    const desc = natalForm.novoCritDesc.trim();
    setNatalForm(prev => {
      if (!prev) return null;
      return {
        ...prev,
        novoCritDesc: "",
        criterios: [...prev.criterios, { id: `custom-${Date.now()}`, desc, checked: false }]
      };
    });
  };

  const toggleNatalCheck = (cId: string) => {
    setNatalForm(prev => {
      if (!prev) return null;
      return {
        ...prev,
        criterios: prev.criterios.map(c => c.id === cId ? { ...c, checked: !c.checked } : c)
      };
    });
  };

  const finalizarNatalAnalise = (resultado: "DEFERIDO" | "INDEFERIDO") => {
    if (!natalForm || !natalForm.sei.trim()) {
      onToast("Informe o número do processo SEI", "err");
      return;
    }

    let motivo = "";
    if (resultado === "INDEFERIDO") {
      const unchecked = natalForm.criterios.filter(c => !c.checked).map(c => c.desc);
      motivo = unchecked.length > 0 ? unchecked.join(" | ") : "Justificativa não preenchida";
    }

    const dataHora = new Date().toLocaleString("pt-BR");
    const analise: NatalAnalysis = {
      sei: natalForm.sei.trim(),
      resultado,
      data: dataHora,
      motivo
    };

    updateState(prev => {
      const nextArr = [...prev.filaAvulsa.natal];
      if (natalForm.idx >= 0) {
        nextArr[natalForm.idx] = { ...analise, data: nextArr[natalForm.idx].data };
      } else {
        nextArr.unshift(analise);
      }
      return {
        filaAvulsa: {
          ...prev.filaAvulsa,
          natal: nextArr
        }
      };
    });

    onToast(`Processo ${natalForm.sei.trim()} registrado como ${resultado}!`, "ok");
    setNatalForm(null);
  };

  const editarNatal = (idx: number) => {
    const item = state.filaAvulsa.natal[idx];
    if (!item) return;

    // Prefill form
    setNatalForm({
      show: true,
      idx,
      sei: item.sei,
      criterios: defaultNatalCriterios.map(c => ({
        ...c,
        checked: item.resultado === "DEFERIDO" ? true : !item.motivo.includes(c.desc)
      })),
      novoCritDesc: ""
    });
  };

  const excluirNatal = (idx: number) => {
    if (!confirm("Deseja realmente excluir esta análise de abono natalício?")) return;
    updateState(prev => ({
      filaAvulsa: {
        ...prev.filaAvulsa,
        natal: prev.filaAvulsa.natal.filter((_, i) => i !== idx)
      }
    }));
    onToast("Análise excluída", "info");
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* 1. CALCULADORA DE DATAS */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-4 flex items-center gap-2">
          <Calculator size={16} /> Calculadora de datas
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Data inicial</label>
            <input 
              type="date" 
              value={calcData}
              onChange={(e) => setCalcData(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-[var(--bg)] outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Quantidade de dias</label>
            <input 
              type="number" 
              value={calcDias}
              onChange={(e) => setCalcDias(e.target.value)}
              placeholder="Ex: 15"
              className="w-full p-2.5 rounded-xl bg-[var(--bg)] outline-none"
            />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <button 
            onClick={() => setCalcOp("soma")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${calcOp === "soma" ? 'bg-[var(--green-light)] text-[var(--green-mid)]' : 'bg-[var(--bg)] text-[var(--text2)]'}`}
          >
            Somar dias
          </button>
          <button 
            onClick={() => setCalcOp("sub")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${calcOp === "sub" ? 'bg-[var(--red-light)] text-[var(--red)]' : 'bg-[var(--bg)] text-[var(--text2)]'}`}
          >
            Subtrair dias
          </button>
          <button 
            onClick={calcularDataResult}
            className="px-5 py-2 bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg hover:bg-[var(--blue)] shadow-sm"
          >
            Calcular
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold text-[var(--text2)] cursor-pointer select-none mb-4">
          <input 
            type="checkbox" 
            checked={calcUteis}
            onChange={(e) => setCalcUteis(e.target.checked)}
            className="w-4.5 h-4.5 rounded"
          />
          Considerar apenas dias úteis (seg-sex)
        </label>

        {calcResultado && (
          <div className="bg-[var(--blue-light)] border border-[rgba(37,99,235,0.2)] rounded-xl p-4 mt-2">
            <span className="text-[10px] font-bold text-[var(--blue-mid)] uppercase tracking-wider block mb-1">Resultado formatado</span>
            <div className="text-2xl font-black text-[var(--text)] tracking-tight">
              {calcResultado.fmtCurto}
            </div>
            <div className="text-xs text-[var(--text2)] font-semibold mt-1">
              {calcResultado.info}
            </div>
          </div>
        )}
      </div>

      {/* 2. CÓDIGOS DE LANÇAMENTO */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-2">
            <FileCode size={16} /> Códigos de lançamento
          </div>
          <button 
            onClick={() => setCodForm({ idx: -1, num: "", nome: "", periodo: "" })}
            className="px-3.5 py-1.5 bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg flex items-center gap-0.5 shadow-sm"
          >
            <Plus size={14} /> Novo Código
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" size={16} />
          <input 
            type="text" 
            value={codBusca}
            onChange={(e) => setCodBusca(e.target.value)}
            placeholder="Pesquisar código ou nome..."
            className="w-full p-2.5 pl-9 text-xs rounded-xl"
          />
        </div>

        {/* Code Edit Form Overlay */}
        {codForm && (
          <div className="border border-[var(--border)] bg-[var(--bg)]/10 rounded-xl p-4 mb-4">
            <div className="text-xs font-bold text-[var(--text)] mb-3 uppercase">
              {codForm.idx >= 0 ? "Editar Código" : "Cadastrar Novo Código"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[11px] font-bold text-[var(--text2)] block mb-0.5">Código</label>
                <input 
                  type="text" 
                  value={codForm.num}
                  onChange={(e) => setCodForm(prev => prev ? { ...prev, num: e.target.value } : null)}
                  placeholder="Ex: 001"
                  className="w-full p-2 rounded-lg text-xs bg-[var(--surface)]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-[var(--text2)] block mb-0.5">Nome / Evento</label>
                <input 
                  type="text" 
                  value={codForm.nome}
                  onChange={(e) => setCodForm(prev => prev ? { ...prev, nome: e.target.value } : null)}
                  placeholder="Ex: Licença médica"
                  className="w-full p-2 rounded-lg text-xs bg-[var(--surface)]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-[var(--text2)] block mb-0.5">Período Abonado</label>
                <input 
                  type="text" 
                  value={codForm.periodo}
                  onChange={(e) => setCodForm(prev => prev ? { ...prev, periodo: e.target.value } : null)}
                  placeholder="Ex: 15 dias"
                  className="w-full p-2 rounded-lg text-xs bg-[var(--surface)]"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button 
                onClick={() => setCodForm(null)}
                className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] text-[var(--text2)] text-xs font-bold rounded-lg"
              >
                Cancelar
              </button>
              <button 
                onClick={salvarCodigo}
                className="px-4 py-1.5 bg-[var(--blue-mid)] text-white text-xs font-bold rounded-lg"
              >
                Salvar
              </button>
            </div>
          </div>
        )}

        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg)]/40 text-[var(--text2)] text-xs">
                <th className="p-3 text-left w-20">Código</th>
                <th className="p-3 text-left">Nome</th>
                <th className="p-3 text-left w-32">Abonado</th>
                <th className="p-3 text-right w-24">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)] text-sm font-semibold">
              {state.codigos
                .filter(c => c.num.includes(codBusca) || c.nome.toLowerCase().includes(codBusca.toLowerCase()))
                .map((c, i) => (
                  <tr key={i} className="hover:bg-[var(--bg)]/10 text-xs">
                    <td className="p-3 font-mono text-[var(--blue-mid)] font-bold">{c.num}</td>
                    <td className="p-3 text-[var(--text)]">{c.nome}</td>
                    <td className="p-3">
                      <span className="text-[10px] font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] px-2 py-0.5 rounded-full">
                        {c.periodo}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button 
                          onClick={() => setCodForm({ idx: i, num: c.num, nome: c.nome, periodo: c.periodo })}
                          className="p-1 border border-[var(--border)] bg-white text-[var(--text2)] rounded hover:bg-[var(--bg)]"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button 
                          onClick={() => excluirCodigo(i)}
                          className="p-1 border border-[var(--border)] bg-white text-[var(--red)] rounded hover:bg-[var(--red-light)]"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {state.codigos.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-[var(--text2)] text-xs font-semibold">
                    Nenhum código cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. IMAGENS DE REFERÊNCIA */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
        <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-2 flex items-center gap-2">
          <ImageIcon size={16} /> Imagens de referência
        </div>
        <p className="text-xs text-[var(--text2)] font-semibold mb-5 leading-relaxed">
          Arraste ou carregue documentos importantes (como fluxogramas ou códigos rápidos) para consulta rápida em lightbox durante o preenchimento de planilhas.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Document 1 */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-black uppercase text-[var(--text2)] tracking-wider">Documento de Apoio 1</span>
            {imgRef1 ? (
              <div className="relative group rounded-xl overflow-hidden border border-[var(--border)] aspect-[4/3] bg-black">
                <img 
                  src={imgRef1} 
                  alt="Apoio 1" 
                  onClick={() => setLightboxImg(imgRef1)}
                  className="w-full h-full object-cover cursor-zoom-in group-hover:opacity-90 transition"
                />
                <button 
                  onClick={() => removerImage(1)}
                  className="absolute top-2.5 right-2.5 p-1.5 bg-black/60 rounded-full text-white hover:bg-black"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-[var(--border2)] rounded-xl aspect-[4/3] bg-[var(--bg)]/10 hover:bg-[var(--blue-light)]/20 hover:border-[var(--blue-mid)] transition cursor-pointer select-none">
                <FileUp className="text-[var(--blue-mid)] mb-2" size={32} />
                <span className="text-xs font-bold text-[var(--text)]">Clique para carregar</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => handleImageUpload(1, e)}
                  className="hidden" 
                />
              </label>
            )}
          </div>

          {/* Document 2 */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-black uppercase text-[var(--text2)] tracking-wider">Documento de Apoio 2</span>
            {imgRef2 ? (
              <div className="relative group rounded-xl overflow-hidden border border-[var(--border)] aspect-[4/3] bg-black">
                <img 
                  src={imgRef2} 
                  alt="Apoio 2" 
                  onClick={() => setLightboxImg(imgRef2)}
                  className="w-full h-full object-cover cursor-zoom-in group-hover:opacity-90 transition"
                />
                <button 
                  onClick={() => removerImage(2)}
                  className="absolute top-2.5 right-2.5 p-1.5 bg-black/60 rounded-full text-white hover:bg-black"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-[var(--border2)] rounded-xl aspect-[4/3] bg-[var(--bg)]/10 hover:bg-[var(--blue-light)]/20 hover:border-[var(--blue-mid)] transition cursor-pointer select-none">
                <FileUp className="text-[var(--blue-mid)] mb-2" size={32} />
                <span className="text-xs font-bold text-[var(--text)]">Clique para carregar</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => handleImageUpload(2, e)}
                  className="hidden" 
                />
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox Viewing Overlay */}
      {lightboxImg && (
        <div 
          onClick={() => setLightboxImg(null)}
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-md cursor-zoom-out"
        >
          <img src={lightboxImg} alt="Reference doc" className="max-w-full max-h-[90vh] object-contain rounded-xl" />
          <button 
            onClick={() => setLightboxImg(null)}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/40 text-white rounded-full transition"
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* 4. ABONO NATALÍCIO */}
      <div id="abono-natalicio" className="bg-[var(--surface)] border border-[var(--border)] border-t-4 border-t-[var(--amber-mid)] rounded-2xl p-6 shadow-sm scroll-mt-24">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider flex items-center gap-1.5">
            <Gift className="text-[var(--amber-mid)]" size={16} /> Abono Natalício
          </div>
          <a 
            href="https://sites.google.com/view/abononatalicio" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs font-bold bg-[var(--blue-light)] text-[var(--blue-mid)] hover:bg-[var(--blue-mid)] hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
          >
            <ExternalLink size={14} /> Abrir Script Externo
          </a>
        </div>

        <button 
          onClick={abrirNovoNatal}
          className="w-full py-2.5 text-xs font-bold bg-[var(--blue)] hover:bg-[var(--blue-mid)] text-white rounded-xl flex items-center justify-center gap-1 shadow-sm"
        >
          <FilePlus2 size={16} /> Inserir Novo Processo de Abono
        </button>

        {/* Abono Natalício Checking box wizard */}
        {natalForm && (
          <div className="mt-5 p-5 bg-[var(--bg)]/20 border border-[var(--border2)] rounded-xl flex flex-col gap-4">
            <div className="text-xs font-bold text-[var(--text)] uppercase">
              {natalForm.idx >= 0 ? "Editar Análise de Abono" : "Análise Checklist de Abono"}
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text2)] block mb-1">Número do Processo SEI</label>
              <input 
                type="text" 
                value={natalForm.sei}
                onChange={(e) => setNatalForm(prev => prev ? { ...prev, sei: e.target.value } : null)}
                placeholder="Ex: 00060-00..."
                className="w-full p-2.5 rounded-lg bg-[var(--surface)] text-sm"
              />
            </div>

            <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mt-2">Checklist de Critérios Obrigatórios</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {natalForm.criterios.map(c => (
                <label 
                  key={c.id}
                  className="flex items-center gap-3 p-2 bg-[var(--surface)] hover:bg-[var(--bg)]/10 border border-[var(--border)] rounded-lg cursor-pointer"
                >
                  <input 
                    type="checkbox" 
                    checked={c.checked}
                    onChange={() => toggleNatalCheck(c.id)}
                    className="w-4.5 h-4.5 rounded"
                  />
                  <span className="text-xs font-semibold text-[var(--text)]">{c.desc}</span>
                </label>
              ))}
            </div>

            {/* Custom check adding */}
            <div className="flex gap-2 mt-2">
              <input 
                type="text" 
                value={natalForm.novoCritDesc}
                onChange={(e) => setNatalForm(prev => prev ? { ...prev, novoCritDesc: e.target.value } : null)}
                placeholder="Adicionar outro critério..."
                className="flex-1 p-2 rounded-lg bg-[var(--surface)] text-xs"
              />
              <button 
                onClick={adicionarNatalCriterio}
                className="px-3 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-xs font-bold rounded-lg hover:bg-[var(--bg)]"
              >
                Add
              </button>
            </div>

            <div className="flex gap-3 mt-4 border-t border-[var(--border)] pt-4">
              <button 
                onClick={() => finalizarNatalAnalise("INDEFERIDO")}
                className="flex-1 py-2.5 text-xs font-bold bg-[var(--surface)] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-light)] rounded-xl"
              >
                Indeferir Processo
              </button>
              <button 
                onClick={() => finalizarNatalAnalise("DEFERIDO")}
                className="flex-1 py-2.5 text-xs font-bold bg-[var(--green-mid)] text-white hover:bg-[var(--green)] rounded-xl"
              >
                Deferir / Lançar
              </button>
            </div>
          </div>
        )}

        {/* History table */}
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <div className="text-xs font-bold text-[var(--text2)] uppercase tracking-wider mb-3 flex items-center gap-1">
            <History size={14} /> Análises Recentes de Abono
          </div>
          <div className="flex flex-col gap-3">
            {state.filaAvulsa.natal.slice(0, 5).map((h, i) => (
              <div 
                key={i}
                className="flex justify-between items-center gap-4 p-3 hover:bg-[var(--bg)]/10 rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs text-[var(--text)] font-mono">{h.sei}</div>
                  <div className="text-[10px] text-[var(--text2)] mt-1 flex items-center gap-0.5">
                    <Clock size={10} /> {h.data}
                  </div>
                  {h.motivo && (
                    <div className="text-[11px] text-[var(--red)] font-bold mt-1 line-clamp-1">
                      Faltou: {h.motivo}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${h.resultado === 'DEFERIDO' ? 'bg-[var(--green-light)] text-[var(--green-mid)]' : 'bg-[var(--red-light)] text-[var(--red)]'}`}>
                    {h.resultado}
                  </span>
                  <button 
                    onClick={() => editarNatal(i)}
                    className="p-1 border border-[var(--border)] bg-white text-[var(--text2)] rounded hover:bg-[var(--bg)]"
                  >
                    <Edit2 size={11} />
                  </button>
                  <button 
                    onClick={() => excluirNatal(i)}
                    className="p-1 border border-[var(--border)] bg-white text-[var(--red)] rounded hover:bg-[var(--red-light)]"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {state.filaAvulsa.natal.length === 0 && (
              <div className="text-center p-4 text-xs text-[var(--text2)] font-semibold">
                Nenhuma análise registrada ainda.
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
