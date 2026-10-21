/** Tipos compartilhados da página de vendas pública (layout nativo e modo ZIP). */

export type SalesPageSiteConfig = {
  enabled: boolean;
  siteToken: string | null;
  entry: string | null;
  successType: "internal" | "url" | "file";
  successUrl: string | null;
  successFile: string | null;
  eventSlug: string | null;
};

export type Payload = {
  mentor: {
    brandName?: string; brandLogoUrl?: string;
    brandPrimaryColor?: string; brandAccentColor?: string; slug: string;
  };
  page: {
    id: string; slug: string; title: string;
    headline?: string; subheadline?: string; description?: string;
    heroImageUrl?: string; videoUrl?: string;
    features: { icon?: string; title: string; text?: string }[];
    faqs: { q: string; a: string }[];
    badges: string[]; guaranteeText?: string; ctaText: string;
    priceCents: number; currency: string; originalPriceCents?: number;
    maxInstallments: number; paymentMode: "one_time" | "subscription";
    productRefId?: string | null;
    upsellTrailId?: string | null;
    upsellPriceCents?: number | null;
    upsellCurrency?: string | null;
    upsellHeadline?: string | null;
    upsellBody?: string | null;
    upsellDelayMinutes?: number;
    seo?: { title?: string; description?: string };
    template?: "classic" | "long_form";
    theme?: {
      colorSource?: "brand" | "custom";
      mode?: "light" | "dark";
      primaryColor?: string;
      accentColor?: string;
      bgColor?: string;
      heroStyle?: "split" | "background";
      heroFocus?: string;
      heroOverlay?: number;
    };
    forWho?: string[];
    notForWho?: string[];
    agenda?: { time?: string; title: string; text?: string }[];
    sections?: Array<{
      eyebrow?: string; title: string; body?: string;
      items?: Array<{ title?: string; text: string }>;
      quote?: string; ctaText?: string; variant?: "default" | "muted" | "highlight";
    }>;
    about?: {
      name?: string; role?: string; bio?: string; photoUrl?: string;
      sectionTitle?: string;
      columns?: number;
      people?: Array<{ name?: string; role?: string; bio?: string; photoUrl?: string }>;
    };
    eventInfo?: { date?: string; time?: string; location?: string; extra?: string };
    urgencyText?: string;
    countdown?: {
      enabled?: boolean;
      endsAt?: string;
      label?: string;
      hideWhenExpired?: boolean;
    };
    /** Config do site HTML enviado em ZIP (null quando a página usa o layout nativo). */
    siteConfig?: SalesPageSiteConfig | null;
  };
};

/** Campos de identificação que a página HTML do mentor pode ter coletado antes do checkout. */
export type SignupFields = {
  name?: string;
  email?: string;
  phone?: string;
  cpfCnpj?: string;
  company?: string;
  revenue?: string;
};

export function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
