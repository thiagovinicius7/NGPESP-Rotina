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
        { properties: { title: "Respostas Rapidas" } },
        { properties: { title: "Afastamentos" } },
        { properties: { title: "FAQ" } }
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
  let targetSpreadsheetId = spreadsheetId;

  try {
    if (!accessToken) {
      throw new Error("Sessão do Google expirada. Clique em 'Conectar com o Google' novamente.");
    }

    if (!targetSpreadsheetId) {
      onProgress({ message: "Criando nova planilha de backup no Google Drive...", type: "info" });
      targetSpreadsheetId = await createBackupSpreadsheet(accessToken);
    }

    onProgress({ message: "Planilha conectada! Preparando dados...", type: "info" });

    // 1. Prepare Sheet data
    // Servidores Sheet
    const servidoresRows = [
      ["Matricula", "Nome", "Cargo", "Denominacao", "Cod Lotacao", "Lotacao", "Admissao", "Situacao"],
      ...state.servidores.map(s => [
        s.matricula || "",
        s.nome || "",
        s.cargo || "",
        s.denominacao || "",
        s.codLotacao || "",
        s.lotacao || "",
        s.admissao || "",
        s.situacao || ""
      ])
    ];

    // Historico Sheet
    const historicoRows = [
      ["Matricula", "Nome", "Setor", "Qtd", "Data/Hora"],
      ...state.historico.map(h => [
        h.mat || "",
        h.nome || "",
        h.setor || "",
        String(h.qtd || 0),
        h.ts || ""
      ])
    ];

    // Respostas Sheet
    const respostasRows = [
      ["Nome", "Texto de Resposta"],
      ...state.respostas.map(r => [r.nome || "", r.texto || ""])
    ];

    // Afastamentos Sheet
    const afastamentosRows = [
      ["Dia", "Mes", "Tipo", "SISREF"],
      ...state.afastamentos.map(a => [a.dia || "", a.mes || "", a.tipo || "", a.sisref || ""])
    ];

    // FAQ Sheet
    const faqRows = [
      ["Titulo", "Resposta"],
      ...state.faq.map(f => [f.titulo || "", f.resposta || ""])
    ];

    const sheetsData = [
      { name: "Servidores", rows: servidoresRows },
      { name: "Historico Check-ins", rows: historicoRows },
      { name: "Respostas Rapidas", rows: respostasRows },
      { name: "Afastamentos", rows: afastamentosRows },
      { name: "FAQ", rows: faqRows }
    ];

    // 2. Write data for each sheet
    for (const sheet of sheetsData) {
      onProgress({ message: `Atualizando aba: ${sheet.name}...`, type: "info" });

      const clearRange = `'${sheet.name}'!A1:Z100000`;
      const putRange = `'${sheet.name}'!A1`;

      // First, try to clear existing content to avoid stale data
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

      // Put the new data
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
        console.warn(`Initial write failed for ${sheet.name}: ${errorMsg}. Attempting to create/verify sheet tab...`);

        // Sheet might not exist, let's try to add the sheet tab first
        onProgress({ message: `Aba ${sheet.name} não pôde ser atualizada diretamente. Criando aba...`, type: "info" });
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}:batchUpdate`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: { title: sheet.name }
                }
              }
            ]
          })
        }).catch(e => console.warn("Ignoring error while trying to add sheet, might already exist", e));

        // Retry writing data
        const retryPut = await fetch(
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

        if (!retryPut.ok) {
          const retryErrorData = await retryPut.json().catch(() => null);
          const retryErrorMsg = retryErrorData?.error?.message || `HTTP ${retryPut.status}`;
          console.error(`Retry write failed for ${sheet.name}:`, retryErrorData);
          throw new Error(`Erro ao escrever dados na aba '${sheet.name}': ${retryErrorMsg}`);
        }
      }
    }

    onProgress({ message: "Backup sincronizado com sucesso!", type: "ok" });
    return targetSpreadsheetId;
  } catch (error: any) {
    console.error("Erro na sincronização:", error);
    onProgress({ message: `Falha na sincronização: ${error.message || error}`, type: "err" });
    throw error;
  }
}

/**
 * Loads ALL state components (Servidores, Historico, Respostas, Afastamentos, FAQ) from Google Sheets Backup.
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
}> {
  try {
    onProgress({ message: "Acessando planilha de backup no Google Drive...", type: "info" });
    const cleanId = extractSpreadsheetId(spreadsheetId);
    if (!cleanId) {
      throw new Error("ID da planilha não fornecido ou inválido.");
    }

    const ranges = [
      "'Servidores'!A1:Z100000",
      "'Historico Check-ins'!A1:Z100000",
      "'Respostas Rapidas'!A1:Z100000",
      "'Afastamentos'!A1:Z100000",
      "'FAQ'!A1:Z100000"
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
    let respostas: any[] = [];
    const respRows: string[][] = valueRanges[2]?.values || [];
    if (respRows.length >= 2) {
      respostas = respRows.slice(1).map(row => ({
        nome: row[0] || "",
        texto: row[1] || ""
      })).filter(r => r.nome);
    }

    // 4. Afastamentos
    let afastamentos: any[] = [];
    const afastRows: string[][] = valueRanges[3]?.values || [];
    if (afastRows.length >= 2) {
      afastamentos = afastRows.slice(1).map(row => ({
        dia: row[0] || "",
        mes: row[1] || "",
        tipo: row[2] || "",
        sisref: row[3] || ""
      })).filter(a => a.dia && a.tipo);
    }

    // 5. FAQ
    let faq: any[] = [];
    const faqRows: string[][] = valueRanges[4]?.values || [];
    if (faqRows.length >= 2) {
      faq = faqRows.slice(1).map(row => ({
        titulo: row[0] || "",
        resposta: row[1] || ""
      })).filter(f => f.titulo);
    }

    onProgress({ message: `Dados carregados com sucesso! (${servidores.length} servidores)`, type: "ok" });
    return { servidores, historico, respostas, afastamentos, faq };
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
