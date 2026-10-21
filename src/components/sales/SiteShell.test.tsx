import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * Testes do SiteShell (página HTML do mentor em ZIP).
 *
 * O iframe roda com `sandbox` sem `allow-same-origin` → origem opaca
 * (`event.origin === "null"`). Por isso a validação de origem é feita por
 * `event.source`, e é isso que estes testes exercitam.
 */

// Os toasts do sonner só aparecem se houver <Toaster /> na árvore; aqui
// interesta saber que o erro foi sinalizado, não onde ele foi renderizado.
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn() },
}));

import SiteShell from "./SiteShell";

const page: any = {
  id: "page-1",
  slug: "minha-pagina",
  title: "Minha página",
  priceCents: 9700,
  currency: "BRL",
  maxInstallments: 12,
  paymentMode: "one_time",
  ctaText: "Comprar",
  features: [],
  faqs: [],
  badges: [],
  siteConfig: {
    enabled: true,
    siteToken: "tok-123",
    entry: "index.html",
    successType: "internal",
    successUrl: null,
    successFile: null,
    eventSlug: null,
  },
};

/** Simula uma mensagem vinda do iframe (source = contentWindow do iframe). */
function postFromFrame(type: string, extra: Record<string, unknown> = {}) {
  const iframe = document.querySelector("iframe") as HTMLIFrameElement;
  const win = iframe.contentWindow as Window;
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type, ...extra },
        source: win,
        origin: "null",
      }),
    );
  });
}

/** URL atual após navigações tentadas por `window.location.href = ...`. */
let currentHref = "";

function renderShell() {
  return render(
    <SiteShell siteToken="tok-123" mentorSlug="joao" pageSlug="minha-pagina" page={page} />,
  );
}

describe("SiteShell", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastError.mockReset();
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        successType: "internal",
        accessUrl: "/me?tk=abc",
        successFile: null,
        redirectUrl: null,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // jsdom não navega: interceptamos a atribuição a window.location.href.
    currentHref = window.location.href;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        get href() {
          return currentHref;
        },
        set href(v: string) {
          currentHref = v;
        },
        assign: (v: string) => {
          currentHref = v;
        },
        replace: (v: string) => {
          currentHref = v;
        },
        reload: () => {},
        origin: "http://localhost",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ignora mensagens cujo source não é o iframe", async () => {
    renderShell();

    // Outra janela (ex.: uma aba atacante) manda `mf:checkout`.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "mf:checkout" },
          source: window,
          origin: "https://atacante.example",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("abre o checkout quando o iframe envia mf:checkout", async () => {
    renderShell();

    postFromFrame("mf:checkout");

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("cadastra no endpoint público com os campos coletados pelo mentor", async () => {
    renderShell();

    postFromFrame("mf:signup", {
      fields: { name: "Maria Silva", email: "maria@example.com" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain("/public/sales-pages/joao/minha-pagina/signup");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Maria Silva");
    expect(body.email).toBe("maria@example.com");
  });

  it("navega para a área interna conforme successType", async () => {
    renderShell();

    postFromFrame("mf:signup", {
      fields: { name: "Maria Silva", email: "maria@example.com" },
    });

    await waitFor(() => {
      expect(currentHref).toBe("/me?tk=abc");
    });
  });

  it("não cadastra sem nome e e-mail", async () => {
    renderShell();

    postFromFrame("mf:signup", { fields: { name: "", email: "" } });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa link com esquema perigoso", async () => {
    renderShell();

    postFromFrame("mf:link", { href: "javascript:alert(1)" });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Link inválido.");
    });
    expect(currentHref).not.toContain("javascript:");
  });

  it("recusa link com esquema data:", async () => {
    renderShell();

    postFromFrame("mf:link", { href: "data:text/html,<script>alert(1)</script>" });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Link inválido.");
    });
    expect(currentHref).not.toContain("data:");
  });
});
