/** Exportação simples de tabelas dos relatórios: copiar para Excel, baixar CSV e imprimir. */

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

async function copiarTexto(txt: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }
}

export function copiarTabela(headers: string[], rows: (string | number)[][]): Promise<boolean> {
  const limpa = (v: any) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return copiarTexto([headers.map(limpa).join("\t"), ...rows.map(r => r.map(limpa).join("\t"))].join("\n"));
}

export { copiarTexto };

export function baixarCSV(nomeArquivo: string, headers: string[], rows: (string | number)[][]) {
  const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [headers.map(q).join(";"), ...rows.map(r => r.map(q).join(";"))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : nomeArquivo + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Imprime só a tabela (num quadro escondido), sem o restante do sistema. */
export function imprimirTabela(titulo: string, subtitulo: string, headers: string[], rows: (string | number)[][]) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}
  h1{font-size:16px;margin:0 0 4px} p{font-size:11px;color:#555;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#eee} tr:nth-child(even) td{background:#fafafa}
</style></head><body>
<h1>${esc(titulo)}</h1><p>${esc(subtitulo)} · gerado em ${esc(new Date().toLocaleString("pt-BR"))}</p>
<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1500);
  }, 250);
}
