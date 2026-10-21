import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { toast } from "sonner";
import { Payload, SignupFields } from "@/types/sales-page";
import CheckoutDialog from "./CheckoutDialog";
import CadastroDialog, { SignupResult } from "./CadastroDialog";

export type SiteShellProps = {
  siteToken: string;
  mentorSlug: string;
  pageSlug: string;
  page: Payload["page"];
};

/** Campos que o bridge pode coletar do formulário do mentor. */
type BridgeFields = SignupFields & { requestId?: string };

/** Só http(s) e caminhos relativos são permitidos — nunca `javascript:`/`data:`. */
function safeHref(raw: unknown): string | null {
  const href = String(raw ?? "").trim();
  if (!href) return null;
  if (href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function newNonce(): string {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch {
    /* ignora */
  }
  return `mf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Renderiza a página HTML enviada pelo mentor (em ZIP) dentro de um iframe
 * isolado e conecta os botões marcados com `data-mf` à plataforma.
 *
 * O iframe roda **sem** `allow-same-origin` → origem opaca (`event.origin === "null"`).
 * Por isso a validação de origem é feita por `event.source`, e o canal
 * pai → iframe é autenticado por um nonce trocado no handshake.
 */
export default function SiteShell({
  siteToken, mentorSlug, pageSlug, page,
}: SiteShellProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nonceRef = useRef<string>("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cadastroOpen, setCadastroOpen] = useState(false);
  const [collected, setCollected] = useState<SignupFields>({});
  const [booted, setBooted] = useState(false);

  const siteBase = `${API_BASE}/public/sites/${siteToken}`;

  /** Envia um comando ao iframe. Exige o nonce do handshake. */
  const sendToFrame = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !nonceRef.current) return;
    try {
      win.postMessage({ ...msg, nonce: nonceRef.current }, "*");
    } catch {
      /* iframe pode ter sido desmontado */
    }
  }, []);

  /** Mostra o resultado do cadastro dentro da página do mentor. */
  const reportToFrame = useCallback(
    (ok: boolean, message: string, href?: string | null) => {
      sendToFrame({ type: "mf:submit-signup-result", ok, message, href: href || undefined });
    },
    [sendToFrame],
  );

  /** Move o iframe para a página de "obrigado" dentro do próprio site. */
  const navigateFrame = useCallback(
    (file: string) => {
      const rel = String(file || "").replace(/^\/+/, "");
      if (!rel) return;
      sendToFrame({ type: "mf:navigate", href: `${siteBase}/${rel}` });
    },
    [sendToFrame, siteBase],
  );

  /** Destino configurado pelo mentor após o cadastro. */
  const applySuccess = useCallback(
    (result: SignupResult) => {
      if (result.successType === "url") {
        const href = safeHref(result.redirectUrl);
        if (href) window.location.href = href;
        else toast.error("Link de destino inválido.");
        return;
      }
      if (result.successType === "file") {
        const file = result.successFile;
        if (file) {
          navigateFrame(file);
          reportToFrame(true, "Cadastro confirmado!", null);
        } else {
          reportToFrame(false, "Cadastro confirmado.");
        }
        return;
      }
      // `internal` — link de acesso à área de membro.
      if (result.accessUrl) window.location.href = result.accessUrl;
      else window.location.href = "/me";
    },
    [navigateFrame, reportToFrame],
  );

  const submitSignup = useCallback(
    async (fields: BridgeFields) => {
      const name = String(fields?.name || "").trim();
      const email = String(fields?.email || "").trim().toLowerCase();
      if (name.length < 2 || !email) {
        reportToFrame(false, "Informe nome e e-mail para continuar.");
        toast.error("Informe nome e e-mail para continuar.");
        return;
      }
      try {
        const r = await fetch(
          `${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/signup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              email,
              phone: fields.phone || undefined,
              company: fields.company || undefined,
              revenue: fields.revenue || undefined,
              requestId: fields.requestId || undefined,
            }),
          },
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data?.message || "Não foi possível concluir o cadastro.");
        const result = data as SignupResult;
        reportToFrame(true, "Cadastro realizado com sucesso!");
        applySuccess(result);
      } catch (e: any) {
        reportToFrame(false, e.message || "Não foi possível concluir o cadastro.");
        toast.error(e.message || "Não foi possível concluir o cadastro.");
      }
    },
    [applySuccess, mentorSlug, pageSlug, reportToFrame],
  );

  const registerEvent = useCallback(
    async (fields: BridgeFields) => {
      const eventSlug = page.siteConfig?.eventSlug;
      if (!eventSlug) {
        toast.error("Nenhum evento configurado para esta página.");
        return;
      }
      const name = String(fields?.name || "").trim();
      const email = String(fields?.email || "").trim().toLowerCase();
      if (!name || !email) {
        toast.error("Informe nome e e-mail para garantir a vaga.");
        return;
      }
      try {
        const r = await fetch(`${API_BASE}/public/events/${eventSlug}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            phone: fields.phone || undefined,
            company: fields.company || undefined,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.message || "Não foi possível concluir a inscrição.");
        toast.success(data?.ticketCode ? "Inscrição confirmada!" : "Inscrição confirmada!");
      } catch (e: any) {
        toast.error(e.message || "Não foi possível concluir a inscrição.");
      }
    },
    [page.siteConfig?.eventSlug],
  );

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      // Obrigatório: com origem opaca não dá para comparar `event.origin`.
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      const type = (msg as any).type;
      if (typeof type !== "string") return;

      switch (type) {
        case "mf:hello": {
          // Handshake: o pai autentica o canal pai → iframe com um nonce.
          const nonce = newNonce();
          nonceRef.current = nonce;
          try {
            (ev.source as Window).postMessage({ type: "mf:init", nonce }, "*");
          } catch {
            /* ignora */
          }
          setBooted(true);
          break;
        }
        case "mf:checkout":
          setCollected((prev) => ({ ...prev, ...(msg.fields || {}) }));
          setCheckoutOpen(true);
          break;
        case "mf:signup-open":
          setCollected((prev) => ({ ...prev, ...(msg.fields || {}) }));
          setCadastroOpen(true);
          break;
        case "mf:signup":
          setCollected((prev) => ({ ...prev, ...(msg.fields || {}) }));
          void submitSignup(msg.fields || {});
          break;
        case "mf:event":
          void registerEvent(msg.fields || {});
          break;
        case "mf:link": {
          const href = safeHref(msg.href);
          if (href) window.location.href = href;
          else toast.error("Link inválido.");
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [registerEvent, submitSignup]);

  return (
    <div className="min-h-screen bg-background">
      <iframe
        ref={iframeRef}
        title="Página de vendas"
        src={siteBase}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="w-full border-0"
        style={{ height: "100dvh", minHeight: "100vh" }}
      />

      {!booted && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-muted/80 px-4 py-2 text-center text-xs text-muted-foreground">
          Conectando à plataforma…
        </div>
      )}

      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        mentorSlug={mentorSlug}
        pageSlug={pageSlug}
        page={page}
        initial={collected}
      />

      <CadastroDialog
        open={cadastroOpen}
        onClose={() => setCadastroOpen(false)}
        mentorSlug={mentorSlug}
        pageSlug={pageSlug}
        initial={collected}
        onSuccess={applySuccess}
      />
    </div>
  );
}
