import { AppState } from "../types.js";

interface SyncProgress {
  message: string;
  type: 'info' | 'ok' | 'err';
}

export interface DriveBackupFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export const DEFAULT_SPREADSHEET_ID = "1gk5MZYPDb3g5XM5y52OLMHMU0B0R2qbbZD79ryBizek";

/**
 * Extracts a Google Spreadsheet ID from a URL or raw ID string.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Searches user's Google Drive for existing NGPESP backup spreadsheets.
 */
export async function searchGoogleDriveForBackup(
  accessToken: string
): Promise<DriveBackupFile[]> {
  if (!accessToken) return [];
  try {
    const q = encodeURIComponent("name contains 'NGPESP' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime+desc&fields=files(id,name,modifiedTime)`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      console.warn("Drive API search returned status:", res.status);
      return [];
    }

    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error("Error searching Google Drive:", err);
    return [];
  }
}

/**
 * Helper to ensure required sheet tabs exist on the target spreadsheet.
 */
async function ensureSheetTabsExist(
  accessToken: string,
  spreadsheetId: string,
  requiredTitles: string[]
): Promise<void> {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    const existingTitles = new Set((data.sheets || []).map((s: any) => s.properties?.title));

    const missingTitles = requiredTitles.filter(t => !existingTitles.has(t));
    if (missingTitles.length === 0) return;

    const requests = missingTitles.map(title => ({
      addSheet: { properties: { title } }
    }));

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ requests })
    });
  } catch (err) {
    console.warn("Error ensuring sheet tabs exist:", err);
  }
}

/**
 * Creates a brand new Spreadsheet for backup.
 */
async function createBackupSpreadsheet(accessToken: string): Promise<string> {
  const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: {
        title: `NGPESP Rotina - Backup (${new Date().toLocaleDateString("pt-BR")})`
      },
      sheets: [
        { properties: { title: "Servidores" } },
        { properties: { title: "Historico Check-ins" } },
        { properties: { title: "Produtividade" } },
        { properties: { title: "Fila Avulsa" } },
        { properties: { title: "Respostas Rapidas" } },
        { properties: { title: "Afastamentos" } },
        { properties: { title: "Codigos Lancamento" } },
        { properties: { title: "Processos SEI" } },
        { properties: { title: "Ferias" } },
        { properties: { title: "Abonos" } },
        { properties: { title: "Balcao Atendimentos" } },
        { properties: { title: "FAQ" } },
        { properties: { title: "_BACKUP_SISTEMA_JSON" } }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new Error("Permissão negada pelo Google. Clique em 'Conectar com o Google' para autorizar o acesso ao Google Drive.");
    }
    throw new Error(err.error?.message || `HTTP ${response.status}: Falha ao criar planilha no Google Drive.`);
  }

  const data = await response.json();
  return data.spreadsheetId;
}

/**
 * Syncs the entire application state into Google Sheets.
 */
