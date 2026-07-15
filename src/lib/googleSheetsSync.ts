import { AppState } from "../types.js";

interface SyncProgress {
  message: string;
  type: 'info' | 'ok' | 'err';
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
    throw new Error(err.error?.message || "Falha ao criar planilha no Google Drive.");
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
 * Restores or appends servers from a Google Sheet Backup.
 */
export async function loadServersFromBackup(
  accessToken: string,
  spreadsheetId: string,
  onProgress: (prog: SyncProgress) => void
): Promise<any[]> {
  try {
    onProgress({ message: "Carregando servidores do backup...", type: "info" });
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Servidores'!A1:H100000`,
      {
        headers: { "Authorization": `Bearer ${accessToken}` }
      }
    );

    if (!response.ok) {
      throw new Error("Erro ao acessar a aba 'Servidores' na planilha.");
    }

    const data = await response.json();
    const rows: string[][] = data.values;
    if (!rows || rows.length < 2) {
      return [];
    }

    const headers = rows[0].map(h => h.trim().toUpperCase());
    const servers = rows.slice(1).map(row => {
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

    return servers;
  } catch (err: any) {
    console.error("Erro ao importar do backup:", err);
    onProgress({ message: `Erro ao importar: ${err.message || err}`, type: "err" });
    throw err;
  }
}
