 import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, setToken, getToken } from "@/lib/api";
import { useBranding } from "./BrandingContext";

 export type Role = "super_admin" | "mentor" | "mentor_team" | "mentorado" | "prospect" | "admin" | "editor" | "attendant";

export interface SessionUser {
  id: string;
   email: string;
   phone?: string;
  name: string;
  role: Role;
  slug?: string;
  brandName?: string;
  brandLogoUrl?: string;
  brandBannerUrl?: string;
  brandMobileBannerUrl?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandTheme?: "light" | "dark" | "system";
  brandHighlightTheme?: string;
  brandDarkBannerUrl?: string;
  brandDarkLogoUrl?: string;
  onboardingCompleted?: boolean;
  mentorId?: string;
  parentMentorId?: string;
  teamRole?: "admin" | "editor" | "attendant" | string;
  mustChangePassword?: boolean;
  demandNotificationSettings?: {
    notifyVia?: 'whatsapp' | 'email' | 'both' | 'none';
    reminderMinutes?: number;
    overdueReminderFrequencyHours?: number;
  };
  tenantBrand?: {
    brandName?: string;
    brandLogoUrl?: string;
    brandBannerUrl?: string;
    brandMobileBannerUrl?: string;
    brandPrimaryColor?: string;
    brandAccentColor?: string;
    brandTheme?: "light" | "dark" | "system";
    brandHighlightTheme?: string;
    brandDarkBannerUrl?: string;
    brandDarkLogoUrl?: string;
    slug?: string;
  };
}

interface AuthContextValue {
   user: SessionUser | null;
   staffMentor: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
  signupMentor: (data: { name: string; email: string; password: string; brandName?: string }) => Promise<{ access_token?: string; user?: SessionUser; message?: string }>;
  refreshUser: () => Promise<void>;
  redeemAccessLink: (token: string) => Promise<SessionUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