export async function syncToGoogleSheets(
  accessToken: string,
  state: AppState,
  spreadsheetId: string | null,
  onProgress: (prog: SyncProgress) => void
): Promise<string> {
  let targetSpreadsheetId = extractSpreadsheetId(spreadsheetId || "") || DEFAULT_SPREADSHEET_ID;

  try {
    if (!accessToken) {
      throw new Error("Sessão do Google expirada. Clique em 'Conectar com o Google' novamente.");
    }

    onProgress({ message: "Verificando estrutura da planilha...", type: "info" });

    // 1. Ensure all required sheet tabs exist
    const requiredTitles = [
      "Servidores", "Historico Check-ins", "Produtividade", "Fila Avulsa",
      "Respostas Rapidas", "Afastamentos", "Codigos Lancamento", "Processos SEI",
      "Ferias", "Abonos", "Balcao Atendimentos", "FAQ", "_BACKUP_SISTEMA_JSON"
    ];

    await ensureSheetTabsExist(accessToken, targetSpreadsheetId, requiredTitles);

    onProgress({ message: "Planilha conectada! Preparando dados...", type: "info" });

    // 2. Prepare Sheet data
    // Servidores Sheet
    const servidoresRows = [
      ["Matricula", "Nome", "Cargo", "Denominacao", "Cod Lotacao", "Lotacao", "Admissao", "Situacao"],
      ...(state.servidores || []).map(s => [
        s.matricula || "", s.nome || "", s.cargo || "", s.denominacao || "",
        s.codLotacao || "", s.lotacao || "", s.admissao || "", s.situacao || ""
      ])
    ];

    // Historico Sheet
    const historicoRows = [
      ["Matricula", "Nome", "Setor", "Qtd", "Data/Hora"],
      ...(state.historico || []).map(h => [
        h.mat || "", h.nome || "", h.setor || "", String(h.qtd || 0), h.ts || ""
      ])
    ];

    // Produtividade Sheet
    const produtividadeRows: string[][] = [
      ["Data", "Turno", "Qtd", "Tipo", "Sistema", "Descricao", "Processos SEI", "Situacao Dia", "Observacao Dia"]
    ];
    for (const [dateStr, day] of Object.entries(state.produtividade || {})) {
      let hasItem = false;
      if (day.manha && day.manha.length > 0) {
        for (const item of day.manha) {
          hasItem = true;
          produtividadeRows.push([
            dateStr, "Manhã", String(item.qtd || 1), item.tipo || "", item.sistema || "",
            item.desc || "", item.processosSei || "", day.situacao || "", day.sitObs || ""
          ]);
        }
      }
      if (day.tarde && day.tarde.length > 0) {
        for (const item of day.tarde) {
          hasItem = true;
          produtividadeRows.push([
            dateStr, "Tarde", String(item.qtd || 1), item.tipo || "", item.sistema || "",
            item.desc || "", item.processosSei || "", day.situacao || "", day.sitObs || ""
          ]);
        }
      }
      if (!hasItem) {
        produtividadeRows.push([
          dateStr, "Geral", "", "", "", "", "", day.situacao || "", day.sitObs || ""
        ]);
      }
    }

    // Fila Avulsa Sheet
    const filaAvulsaRows: string[][] = [
      ["Lista ID", "Ativa?", "Index Ativo", "Matricula", "Nome", "Tipos", "Ocorrencias JSON"]
    ];
    for (const [listId, listObj] of Object.entries(state.filaAvulsa?.listas || {})) {
      const isAtiva = state.filaAvulsa?.ativa === listId ? "SIM" : "NAO";
      const idx = listObj?.idx ?? 0;
      if (listObj?.fila && listObj.fila.length > 0) {
        for (const srv of listObj.fila) {
          filaAvulsaRows.push([
            listId, isAtiva, String(idx), srv.matricula || "", srv.nome || "",
            (srv.tipos || []).join(", "), JSON.stringify(srv.ocorrencias || [])
          ]);
        }
      } else {
        filaAvulsaRows.push([listId, isAtiva, String(idx), "", "", "", ""]);
      }
    }

    // Respostas Sheet
    const respostasRows = [
      ["Nome", "Texto de Resposta"],
      ...(state.respostas || []).map(r => [r.nome || "", r.texto || ""])
    ];

    // Afastamentos Sheet
    const afastamentosRows = [
      ["Dia", "Mes", "Tipo", "SISREF"],
      ...(state.afastamentos || []).map(a => [a.dia || "", a.mes || "", a.tipo || "", a.sisref || ""])
    ];

    // Codigos Lancamento Sheet
    const codigosRows = [
      ["Numero", "Nome", "Periodo"],
      ...(state.codigos || []).map(c => [c.num || "", c.nome || "", c.periodo || ""])
    ];

    // Processos SEI Sheet
    const seiRows = [
      ["Numero Processo", "Descricao"],
      ...(state.sei || []).map(s => [s.num || "", s.desc || ""])
    ];

    // Ferias Sheet
    const feriasRows: string[][] = [
      ["Chave", "P1 Inicio", "P1 Fim", "P1 Processo", "P2 Inicio", "P2 Fim", "P2 Processo", "P3 Inicio", "P3 Fim", "P3 Processo"]
    ];
    for (const [key, periodos] of Object.entries(state.ferias || {})) {
      const p1 = periodos?.[0] || {};
      const p2 = periodos?.[1] || {};
      const p3 = periodos?.[2] || {};
      feriasRows.push([
        key, p1.inicio || "", p1.fim || "", p1.processo || "",
        p2.inicio || "", p2.fim || "", p2.processo || "",
        p3.inicio || "", p3.fim || "", p3.processo || ""
      ]);
    }

    // Abonos Sheet
    const abonosRows: string[][] = [
      ["Chave", "A1 Data", "A1 Processo", "A2 Data", "A2 Processo", "A3 Data", "A3 Processo", "A4 Data", "A4 Processo", "A5 Data", "A5 Processo"]
    ];
    for (const [key, list] of Object.entries(state.abonos || {})) {
      const row = [key];
      for (let i = 0; i < 5; i++) {
        const ab = list?.[i] || {};
        row.push(ab.data || "", ab.processo || "");
      }
      abonosRows.push(row);
    }

    // Balcao Atendimentos Sheet
    const balcaoRows = [
      ["Data", "Anotacoes"],
      ...Object.entries(state.balcaoAtendimentos || {}).map(([dt, txt]) => [dt, txt || ""])
    ];

    // FAQ Sheet
    const faqRows = [
      ["Titulo", "Resposta"],
      ...(state.faq || []).map(f => [f.titulo || "", f.resposta || ""])
    ];

    // JSON Raw Backup Sheet
    const jsonBackupRows = [
      ["Chave", "Conteudo JSON"],
      ["produtividade", JSON.stringify(state.produtividade || {})],
      ["filaAvulsa", JSON.stringify(state.filaAvulsa || {})],
      ["codigos", JSON.stringify(state.codigos || [])],
      ["sei", JSON.stringify(state.sei || [])],
      ["ferias", JSON.stringify(state.ferias || {})],
      ["abonos", JSON.stringify(state.abonos || {})],
      ["balcaoAtendimentos", JSON.stringify(state.balcaoAtendimentos || {})],
      ["faq", JSON.stringify(state.faq || [])],
      ["respostas", JSON.stringify(state.respostas || [])],
      ["afastamentos", JSON.stringify(state.afastamentos || [])],
      ["config", JSON.stringify(state.config || {})]
    ];

    const sheetsData = [
      { name: "Servidores", rows: servidoresRows },
      { name: "Historico Check-ins", rows: historicoRows },
      { name: "Produtividade", rows: produtividadeRows },
      { name: "Fila Avulsa", rows: filaAvulsaRows },
      { name: "Respostas Rapidas", rows: respostasRows },
      { name: "Afastamentos", rows: afastamentosRows },
      { name: "Codigos Lancamento", rows: codigosRows },
      { name: "Processos SEI", rows: seiRows },
      { name: "Ferias", rows: feriasRows },
      { name: "Abonos", rows: abonosRows },
      { name: "Balcao Atendimentos", rows: balcaoRows },
      { name: "FAQ", rows: faqRows },
      { name: "_BACKUP_SISTEMA_JSON", rows: jsonBackupRows }
    ];

    // 3. Write data for each sheet
    for (const sheet of sheetsData) {
      onProgress({ message: `Atualizando aba: ${sheet.name}...`, type: "info" });

      const clearRange = `'${sheet.name}'!A1:Z100000`;
      const putRange = `'${sheet.name}'!A1`;

      // Clear existing content
      const encodedClearRange = encodeURIComponent(clearRange);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodedClearRange}:clear`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          }
        }
      ).catch(e => console.warn("Failed to clear sheet, attempting override:", e));

      // Put new data
      const encodedPutRange = encodeURIComponent(putRange);
      const putRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodedPutRange}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            range: putRange,
            majorDimension: "ROWS",
            values: sheet.rows
          })
        }
      );

      if (!putRes.ok) {
        const errorData = await putRes.json().catch(() => null);
        const errorMsg = errorData?.error?.message || `HTTP ${putRes.status}`;
        console.error(`Write failed for ${sheet.name}: ${errorMsg}`);
      }
    }

    onProgress({ message: "Backup sincronizado com sucesso no Google Sheets!", type: "ok" });
    return targetSpreadsheetId;
  } catch (error: any) {
    console.error("Erro na sincronização:", error);
    onProgress({ message: `Falha na sincronização: ${error.message || error}`, type: "err" });
    throw error;
  }
}

/**
 * Loads ALL state components (Servidores, Historico, Produtividade, Fila Avulsa, Respostas, Afastamentos, Codigos, SEI, Ferias, Abonos, Balcao, FAQ) from Google Sheets Backup.
 */
export async function loadFullStateFromBackup(
  accessToken: string,
  spreadsheetId: string,
  onProgress: (prog: SyncProgress) => void
): Promise<{
  servidores: any[];
  historico: any[];
  respostas: any[];
  afastamentos: any[];
  faq: any[];
  produtividade: Record<string, any>;
  filaAvulsa: any;
  codigos: any[];
  sei: any[];
  ferias: Record<string, any>;
  abonos: Record<string, any>;
  balcaoAtendimentos: Record<string, any>;
  config?: any;
}> {
  try {
    onProgress({ message: "Acessando planilha de backup no Google Drive...", type: "info" });
    const cleanId = extractSpreadsheetId(spreadsheetId) || DEFAULT_SPREADSHEET_ID;

    const ranges = [
      "'Servidores'!A1:Z100000",
      "'Historico Check-ins'!A1:Z100000",
      "'Respostas Rapidas'!A1:Z100000",
      "'Afastamentos'!A1:Z100000",
      "'FAQ'!A1:Z100000",
      "'Produtividade'!A1:Z100000",
      "'Fila Avulsa'!A1:Z100000",
      "'Codigos Lancamento'!A1:Z100000",
      "'Processos SEI'!A1:Z100000",
      "'Ferias'!A1:Z100000",
      "'Abonos'!A1:Z100000",
      "'Balcao Atendimentos'!A1:Z100000",
      "'_BACKUP_SISTEMA_JSON'!A1:Z10000"
    ];

    const encodedRanges = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values:batchGet?${encodedRanges}`;

    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errObj = await response.json().catch(() => ({}));
      if (response.status === 404) {
        throw new Error("Planilha não encontrada. Verifique se o ID ou link da planilha está correto.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("Sem permissão para acessar esta planilha. Reconecte sua conta do Google.");
      }
      throw new Error(errObj.error?.message || `HTTP ${response.status}: Erro ao carregar dados da planilha.`);
    }

    const data = await response.json();
    const valueRanges = data.valueRanges || [];

    // Check JSON Tab first
    let jsonMap = new Map<string, any>();
    const jsonRows: string[][] = valueRanges[12]?.values || [];
    if (jsonRows.length >= 2) {
      for (const row of jsonRows.slice(1)) {
        if (row[0] && row[1]) {
          try {
            jsonMap.set(row[0], JSON.parse(row[1]));
          } catch (_) {}
        }
      }
    }

    // 1. Servidores
    let servidores: any[] = [];
    const servRows: string[][] = valueRanges[0]?.values || [];
    if (servRows.length >= 2) {
      const headers = servRows[0].map(h => String(h).trim().toUpperCase());
      servidores = servRows.slice(1).map(row => {
        const obj: any = {};
        headers.forEach((h, idx) => {
          const val = row[idx] || "";
          if (h === "MATRICULA") obj.matricula = val;
          else if (h === "NOME") obj.nome = val;
          else if (h === "CARGO") obj.cargo = val;
          else if (h === "DENOMINACAO") obj.denominacao = val;
          else if (h === "COD LOTACAO") obj.codLotacao = val;
          else if (h === "LOTACAO") obj.lotacao = val;
          else if (h === "ADMISSAO") obj.admissao = val;
          else if (h === "SITUACAO") obj.situacao = val;
        });
        return obj;
      }).filter(s => s.matricula && s.nome);
    }

    // 2. Historico Check-ins
    let historico: any[] = [];
    const histRows: string[][] = valueRanges[1]?.values || [];
    if (histRows.length >= 2) {
      historico = histRows.slice(1).map(row => ({
        mat: row[0] || "",
        nome: row[1] || "",
        setor: row[2] || "",
        qtd: Number(row[3] || 0),
        ts: row[4] || ""
      })).filter(h => h.mat || h.nome);
    }

    // 3. Respostas Rapidas
    let respostas: any[] = jsonMap.get("respostas") || [];
    if (!respostas || respostas.length === 0) {
      const respRows: string[][] = valueRanges[2]?.values || [];
      if (respRows.length >= 2) {
        respostas = respRows.slice(1).map(row => ({
          nome: row[0] || "",
          texto: row[1] || ""
        })).filter(r => r.nome);
      }
    }

    // 4. Afastamentos
    let afastamentos: any[] = jsonMap.get("afastamentos") || [];
    if (!afastamentos || afastamentos.length === 0) {
      const afastRows: string[][] = valueRanges[3]?.values || [];
      if (afastRows.length >= 2) {
        afastamentos = afastRows.slice(1).map(row => ({
          dia: row[0] || "",
          mes: row[1] || "",
          tipo: row[2] || "",
          sisref: row[3] || ""
        })).filter(a => a.dia && a.tipo);
      }
    }

    // 5. FAQ
    let faq: any[] = jsonMap.get("faq") || [];
    if (!faq || faq.length === 0) {
      const faqRows: string[][] = valueRanges[4]?.values || [];
      if (faqRows.length >= 2) {
        faq = faqRows.slice(1).map(row => ({
          titulo: row[0] || "",
          resposta: row[1] || ""
        })).filter(f => f.titulo);
      }
    }

    // 6. Produtividade
    let produtividade: Record<string, any> = jsonMap.get("produtividade") || {};
    if (!produtividade || Object.keys(produtividade).length === 0) {
      produtividade = {};
      const prodRows: string[][] = valueRanges[5]?.values || [];
      if (prodRows.length >= 2) {
        for (const row of prodRows.slice(1)) {
          const dateStr = row[0];
          if (!dateStr) continue;
          const turno = row[1];
          const qtd = row[2];
          const tipo = row[3];
          const sistema = row[4];
          const desc = row[5];
          const processosSei = row[6];
          const situacao = row[7];
          const sitObs = row[8];

          if (!produtividade[dateStr]) {
            produtividade[dateStr] = { situacao: situacao || "", sitObs: sitObs || "", manha: [], tarde: [] };
          }
          if (situacao) produtividade[dateStr].situacao = situacao;
          if (sitObs) produtividade[dateStr].sitObs = sitObs;

          if (tipo || desc || qtd) {
            const item = { qtd: Number(qtd) || 1, tipo: tipo || "", sistema: sistema || "", desc: desc || "", processosSei: processosSei || "" };
            if (turno === "Tarde") produtividade[dateStr].tarde.push(item);
            else if (turno === "Manhã") produtividade[dateStr].manha.push(item);
          }
        }
      }
    }

    // 7. Fila Avulsa
    let filaAvulsa: any = jsonMap.get("filaAvulsa") || null;
    if (!filaAvulsa || !filaAvulsa.listas || Object.keys(filaAvulsa.listas).length === 0) {
      const filaRows: string[][] = valueRanges[6]?.values || [];
      if (filaRows.length >= 2) {
        const listas: Record<string, any> = {};
        let ativa = "Padrão";
        for (const row of filaRows.slice(1)) {
          const [listId, isAtivaStr, idxStr, mat, nome, tiposStr, ocorrenciasJson] = row;
          if (!listId) continue;
          if (isAtivaStr?.toUpperCase() === "SIM") ativa = listId;
          const idx = Number(idxStr || 0);
          if (!listas[listId]) listas[listId] = { fila: [], idx };
          if (mat || nome) {
            const tipos = (tiposStr || "").split(/[,;]/).map(t => t.trim()).filter(Boolean);
            let ocorrencias = [];
            if (ocorrenciasJson) {
              try { ocorrencias = JSON.parse(ocorrenciasJson); } catch (_) {}
            }
            listas[listId].fila.push({ matricula: mat || "", nome: nome || "", tipos, ocorrencias });
          }
        }
        if (Object.keys(listas).length > 0) {
          filaAvulsa = {
            listas,
            ativa,
            natal: [],
            configProd: {
              tipos: ["documento", "processo", "análise", "atendimento", "reunião", "outro"],
              sistemas: ["SISREF", "SEI", "SIAPE", "SOUGOV", "E-mail", "Físico", "Outro"]
            },
            pendencias: []
          };
        }
      }
    }

    // 8. Codigos
    let codigos: any[] = jsonMap.get("codigos") || [];
    if (!codigos || codigos.length === 0) {
      const codRows: string[][] = valueRanges[7]?.values || [];
      if (codRows.length >= 2) {
        codigos = codRows.slice(1).map(row => ({
          num: row[0] || "", nome: row[1] || "", periodo: row[2] || ""
        })).filter(c => c.num || c.nome);
      }
    }

    // 9. SEI
    let sei: any[] = jsonMap.get("sei") || [];
    if (!sei || sei.length === 0) {
      const seiRows: string[][] = valueRanges[8]?.values || [];
      if (seiRows.length >= 2) {
        sei = seiRows.slice(1).map(row => ({
          num: row[0] || "", desc: row[1] || ""
        })).filter(s => s.num);
      }
    }

    // 10. Ferias
    let ferias: Record<string, any> = jsonMap.get("ferias") || {};
    if (!ferias || Object.keys(ferias).length === 0) {
      ferias = {};
      const feriasRows: string[][] = valueRanges[9]?.values || [];
      if (feriasRows.length >= 2) {
        for (const row of feriasRows.slice(1)) {
          const key = row[0];
          if (!key) continue;
          ferias[key] = [
            { inicio: row[1] || "", fim: row[2] || "", processo: row[3] || "" },
            { inicio: row[4] || "", fim: row[5] || "", processo: row[6] || "" },
            { inicio: row[7] || "", fim: row[8] || "", processo: row[9] || "" }
          ];
        }
      }
    }

    // 11. Abonos
    let abonos: Record<string, any> = jsonMap.get("abonos") || {};
    if (!abonos || Object.keys(abonos).length === 0) {
      abonos = {};
      const abonosRows: string[][] = valueRanges[10]?.values || [];
      if (abonosRows.length >= 2) {
        for (const row of abonosRows.slice(1)) {
          const key = row[0];
          if (!key) continue;
          const list = [];
          for (let i = 0; i < 5; i++) {
            const dt = row[1 + i * 2] || "";
            const pr = row[2 + i * 2] || "";
            list.push({ data: dt, processo: pr });
          }
          abonos[key] = list;
        }
      }
    }

    // 12. Balcao
    let balcaoAtendimentos: Record<string, any> = jsonMap.get("balcaoAtendimentos") || {};
    if (!balcaoAtendimentos || Object.keys(balcaoAtendimentos).length === 0) {
      balcaoAtendimentos = {};
      const balcaoRows: string[][] = valueRanges[11]?.values || [];
      if (balcaoRows.length >= 2) {
        for (const row of balcaoRows.slice(1)) {
          if (row[0]) balcaoAtendimentos[row[0]] = row[1] || "";
        }
      }
    }

    // 13. Config
    const config = jsonMap.get("config") || {};

    onProgress({ message: `Dados carregados com sucesso! (${servidores.length} servidores)`, type: "ok" });
    return {
      servidores, historico, respostas, afastamentos, faq,
      produtividade, filaAvulsa, codigos, sei, ferias, abonos,
      balcaoAtendimentos, config
    };
  } catch (err: any) {
    console.error("Erro ao importar backup completo:", err);
    onProgress({ message: `Erro ao importar: ${err.message || err}`, type: "err" });
    throw err;
  }
}

/**
 * Restores or appends servers from a Google Sheet Backup.
 */
export async function loadServersFromBackup(
  accessToken: string,
  spreadsheetId: string,
  onProgress: (prog: SyncProgress) => void
): Promise<any[]> {
  const full = await loadFullStateFromBackup(accessToken, spreadsheetId, onProgress);
  return full.servidores;
}
