import { Server, LancamentoAnteriorItem } from "../types.js";
import { normalizeMatricula, cleanTipoName } from "./utils.js";

/**
 * Parses free-form text copied from SISREF, SIGRH, or spreadsheets
 * containing legacy / prior absences and occurrences.
 * 
 * Supported patterns:
 * 1. Multi-line blocks (typical SISREF report copy):
 *    MM/YYYY (e.g. 05/2025)
 *    DD/MM/YYYY (e.g. 05/05/2025, or consecutive dates 26/08/2025 \n 27/08/2025...)
 *    Tipo [TAB] Matricula - Nome [TAB] Status...
 * 
 * 2. Tab-separated or single-line tabular rows:
 *    MM/YYYY [TAB] DD/MM/YYYY [TAB] Tipo [TAB] Matricula - Nome [TAB] Status
 * 
 * 3. Matricula - Nome followed by dates and leave type.
 */
export function parseLancamentosAnterioresText(
  rawText: string,
  servidores: Server[] = []
): LancamentoAnteriorItem[] {
  if (!rawText || !rawText.trim()) return [];

  // Index servers by normalized matricula and uppercase name for fast enrichment
  const servByMat = new Map<string, Server>();
  const servByNome = new Map<string, Server>();
  servidores.forEach(s => {
    const nMat = normalizeMatricula(s.matricula);
    if (nMat) servByMat.set(nMat, s);
    if (s.nome) servByNome.set(s.nome.trim().toUpperCase(), s);
  });

  const results: LancamentoAnteriorItem[] = [];
  const seenKeys = new Set<string>();

  const lines = rawText.split(/\r?\n/);
  
  let currentMesAnoYmd: string | null = null; // e.g. "2025-05"
  let pendingDates: string[] = [];

  const addResult = (
    mat: string,
    nome: string,
    tipo: string,
    dateStr: string,
    mesAnoYmd: string,
    status?: string,
    rawLine?: string
  ) => {
    const cleanMat = normalizeMatricula(mat);
    if (!cleanMat) return;

    // Check if server is in base
    const srv = servByMat.get(cleanMat) || (nome ? servByNome.get(nome.trim().toUpperCase()) : undefined);
    const finalNome = srv?.nome || (nome ? nome.trim() : `Servidor ${mat}`);
    const finalMat = srv?.matricula || mat.trim();
    const finalTipo = cleanTipoName(tipo) || tipo.trim() || "Afastamento / Ocorrência";
    const finalMesAno = mesAnoYmd || (dateStr.includes("/") ? extractMesAnoFromDate(dateStr) : "");

    const dedupeKey = `${cleanMat}_${finalTipo.toLowerCase()}_${dateStr}_${finalMesAno}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      results.push({
        id: `ant_${cleanMat}_${results.length}_${Date.now()}`,
        matricula: finalMat,
        nome: finalNome,
        tipo: finalTipo,
        dataOcorrencia: dateStr,
        mesAnoOcorrencia: finalMesAno,
        status: status || "Identificado",
        origemTexto: rawLine ? rawLine.slice(0, 160) : undefined,
        criadoEm: new Date().toISOString()
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;

    // Check if line is purely a Month/Year header: e.g. "05/2025", "12/2025", "2025-05"
    const monthHeaderMatch = line.match(/^(\d{1,2})\/(\d{4})$/);
    if (monthHeaderMatch) {
      const mm = monthHeaderMatch[1].padStart(2, '0');
      const yyyy = monthHeaderMatch[2];
      currentMesAnoYmd = `${yyyy}-${mm}`;
      continue;
    }

    // Check if line is purely a Date: e.g. "05/05/2025" or "26/08/2025"
    const singleDateMatch = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (singleDateMatch) {
      pendingDates.push(line);
      // If we don't have a month yet, infer it from this date
      if (!currentMesAnoYmd) {
        currentMesAnoYmd = extractMesAnoFromDate(line);
      }
      continue;
    }

    // Check if the line contains matricula and name: "16802179 - Adriana de Fatima Holanda Fialho"
    // or tabular columns
    const matNomeMatch = line.match(/(\d{6,10})\s*[-–]\s*([^\t\r\n\(\);]+)/);
    
    // Also check if line has tab-separated matricula like "16802179" \t "Adriana de Fatima"
    const tabs = line.split("\t").map(t => t.trim()).filter(Boolean);
    const tabWithMat = tabs.find(t => /^\d{6,10}$/.test(t));

    if (matNomeMatch || tabWithMat) {
      let mat = "";
      let nome = "";
      let tipo = "";
      let status = "";

      if (matNomeMatch) {
        mat = matNomeMatch[1].trim();
        nome = matNomeMatch[2].trim();
        
        // Remove trailing status words if captured in nome
        const cleanNomeMatch = nome.match(/^([A-Za-zÀ-ÿ\s'.]+)/);
        if (cleanNomeMatch) {
          nome = cleanNomeMatch[1].trim();
        }

        // Tipo is typically before the matricula in tabs or at the beginning of the line
        if (tabs.length > 1) {
          const matIdx = tabs.findIndex(t => t.includes(mat));
          if (matIdx > 0) {
            tipo = tabs[0];
          }
          // Status is in the remaining columns
          const statusCandidates = tabs.slice(matIdx + 1).join(" ");
          status = extractStatus(statusCandidates);
        } else {
          // Line without tabs: extract whatever precedes the matricula
          const preMat = line.substring(0, line.indexOf(matNomeMatch[0])).trim();
          tipo = preMat || "Afastamento";
          const postMat = line.substring(line.indexOf(matNomeMatch[0]) + matNomeMatch[0].length).trim();
          status = extractStatus(postMat);
        }
      } else if (tabWithMat) {
        mat = tabWithMat;
        const matIdx = tabs.indexOf(tabWithMat);
        nome = tabs[matIdx + 1] && !/^\d+$/.test(tabs[matIdx + 1]) ? tabs[matIdx + 1] : "";
        tipo = matIdx > 0 ? tabs[0] : (tabs[matIdx + 2] || "Afastamento");
        status = extractStatus(tabs.slice(matIdx + 1).join(" "));
      }

      // Check if line also had inline dates: e.g. "05/05/2025" in one of the columns
      const inlineDates = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || [];
      const effectiveDates = inlineDates.length > 0 ? inlineDates : pendingDates;

      let dateStr = "";
      if (effectiveDates.length === 1) {
        dateStr = effectiveDates[0];
      } else if (effectiveDates.length > 1) {
        dateStr = `${effectiveDates[0]} a ${effectiveDates[effectiveDates.length - 1]} (${effectiveDates.length} dias)`;
      } else if (currentMesAnoYmd) {
        const [y, m] = currentMesAnoYmd.split("-");
        dateStr = `01/${m}/${y}`;
      } else {
        dateStr = "Data não especificada";
      }

      // Extract or fallback month/year
      let recordMonth = currentMesAnoYmd;
      if (effectiveDates.length > 0) {
        recordMonth = extractMesAnoFromDate(effectiveDates[0]) || recordMonth;
      }

      if (mat && recordMonth) {
        addResult(mat, nome, tipo, dateStr, recordMonth, status, line);
      }

      // Clear pending dates after consuming them for this server record
      pendingDates = [];
      continue;
    }

    // Fallback: check if line is tabular format with dates and server info
    const datesInLine = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
    if (datesInLine && datesInLine.length > 0) {
      // Line contains a date and maybe other fields
      pendingDates.push(...datesInLine);
      if (!currentMesAnoYmd) {
        currentMesAnoYmd = extractMesAnoFromDate(datesInLine[0]);
      }
    }
  }

  return results;
}

/**
 * Extracts YYYY-MM from a DD/MM/YYYY date string.
 */
function extractMesAnoFromDate(dateStr: string): string {
  const match = dateStr.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return "";
  const mm = match[2].padStart(2, '0');
  let yyyy = match[3];
  if (yyyy.length === 2) {
    const yyNum = parseInt(yyyy, 10);
    yyyy = String(yyNum < 70 ? 2000 + yyNum : 1900 + yyNum);
  }
  return `${yyyy}-${mm}`;
}

/**
 * Extracts standardized status from trailing text (e.g. Aprovado, Rejeitado, Anexado).
 */
function extractStatus(text: string): string {
  if (!text) return "Identificado";
  const lower = text.toLowerCase();
  if (lower.includes("aprovado") && !lower.includes("rejeitado")) return "Aprovado";
  if (lower.includes("rejeitado")) return "Rejeitado";
  if (lower.includes("homologado")) return "Homologado";
  if (lower.includes("anexado")) return "Anexado";
  if (lower.includes("pendente")) return "Pendente";
  if (lower.includes("cancelado")) return "Cancelado";
  return "Identificado";
}
