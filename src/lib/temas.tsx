import React from "react";
import { Sun, SunDim, CloudMoon, Moon, Droplet } from "lucide-react";

export type Tema = "claro" | "suave" | "penumbra" | "escuro" | "petroleo";

export const TEMAS: { id: Tema; nome: string; escuro: boolean }[] = [
  { id: "claro", nome: "Claro", escuro: false },
  { id: "suave", nome: "Suave (claro acinzentado)", escuro: false },
  { id: "penumbra", nome: "Penumbra (escuro suave)", escuro: true },
  { id: "escuro", nome: "Escuro", escuro: true },
  { id: "petroleo", nome: "Petróleo", escuro: true }
];

export function temaValido(v: any): Tema {
  return TEMAS.some(t => t.id === v) ? v : "claro";
}

export function proximoTema(t: Tema): Tema {
  const i = TEMAS.findIndex(x => x.id === t);
  return TEMAS[(i + 1) % TEMAS.length].id;
}

export function nomeTema(t: Tema): string {
  return TEMAS.find(x => x.id === t)?.nome || t;
}

export function IconeTema({ tema, size = 16 }: { tema: Tema; size?: number }) {
  if (tema === "suave") return <SunDim size={size} />;
  if (tema === "penumbra") return <CloudMoon size={size} />;
  if (tema === "escuro") return <Moon size={size} />;
  if (tema === "petroleo") return <Droplet size={size} />;
  return <Sun size={size} />;
}

/** Aplica o tema na página (atributo + classes usadas pelas cores). */
export function aplicarTema(tema: Tema) {
  const escuro = TEMAS.find(x => x.id === tema)?.escuro;
  [document.documentElement, document.body].forEach(el => {
    el.setAttribute("data-theme", tema);
    el.classList.remove(...TEMAS.map(t => "theme-" + t.id), "dark");
    el.classList.add("theme-" + tema);
    if (escuro) el.classList.add("dark");
  });
}
