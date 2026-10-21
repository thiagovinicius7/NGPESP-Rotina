/** Lembrete de backup: guarda neste navegador quando foi baixada a última cópia. */
const CHAVE = "ngpesp_ultimo_backup";

export function marcarBackupFeito() {
  try { localStorage.setItem(CHAVE, String(Date.now())); } catch (_) { /* sem armazenamento */ }
}

/** Dias desde o último backup baixado neste navegador; null se nunca (ou sem armazenamento). */
export function diasDesdeBackup(): number | null {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    if (!v) return null;
    return Math.floor((Date.now() - v) / 86400000);
  } catch (_) {
    return null;
  }
}

export const DIAS_LEMBRETE_BACKUP = 7;

export function precisaLembrarBackup(): boolean {
  const d = diasDesdeBackup();
  return d === null || d >= DIAS_LEMBRETE_BACKUP;
}

/** Baixa o backup completo (.json) deste estado e registra a data. */
export function baixarBackup(state: unknown) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sisref_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  marcarBackupFeito();
}
