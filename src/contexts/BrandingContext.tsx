 import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
 import { api, API_BASE } from "@/lib/api";

export interface TenantBrand {
  id?: string;
  slug?: string;
  brandName?: string;
  brandLogoUrl?: string;
  brandBannerUrl?: string;
  brandMobileBannerUrl?: string;
  brandPrimaryColor?: string; // hex (#1e3a8a) ou HSL "222 47% 18%"
  brandAccentColor?: string;
  brandTheme?: "light" | "dark" | "system";
  brandHighlightTheme?: string;
  brandDarkBannerUrl?: string;
  brandDarkLogoUrl?: string;
  brandCoursesLayout?: "netflix" | "grid" | "neon" | "cinema" | string;
}

interface BrandingContextValue {
  brand: TenantBrand | null;
  setBrand: (b: TenantBrand | null) => void;
   refreshFromHost: (forceHost?: string) => Promise<void>;
  loading: boolean;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

const DEFAULT_BRAND: TenantBrand = { brandName: "", slug: "" };

/** Converte hex -> "h s% l%" para CSS variable */
function hexToHslVar(hex: string): string | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hh = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hh = (b - r) / d + 2; break;
      case b: hh = (r - g) / d + 4; break;
    }
    hh /= 6;
  }
  return `${Math.round(hh * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function normalizeColor(c?: string): string | null {
  if (!c) return null;
  if (c.startsWith("#")) return hexToHslVar(c);
  // já está em "h s% l%"
  if (/^\d+\s+\d+%\s+\d+%/.test(c)) return c;
  return null;
}

/** Dado "h s% l%", retorna foreground contrastante ("0 0% 100%" ou "0 0% 10%") */
function contrastForeground(hsl: string): string {
  const m = hsl.match(/^(\d+)\s+(\d+)%\s+(\d+)%/);
  if (!m) return "0 0% 100%";
  const l = Number(m[3]);
  return l < 60 ? "0 0% 100%" : "240 10% 10%";
}

function applyBrandToCss(brand: TenantBrand | null) {
  const root = document.documentElement;
  const primary = normalizeColor(brand?.brandPrimaryColor || undefined);
  const accent = normalizeColor(brand?.brandAccentColor || undefined);
  
  // Limpar classes de tema anteriores
  root.classList.remove("theme-premium", "theme-neon", "theme-impact", "theme-classic");
  
  if (brand?.brandHighlightTheme) {
    root.classList.add(`theme-${brand.brandHighlightTheme}`);
  }

  if (primary) {
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-background", primary);
    const pf = contrastForeground(primary);
    root.style.setProperty("--primary-foreground", pf);
    root.style.setProperty("--sidebar-foreground", pf);
    root.style.setProperty("--sidebar-primary-foreground", pf);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--sidebar-background");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--sidebar-foreground");
    root.style.removeProperty("--sidebar-primary-foreground");
  }
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--sidebar-primary", accent);
    const af = contrastForeground(accent);
    root.style.setProperty("--accent-foreground", af);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--accent-foreground");
  }
  if (brand?.brandName) document.title = brand.brandName;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<TenantBrand | null>(null);
  const [loading, setLoading] = useState(true);

  const setBrand = useCallback(
    (b: TenantBrand | null) => {
      // Se b for null, tentamos manter o slug atual se ele veio do host
      // para não perder o branding white-label no logout
      const merged = b ? { ...DEFAULT_BRAND, ...b } : DEFAULT_BRAND;
      setBrandState(merged);
      applyBrandToCss(merged);
    },
    []
  );

   const refreshFromHost = useCallback(async (forceHost?: string) => {
     setLoading(true);
     try {
       const host = (forceHost || window.location.hostname).toLowerCase();
       
        // Tenta primeiro o host exato
        const res = await fetch(`${API_BASE}/public/tenant-by-host?host=${encodeURIComponent(host)}`);
        
        let data: TenantBrand | null = null;
        if (res.ok) {
          const text = await res.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              console.error("Falha ao parsear branding:", e);
            }
          }
        }

        // Se não encontrou e tem prefixo comum, tenta sem o prefixo
        if (!data && (host.startsWith('app.') || host.startsWith('portal.'))) {
          const fallbackHost = host.replace(/^(app|portal)\./, '');
          const resFallback = await fetch(`${API_BASE}/public/tenant-by-host?host=${encodeURIComponent(fallbackHost)}`);
          if (resFallback.ok) {
            const text = await resFallback.text();
            if (text) {
              try {
                data = JSON.parse(text);
              } catch (e) {
                console.error("Falha ao parsear branding fallback:", e);
              }
            }
          }
        }

       if (data && (data.brandName || data.slug)) {
         setBrand(data);
       } else {
         // Se chegamos aqui e não temos dados, garantimos que o brand resete para o default
         // mas mantemos o loading false para o app prosseguir
         setBrand(null);
       }
     } catch (err) {
       // A API fora do ar (502/CORS) não deve poluir o console a cada carga de
       // página — o usuário não pode corrigir isso e o erro mascarava o
       // diagnóstico real. O branding cai no default e o app segue.
       console.warn("Branding indisponível (API fora do ar?):", err instanceof Error ? err.message : err);
       setBrand(null);
     } finally {
       setLoading(false);
     }
   }, [setBrand]);

  // Bootstrap: tenta resolver tenant por host antes de qualquer login
  useEffect(() => {
    refreshFromHost();
  }, [refreshFromHost]);

  return (
    <BrandingContext.Provider value={{ brand: brand || DEFAULT_BRAND, setBrand, refreshFromHost, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be inside BrandingProvider");
  return ctx;
}
