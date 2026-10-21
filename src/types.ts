export interface Server {
  matricula: string;
  nome: string;
  cargo: string;
  denominacao: string;
  codLotacao: string;
  lotacao: string;
  admissao: string;
  situacao: string;
}

export interface HistoryEntry {
  mat: string;
  nome: string;
  setor: string;
  qtd: number;
  ts: string;
  ocorrencias?: string[];
}

export interface FastReply {
  nome: string;
  texto: string;
}

export interface LaunchCode {
  num: string;
  nome: string;
  periodo: string;
}

export interface SeiProcess {
  num: string;
  desc: string;
}

export interface Absence {
  dia: string;      // dia do início (compatibilidade)
  mes: string;      // AAAA-MM do início (compatibilidade; registros antigos podem ter outro formato)
  tipo: string;
  sisref: string;   // "sim" | "nao" | "pendente" | "naoPrecisa"
  inicio?: string;  // AAAA-MM-DD
  fim?: string;     // AAAA-MM-DD
  turno?: "dia" | "manha" | "tarde";
  obs?: string;
}

export interface PeriodoFerias {
  inicio?: string;
  fim?: string;
  processo?: string;
}

export interface AbonoData {
  data?: string;
  processo?: string;
}

export interface AtividadeLancamento {
  qtd: number | string;
  tipo: string;
  sistema: string;
  desc: string;
  processosSei?: string;
  id?: string;            // identificador estável (atividades salvas a partir de out/2026)
  atualizadoEm?: number;  // quando foi salva/editada pela última vez (ms)
  origem?: "balcao";      // atendimento registrado pela tela do balcão
  inicio?: string;        // HH:MM (atendimento de balcão)
  fim?: string;           // HH:MM (atendimento de balcão)
}

export interface ProdutividadeDia {
  situacao: string;       // situação geral (compatibilidade); "parcial" quando manhã ≠ tarde
  sitObs: string;
  manha: AtividadeLancamento[];
  tarde: AtividadeLancamento[];
  situacaoManha?: string;
  situacaoTarde?: string;
  sitEm?: number;         // quando a situação foi alterada pela última vez (ms)
  removidos?: string[];   // atividades excluídas (para não voltarem ao juntar com outro computador)
}

export interface NatalAnalysis {
  sei: string;
  resultado: 'DEFERIDO' | 'INDEFERIDO';
  data: string;
  motivo: string;
}

export interface QueueOcorrencia {
  tipo: string;
  data: string;        // último dia (fato gerador)
  dataInicio?: string; // primeiro dia, quando o afastamento tem mais de um dia
  dias?: string[]; // todos os dias listados no SISREF (pode ter intervalos)
  checked: boolean;
  dataLancamento?: string;
}

export interface QueueServer {
  matricula: string;
  nome: string;
  tipos: string[];
  ocorrencias: QueueOcorrencia[];
}

export interface QueueList {
  fila: QueueServer[];
  idx: number;
}

export interface QueueState {
  listas: Record<string, QueueList>;
  ativa: string;
  natal: NatalAnalysis[];
  configProd: {
    tipos: string[];
    sistemas: string[];
  };
  pendencias: {
    matricula: string;
    nome: string;
    tipos: string[];
    ocorrencias: QueueOcorrencia[];
    motivo: string;
    dataHora: string;
  }[];
}

export interface LancamentoAnteriorItem {
  id: string;
  matricula: string;
  nome: string;
  tipo: string;
  dataOcorrencia: string;
  mesAnoOcorrencia: string; // YYYY-MM
  status?: string;
  origemTexto?: string;
  criadoEm?: string;
}

export interface CasoEspecialItem {
  id: string;
  matricula: string;
  nome?: string;
  motivo: string; // Ex: "Contrato Temporário", "Caso Especial", etc.
  observacao?: string;
  criadoEm?: string;
}

export interface GlobalConfig {
  gmov_data?: string;
  spreadsheetId?: string;
  backupEnabled?: boolean;
  appPassword?: string;
  ultimoUpdateServidores?: string;
  lastImportedMatriculas?: string[];
  lastImportCount?: number;
  matriculasCedidos?: string[];
  casosEspeciais?: CasoEspecialItem[];
  lancamentosAnteriores?: LancamentoAnteriorItem[];
}

export interface AppState {
  servidores: Server[];
  historico: HistoryEntry[];
  respostas: FastReply[];
  codigos: LaunchCode[];
  sei: SeiProcess[];
  afastamentos: Absence[];
  ferias: Record<string, PeriodoFerias[]>; // year -> 3 periods
  abonos: Record<string, AbonoData[]>; // year -> 5 abonos
  produtividade: Record<string, ProdutividadeDia>; // date(YYYY-MM-DD) -> day details
  config: GlobalConfig;
  filaAvulsa: QueueState;
  balcaoAtendimentos: Record<string, string>; // date(YYYY-MM-DD) -> notes
  faq: { titulo: string; resposta: string }[];
  gasUrl: string;
  lancamentosAnteriores?: LancamentoAnteriorItem[];
  casosEspeciais?: CasoEspecialItem[];
}

export interface ServerSyncResponse {
  status: 'ok';
  state: AppState;
  updatedAt: number;
}
