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
  dia: string;
  mes: string;
  tipo: string;
  sisref: string;
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
}

export interface ProdutividadeDia {
  situacao: string;
  sitObs: string;
  manha: AtividadeLancamento[];
  tarde: AtividadeLancamento[];
}

export interface NatalAnalysis {
  sei: string;
  resultado: 'DEFERIDO' | 'INDEFERIDO';
  data: string;
  motivo: string;
}

export interface QueueOcorrencia {
  tipo: string;
  data: string;
  checked: boolean;
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

export interface GlobalConfig {
  gmov_data: string;
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
}

export interface ServerSyncResponse {
  status: 'ok';
  state: AppState;
  updatedAt: number;
}