 export function AuthProvider({ children }: { children: ReactNode }) {
   const [user, setUser] = useState<SessionUser | null>(null);
   const [staffMentor, setStaffMentor] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
   const { setBrand, refreshFromHost } = useBranding();

  function applyUserBrand(u: SessionUser) {
    // Mentor/Super Admin → branding próprio.
    // Mentorado/Prospect/Equipe → tenantBrand do mentor dono.
    if (u.role === "mentorado" || u.role === "prospect" || u.role === "mentor_team") {
      if (u.tenantBrand) {
        setBrand(u.tenantBrand);
      } else if (u.mentorId || u.parentMentorId) {
        // Sem tenantBrand no payload — busca via endpoint público
        const id = (u as any).parentMentorId || u.mentorId;
        if (id) {
          import("@/lib/api").then(({ api }) => {
            api<any>(`/public/mentor-by-id/${id}`, { auth: false })
              .then((m) => {
                if (m) setBrand({
                  id: m.id,
                  slug: m.slug,
                  brandName: m.brandName || m.name,
                  brandLogoUrl: m.brandLogoUrl,
                  brandBannerUrl: m.brandBannerUrl,
                  brandMobileBannerUrl: m.brandMobileBannerUrl,
                  brandPrimaryColor: m.brandPrimaryColor,
                  brandAccentColor: m.brandAccentColor,
                  brandTheme: m.brandTheme,
                  brandHighlightTheme: m.brandHighlightTheme,
                  brandDarkBannerUrl: m.brandDarkBannerUrl,
                  brandDarkLogoUrl: m.brandDarkLogoUrl,
                });
              })
              .catch(() => {});
          });
        }
      }
    } else if (u.brandName || u.brandPrimaryColor) {
      setBrand({
        brandName: u.brandName,
        brandLogoUrl: u.brandLogoUrl,
        brandBannerUrl: u.brandBannerUrl,
        brandMobileBannerUrl: u.brandMobileBannerUrl,
        brandPrimaryColor: u.brandPrimaryColor,
        brandAccentColor: u.brandAccentColor,
        brandTheme: u.brandTheme,
        brandHighlightTheme: u.brandHighlightTheme,
        brandDarkBannerUrl: u.brandDarkBannerUrl,
        brandDarkLogoUrl: u.brandDarkLogoUrl,
        slug: u.slug,
      });
    }
  }

   const refreshUser = useCallback(async () => {
     try {
       const u = await api<any>("/me");

       // Verifica se o host atual pertence a outro tenant. Se sim, NÃO aplicamos
       // o branding desta sessão antiga e forçamos logout para evitar mostrar
       // a marca de outro mentor em domínio white-label.
       try {
         const host = window.location.hostname.toLowerCase();
         const isLovableHost =
           host.endsWith("lovable.app") ||
           host.endsWith("lovable.dev") ||
           host === "localhost" ||
           host.startsWith("127.") ||
           host.startsWith("192.168.");
         // Não aplicamos a trava de host para mentores/super_admin — caso contrário,
         // a impersonação (super_admin → mentor) é derrubada porque o host atual
         // pertence a outro tenant. A trava existe apenas para mentorado/prospect/equipe,
         // que não devem ver branding de outro mentor em domínio white-label.
         const isStaffOrAdmin =
           u.role === "mentor" ||
           u.role === "super_admin" ||
           u.role === "mentor_team";
         if (!isLovableHost && !isStaffOrAdmin) {
           const hostTenant = await api<any>(
             `/public/tenant-by-host?host=${encodeURIComponent(host)}`,
             { auth: false },
           ).catch(() => null);
           const hostTenantId = hostTenant?.id;
           if (hostTenantId) {
             const userTenantId =
               u.parentMentorId || u.mentorId || u.tenantBrand?.id;
             if (userTenantId && userTenantId !== hostTenantId) {
               setToken(null);
               setUser(null);
               setStaffMentor(null);
               return;
             }
           }
         }
       } catch {}

       const sess: SessionUser = {
         id: u.id,
          email: u.email,
          phone: u.phone,
         name: u.name,
         role: u.role,
         slug: u.slug,
         brandName: u.brandName,
         brandLogoUrl: u.brandLogoUrl,
         brandBannerUrl: u.brandBannerUrl,
         brandMobileBannerUrl: u.brandMobileBannerUrl,
         brandPrimaryColor: u.brandPrimaryColor,
         brandAccentColor: u.brandAccentColor,
         brandTheme: u.brandTheme,
         brandHighlightTheme: u.brandHighlightTheme,
         brandDarkBannerUrl: u.brandDarkBannerUrl,
         brandDarkLogoUrl: u.brandDarkLogoUrl,
         onboardingCompleted: u.onboardingCompleted,
         mentorId: u.mentorId,
         parentMentorId: u.parentMentorId,
         teamRole: u.teamRole,
         mustChangePassword: u.mustChangePassword,
         demandNotificationSettings: u.demandNotificationSettings,
         tenantBrand: u.tenantBrand,
       };
        // Se o usuário for staff (admin/editor/attendant), buscamos o mentor dono
        if (sess.role === "mentor_team" && sess.mentorId) {
          try {
            const mentorData = await api<any>(`/public/mentor-by-id/${sess.mentorId}`, { auth: false });
            if (mentorData) {
              const mentorInfo = {
                id: mentorData.id,
                email: "", // não exposto publicamente por segurança
                name: mentorData.name,
                role: "mentor",
                slug: mentorData.slug,
                brandName: mentorData.brandName,
                brandLogoUrl: mentorData.brandLogoUrl,
                 brandBannerUrl: mentorData.brandBannerUrl,
                 brandMobileBannerUrl: mentorData.brandMobileBannerUrl,
                brandPrimaryColor: mentorData.brandPrimaryColor,
                brandAccentColor: mentorData.brandAccentColor,
                 brandTheme: mentorData.brandTheme,
                 brandHighlightTheme: mentorData.brandHighlightTheme,
                 brandDarkBannerUrl: mentorData.brandDarkBannerUrl,
                 brandDarkLogoUrl: mentorData.brandDarkLogoUrl,
                customDomain: mentorData.customDomain
              } as SessionUser;
              setStaffMentor(mentorInfo);
              
              // Membros de equipe devem usar o branding do mentor (tenant)
              setBrand({
                brandName: mentorInfo.brandName,
                brandLogoUrl: mentorInfo.brandLogoUrl,
                brandBannerUrl: mentorData.brandBannerUrl,
                brandMobileBannerUrl: mentorData.brandMobileBannerUrl,
                brandPrimaryColor: mentorInfo.brandPrimaryColor,
                brandAccentColor: mentorInfo.brandAccentColor,
                brandTheme: mentorData.brandTheme,
                brandHighlightTheme: mentorData.brandHighlightTheme,
                brandDarkBannerUrl: mentorData.brandDarkBannerUrl,
                brandDarkLogoUrl: mentorData.brandDarkLogoUrl,
                slug: mentorInfo.slug,
              });
            }
          } catch (e) {
            console.error("Erro ao buscar mentor do staff:", e);
          }
        } else {
          setStaffMentor(null);
        }

        setUser(sess);
 
       // Se o mentor tem um domínio customizado configurado, forçamos o refresh do branding
       // para garantir que as variáveis CSS e logos correspondam ao que está no banco,
       // mesmo se ele estiver acessando via domínio genérico.
       if ((sess.role === "mentor" || sess.role === "super_admin") && u.customDomain) {
         await refreshFromHost(u.customDomain);
       } else {
         applyUserBrand(sess);
       }
      } catch (err: any) {
        console.error("Auth refresh failed:", err);
        // Se for 401 ou 403, desloga. Caso contrário (ex: erro de rede/servidor), 
        // mantemos o estado atual ou apenas logamos o erro para evitar tela branca.
        // Se o erro for 403 (Forbidden) e o usuário estiver logado, 
        // pode ser apenas falta de permissão em um endpoint específico (como admin de outro mentor).
        // Não devemos deslogar o usuário imediatamente se ele já tem uma sessão,
        // apenas se for 401 (Não autorizado) ou se não houver usuário.
        const isUnauthorized = err.message?.includes("401") || 
                             err.message?.toLowerCase().includes("unauthorized") || 
                             err.message?.toLowerCase().includes("não autorizado");
        const isForbidden = err.message?.includes("403") ||
                          err.message?.toLowerCase().includes("forbidden") ||
                          err.message?.toLowerCase().includes("sem permissão");

        // IMPORTANTE: Se o erro for 403 e já temos um usuário carregado, NÃO deslogamos.
        // Isso acontece frequentemente quando um usuário tenta acessar recursos de outro mentor
        // (transição de abas ou links antigos) mas sua sessão em si é válida.
        // Apenas deslogamos se for 401 (token expirado) ou se não conseguimos carregar o usuário inicial.
        if (isUnauthorized || (isForbidden && !user)) {
          setToken(null);
          setUser(null);
          setStaffMentor(null);
        } else if (isForbidden && user) {
          console.warn("Acesso negado a um recurso, mas mantendo sessão ativa.");
        }
      }
   }, [refreshFromHost]);

  useEffect(() => {
    // Checa primeiro o link de compra (?tk=) — se presente, troca por sessão real
    // antes de qualquer ProtectedRoute redirecionar.
    const url = new URL(window.location.href);
    const tk = url.searchParams.get("tk");
    if (tk) {
      setLoading(true);
      redeemAccessLink(tk)
        .catch(() => {
          // Link inválido/expirado — remove o tk e segue o fluxo normal
          url.searchParams.delete("tk");
          window.history.replaceState({}, "", url.toString());
          setToken(null);
        })
        .finally(() => setLoading(false));
      return;
    }

    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    refreshUser()
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ access_token: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setToken(res.access_token);
    setUser(res.user);
    applyUserBrand(res.user);
    // Mentorado/Prospect/Equipe: precisa buscar tenantBrand e o mentor dono
    if (res.user.role === "mentorado" || res.user.role === "prospect" || res.user.role === "mentor_team") {
      await refreshUser();
    }
    return res.user;
  }

  const logout = () => {
    setToken(null);
    setUser(null);
    // Em vez de limpar, tentamos recarregar o branding baseado no host
    // para manter a marca do mentor no login white-label
    window.location.href = "/login";
  };

  async function signupMentor(data: { name: string; email: string; password: string; brandName?: string }) {
    const res = await api<{ access_token?: string; user?: SessionUser; message?: string }>("/auth/signup-mentor", {
      method: "POST",
      body: data,
      auth: false,
    });
    if (res.access_token && res.user) {
      setToken(res.access_token);
      setUser(res.user);
      applyUserBrand(res.user);
    }
    return res;
  }

  /**
   * Troca o link de compra (`?tk=`) por uma sessão real de PROSPECT.
   * Emitido no checkout da página de vendas; validado no backend contra o
   * PurchaseLinksService (aud `sales-page-checkout`). Limpa o `tk` da URL
   * para não ficar exposto no histórico.
   */
  async function redeemAccessLink(token: string) {
    const res = await api<{ access_token: string; user: SessionUser }>("/sales-pages/access/redeem", {
      method: "POST",
      body: { token },
      auth: false,
    });
    setToken(res.access_token);
    setUser(res.user);
    applyUserBrand(res.user);
    // Remove o tk da URL sem recarregar a página
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("tk");
      window.history.replaceState({}, "", url.toString());
    } catch { /* noop */ }
    if (res.user.role === "prospect" || res.user.role === "mentorado" || res.user.role === "mentor_team") {
      await refreshUser();
    }
    return res.user;
  }

  return (
    <AuthContext.Provider value={{ user, staffMentor, loading, login, logout, signupMentor, refreshUser, redeemAccessLink }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

interface AuthContextValue {
  user: SessionUser | null;
  staffMentor: StaffMentor | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
  signupMentor: (data: { name: string; email: string; password: string; brandName?: string }) => Promise<{ access_token?: string; user?: SessionUser; message?: string }>;
  refreshUser: () => Promise<void>;
  redeemAccessLink: (token: string) => Promise<SessionUser>;
}
