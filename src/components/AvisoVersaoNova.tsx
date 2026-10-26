import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** Versão do app em uso (o nome do arquivo principal muda a cada publicação). */
function versaoAtual(): string {
  const s = Array.from(document.querySelectorAll("script[src]")).map(x => x.getAttribute("src") || "").find(src => /assets\/index-[^/]+\.js/.test(src));
  return s ? (s.match(/index-[^/]+\.js/) || [""])[0] : "";
}

async function versaoPublicada(): Promise<string> {
  const r = await fetch(`${location.pathname}?v=${Date.now()}`, { cache: "no-store" });
  const html = await r.text();
  return (html.match(/assets\/(index-[^"']+\.js)/) || ["", ""])[1];
}

/**
 * Avisa quando há uma versão nova publicada e atualiza sozinho ao voltar para a aba,
 * se não houver nada esperando para ir à nuvem. Evita trabalhar o dia todo numa versão antiga.
 */
export default function AvisoVersaoNova({ podeAtualizarSozinho }: { podeAtualizarSozinho: boolean }) {
  const [nova, setNova] = useState(false);

  useEffect(() => {
    const atual = versaoAtual();
    if (!atual) return; // modo de desenvolvimento
    let ativo = true;
    const checar = async () => {
      try {
        const pub = await versaoPublicada();
        if (ativo && pub && pub !== atual) setNova(true);
      } catch (_) { /* sem internet: tenta depois */ }
    };
    checar();
    const t = setInterval(checar, 5 * 60 * 1000);
    const aoVoltar = () => { if (document.visibilityState === "visible") checar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => { ativo = false; clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); window.removeEventListener("focus", aoVoltar); };
  }, []);

  // Atualiza sozinho quando a pessoa volta para a aba e não há nada pendente
  useEffect(() => {
    if (!nova || !podeAtualizarSozinho) return;
    const aoVoltar = () => { if (document.visibilityState === "visible") location.reload(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [nova, podeAtualizarSozinho]);

  if (!nova) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100%-2rem)] px-4 py-3 rounded-2xl shadow-lg border border-[var(--blue-mid)]/40 bg-[var(--surface)] flex items-center gap-3 flex-wrap">
      <span className="text-xs font-bold text-[var(--text)]">Há uma versão nova do app.</span>
      <button type="button" onClick={() => location.reload()} className="px-3 py-1.5 rounded-lg bg-[var(--blue-mid)] text-white text-xs font-bold flex items-center gap-1">
        <RefreshCw size={13} /> Atualizar agora
      </button>
    </div>
  );
}
