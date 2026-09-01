import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUploadField } from "@/components/ImageUploadField";
import { ArrowDown, ArrowLeft, ArrowUp, Sparkles, Loader2, Save, Plus, Trash2, ExternalLink, Copy, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type Feature = { icon?: string; title: string; text?: string };
type Faq = { q: string; a: string };
type Testimonial = { name: string; role?: string; quote: string; avatarUrl?: string };
type AgendaItem = { time?: string; title: string; text?: string };
type PageSection = {
  eyebrow?: string; title: string; body?: string;
  items?: Array<{ title?: string; text: string }>;
  quote?: string; ctaText?: string;
  variant?: "default" | "muted" | "highlight";
};
type Coupon = {
  code: string;
  description?: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  maxUses?: number | null;
  usedCount?: number;
  usedEmails?: string[];
  oneUsePerPerson?: boolean;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};
type Theme = {
  colorSource?: "brand" | "custom";
  mode?: "light" | "dark";
  primaryColor?: string;
  accentColor?: string;
  bgColor?: string;
  heroStyle?: "split" | "background";
  heroFocus?: string;
  heroOverlay?: number;
};

type SalesPage = {
  id: string;
  slug: string;
  title: string;
  productType: string;
  productRefId?: string | null;
  headline?: string;
  subheadline?: string;
  description?: string;
  heroImageUrl?: string;
  videoUrl?: string;
  features: Feature[];
  faqs: Faq[];
  testimonials: Testimonial[];
  badges: string[];
  guaranteeText?: string;
  ctaText: string;
  priceCents: number;
  currency: string;
  originalPriceCents?: number | null;
  maxInstallments: number;
  paymentMode: "one_time" | "subscription";
  subscriptionCycle?: string | null;
  paymentProviderId?: string | null;
  published: boolean;
  seo?: { title?: string; description?: string; ogImage?: string };
  template?: "classic" | "long_form";
  theme?: Theme;
  forWho?: string[];
  notForWho?: string[];
  agenda?: AgendaItem[];
  sections?: PageSection[];
  about?: {
    name?: string;
    role?: string;
    bio?: string;
    photoUrl?: string;
    sectionTitle?: string;
    columns?: number;
    people?: Array<{ name?: string; role?: string; bio?: string; photoUrl?: string }>;
  };
  eventInfo?: { date?: string; time?: string; location?: string; extra?: string };
  urgencyText?: string;
  countdown?: { enabled?: boolean; endsAt?: string; label?: string; hideWhenExpired?: boolean };
  coupons?: Coupon[];
};

type Provider = { id: string; type: string; label?: string; environment: string; hasApiKey: boolean };

export default function SalesPageEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [page, setPage] = useState<SalesPage | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // AI form
  const [briefing, setBriefing] = useState("");
  const [audience, setAudience] = useState("");
  const [priceHint, setPriceHint] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [p, provs] = await Promise.all([
          api<SalesPage>(`/sales-pages/${id}`),
          api<Provider[]>(`/event-payments/providers`).catch(() => [] as Provider[]),
        ]);
        setPage(p);
        setProviders((provs || []).filter((x) => x.type === "asaas"));
      } catch (e: any) {
        toast.error(e.message);
        navigate("/app/sales-pages");
      }
    })();
  }, [id]);

  const patch = (upd: Partial<SalesPage>) => setPage((prev) => (prev ? { ...prev, ...upd } : prev));

  const save = async (extra?: Partial<SalesPage>) => {
    if (!page) return;
    try {
      setSaving(true);
      const body = { ...page, ...(extra || {}) };
      const saved = await api<SalesPage>(`/sales-pages/${page.id}`, { method: "PUT", body });
      setPage(saved);
      toast.success("Salvo");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!page) return;
    if (!page.paymentProviderId) {
      toast.error("Escolha um provedor Asaas antes de publicar.");
      return;
    }
    if (!page.priceCents) {
      toast.error("Defina um preço maior que zero.");
      return;
    }
    await save({ published: true });
    toast.success("Página publicada!");
  };

  const unpublish = async () => save({ published: false });

  const generateWithAi = async () => {
    if (briefing.trim().length < 10) {
      toast.error("Descreva o produto em pelo menos 10 caracteres.");
      return;
    }
    try {
      setGenerating(true);
      const g = await api<any>("/sales-pages/generate", {
        method: "POST",
        body: { briefing, audience, priceHint, productType: page?.productType, template: page?.template || "classic" },
      });
      patch({
        title: g.title || page?.title,
        headline: g.headline,
        subheadline: g.subheadline,
        description: g.description,
        features: g.features || [],
        badges: g.badges || [],
        guaranteeText: g.guaranteeText,
        ctaText: g.ctaText || page?.ctaText,
        faqs: g.faqs || [],
        seo: g.seo,
        ...(page?.template === "long_form" ? {
          forWho: g.forWho || [],
          notForWho: g.notForWho || [],
          agenda: g.agenda || [],
          sections: g.sections || [],
          about: g.about || page?.about,
          eventInfo: g.eventInfo || page?.eventInfo,
          urgencyText: g.urgencyText || "",
        } : {}),
      });
      toast.success("Copy gerada! Revise e salve.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const publicUrl = page ? `${window.location.origin}/p/${user?.slug || "seu-slug"}/${page.slug}` : "";

  if (!page) return <div className="p-6">Carregando…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/app/sales-pages"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-display">{page.title}</h1>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              {page.published ? (
                <Badge className="bg-primary/15 text-primary border-primary/20">Publicada</Badge>
              ) : (
                <Badge variant="outline">Rascunho</Badge>
              )}
              <span className="truncate">{publicUrl}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Link copiado"); }}
                className="hover:text-foreground"
              ><Copy className="h-3 w-3" /></button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {page.published && (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" />Ver</Button>
            </a>
          )}
          <Button variant="outline" onClick={() => save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar
          </Button>
          {page.published ? (
            <Button variant="outline" onClick={unpublish}>Despublicar</Button>
          ) : (
            <Button onClick={publish} className="bg-gradient-primary shadow-glow">
              <Rocket className="h-4 w-4 mr-2" />Publicar
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="ai" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ai"><Sparkles className="h-3 w-3 mr-1" />Gerar com IA</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="content">Conteúdo</TabsTrigger>
          {page.template === "long_form" && (
            <TabsTrigger value="longform">Versão completa</TabsTrigger>
          )}
          <TabsTrigger value="offer">Oferta</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="checkout">Checkout</TabsTrigger>
        </TabsList>

        {/* ===== Design ===== */}
        <TabsContent value="design" className="space-y-4">
          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-bold mb-1">Modelo da página</h3>
              <p className="text-sm text-muted-foreground mb-3">Escolha um layout base. Você ainda pode ajustar cores e conteúdo.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  { id: "classic", title: "Clássico premium", desc: "Hero dark elegante com foto/vídeo + benefícios + FAQ. Ideal para mentorias, cursos e ebooks." },
                  { id: "long_form", title: "Versão completa (imersão)", desc: "Longa e persuasiva: hero, para quem é/não é, agenda, sobre o mentor, urgência e múltiplos CTAs. Ideal para eventos e imersões." },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ template: t.id as any })}
                    className={`text-left rounded-lg border-2 p-4 transition-all ${
                      (page.template || "classic") === t.id
                        ? "border-primary bg-primary/5 shadow-glow"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="font-bold mb-1">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-bold mb-1">Cores da página</h3>
              <p className="text-sm text-muted-foreground mb-3">Use as cores da sua marca ou personalize só nesta página.</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: "brand", label: "Seguir minha marca", desc: "Usa as cores do seu whitelabel." },
                  { id: "custom", label: "Personalizar", desc: "Define cores só para esta página." },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => patch({ theme: { ...(page.theme || {}), colorSource: o.id as any } })}
                    className={`text-left rounded-lg border-2 p-4 transition-all ${
                      (page.theme?.colorSource || "brand") === o.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="font-semibold text-sm mb-0.5">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {(page.theme?.colorSource || "brand") === "custom" && (
              <div className="grid md:grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <Label>Modo</Label>
                  <Select
                    value={page.theme?.mode || "dark"}
                    onValueChange={(v: any) => patch({ theme: { ...(page.theme || {}), mode: v } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Escuro</SelectItem>
                      <SelectItem value="light">Claro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cor primária (botões / destaques)</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      className="h-10 w-14 rounded border cursor-pointer"
                      value={page.theme?.primaryColor || "#c9a84c"}
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), primaryColor: e.target.value } })}
                    />
                    <Input
                      value={page.theme?.primaryColor || ""}
                      placeholder="#c9a84c"
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), primaryColor: e.target.value } })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Cor de acento (títulos)</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      className="h-10 w-14 rounded border cursor-pointer"
                      value={page.theme?.accentColor || "#e8c97a"}
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), accentColor: e.target.value } })}
                    />
                    <Input
                      value={page.theme?.accentColor || ""}
                      placeholder="#e8c97a"
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), accentColor: e.target.value } })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Cor de fundo</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      className="h-10 w-14 rounded border cursor-pointer"
                      value={page.theme?.bgColor || "#0a0a0a"}
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), bgColor: e.target.value } })}
                    />
                    <Input
                      value={page.theme?.bgColor || ""}
                      placeholder="#0a0a0a"
                      onChange={(e) => patch({ theme: { ...(page.theme || {}), bgColor: e.target.value } })}
                    />
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-bold mb-1">Estilo do hero</h3>
              <p className="text-sm text-muted-foreground mb-3">Como a imagem principal aparece no topo da página.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  { id: "split", title: "Texto + imagem lado a lado", desc: "Layout dividido: texto à esquerda, foto/vídeo à direita." },
                  { id: "background", title: "Imagem de fundo completa", desc: "Imagem grande ocupa todo o hero, com o texto sobreposto à esquerda." },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => patch({ theme: { ...(page.theme || {}), heroStyle: o.id as any } })}
                    className={`text-left rounded-lg border-2 p-4 transition-all ${
                      (page.theme?.heroStyle || "split") === o.id
                        ? "border-primary bg-primary/5 shadow-glow"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="font-semibold text-sm mb-1">{o.title}</div>
                    <div className="text-xs text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {(page.theme?.heroStyle || "split") === "background" && (
              <div className="grid md:grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <Label>Foco da imagem</Label>
                  <Select
                    value={page.theme?.heroFocus || "center"}
                    onValueChange={(v) => patch({ theme: { ...(page.theme || {}), heroFocus: v } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="center">Centralizada</SelectItem>
                      <SelectItem value="right">Direita (rosto/pessoa à direita)</SelectItem>
                      <SelectItem value="left">Esquerda</SelectItem>
                      <SelectItem value="top">Topo</SelectItem>
                      <SelectItem value="bottom">Base</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Escolha para onde a imagem se alinha. Use "Direita" para fotos de pessoa em pé.</p>
                </div>
                <div>
                  <Label>Escurecimento sobre a imagem</Label>
                  <Input
                    type="range"
                    min={0}
                    max={90}
                    step={5}
                    value={Math.round(((page.theme?.heroOverlay ?? 0.6)) * 100)}
                    onChange={(e) => patch({ theme: { ...(page.theme || {}), heroOverlay: Number(e.target.value) / 100 } })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Ajusta o contraste do texto sobre a imagem (0% = imagem limpa, 90% = quase preto).</p>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ===== Long form fields ===== */}
        {page.template === "long_form" && (
          <TabsContent value="longform" className="space-y-4">
            <Card className="p-6 space-y-4">
              <div className="flex justify-between items-center gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold">Blocos da página</h3>
                  <p className="text-xs text-muted-foreground">A IA cria estes blocos em ordem. Você pode editar, reordenar ou adicionar novos.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => patch({ sections: [...(page.sections || []), { title: "Novo bloco", body: "", items: [], variant: "default" }] })}>
                  <Plus className="h-4 w-4 mr-1" />Adicionar bloco
                </Button>
              </div>
              {(page.sections || []).map((section, i) => (
                <div key={i} className="rounded-xl border p-4 space-y-3 bg-muted/10">
                  <div className="flex justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Bloco {i + 1}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => { const arr = [...(page.sections || [])]; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; patch({ sections: arr }); }}><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" disabled={i === (page.sections || []).length - 1} onClick={() => { const arr = [...(page.sections || [])]; [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; patch({ sections: arr }); }}><ArrowDown className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => patch({ sections: (page.sections || []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-[1fr_180px] gap-3">
                    <div><Label>Chamada superior</Label><Input value={section.eyebrow || ""} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, eyebrow: e.target.value }; patch({ sections: arr }); }} placeholder="Ex.: O problema" /></div>
                    <div><Label>Visual</Label><Select value={section.variant || "default"} onValueChange={(v: PageSection["variant"]) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, variant: v }; patch({ sections: arr }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Padrão</SelectItem><SelectItem value="muted">Fundo alternado</SelectItem><SelectItem value="highlight">Destaque</SelectItem></SelectContent></Select></div>
                  </div>
                  <div><Label>Título</Label><Input value={section.title} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, title: e.target.value }; patch({ sections: arr }); }} /></div>
                  <div><Label>Texto</Label><Textarea rows={4} value={section.body || ""} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, body: e.target.value }; patch({ sections: arr }); }} placeholder="Separe parágrafos com Enter." /></div>
                  <div><Label>Itens (um por linha; use Título | descrição)</Label><Textarea rows={4} value={(section.items || []).map((item) => `${item.title ? `${item.title} | ` : ""}${item.text}`).join("\n")} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, items: e.target.value.split("\n").filter(Boolean).map((line) => { const [title, ...rest] = line.split("|"); return rest.length ? { title: title.trim(), text: rest.join("|").trim() } : { text: title.trim() }; }) }; patch({ sections: arr }); }} /></div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div><Label>Frase de destaque</Label><Input value={section.quote || ""} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, quote: e.target.value }; patch({ sections: arr }); }} /></div>
                    <div><Label>CTA deste bloco</Label><Input value={section.ctaText || ""} onChange={(e) => { const arr = [...(page.sections || [])]; arr[i] = { ...section, ctaText: e.target.value }; patch({ sections: arr }); }} /></div>
                  </div>
                </div>
              ))}
              {(page.sections || []).length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum bloco ainda. Gere a página com IA ou adicione manualmente.</p>}
            </Card>
            <Card className="p-6 space-y-3">
              <h3 className="font-bold">Informações do evento (opcional)</h3>
              <p className="text-xs text-muted-foreground">Aparece em destaque abaixo do hero (para imersões, workshops, eventos).</p>
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Data</Label><Input value={page.eventInfo?.date || ""} onChange={(e) => patch({ eventInfo: { ...(page.eventInfo || {}), date: e.target.value } })} placeholder="19 de Agosto de 2026" /></div>
                <div><Label>Horário</Label><Input value={page.eventInfo?.time || ""} onChange={(e) => patch({ eventInfo: { ...(page.eventInfo || {}), time: e.target.value } })} placeholder="9h às 17h" /></div>
                <div><Label>Local</Label><Input value={page.eventInfo?.location || ""} onChange={(e) => patch({ eventInfo: { ...(page.eventInfo || {}), location: e.target.value } })} placeholder="Espaço NWB — Barueri, SP" /></div>
                <div><Label>Extra</Label><Input value={page.eventInfo?.extra || ""} onChange={(e) => patch({ eventInfo: { ...(page.eventInfo || {}), extra: e.target.value } })} placeholder="Credenciamento às 8h30" /></div>
              </div>
            </Card>

            <Card className="p-6 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">Esse evento é pra você se…</h3>
                <Button variant="outline" size="sm" onClick={() => patch({ forWho: [...(page.forWho || []), ""] })}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
              </div>
              {(page.forWho || []).map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={v} onChange={(e) => { const arr = [...(page.forWho || [])]; arr[i] = e.target.value; patch({ forWho: arr }); }} placeholder="Você é empresário e quer aumentar produtividade…" />
                  <Button variant="ghost" size="sm" onClick={() => patch({ forWho: (page.forWho || []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </Card>

            <Card className="p-6 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">NÃO é pra você se…</h3>
                <Button variant="outline" size="sm" onClick={() => patch({ notForWho: [...(page.notForWho || []), ""] })}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
              </div>
              {(page.notForWho || []).map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={v} onChange={(e) => { const arr = [...(page.notForWho || [])]; arr[i] = e.target.value; patch({ notForWho: arr }); }} placeholder="Você busca teoria e não quer botar a mão na massa…" />
                  <Button variant="ghost" size="sm" onClick={() => patch({ notForWho: (page.notForWho || []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </Card>

            <Card className="p-6 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">Agenda / Programação</h3>
                <Button variant="outline" size="sm" onClick={() => patch({ agenda: [...(page.agenda || []), { title: "", text: "" }] })}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
              </div>
              {(page.agenda || []).map((a, i) => (
                <div key={i} className="grid md:grid-cols-[110px_1fr_2fr_auto] gap-2">
                  <Input value={a.time || ""} placeholder="9h" onChange={(e) => { const arr = [...(page.agenda || [])]; arr[i] = { ...a, time: e.target.value }; patch({ agenda: arr }); }} />
                  <Input value={a.title} placeholder="Título" onChange={(e) => { const arr = [...(page.agenda || [])]; arr[i] = { ...a, title: e.target.value }; patch({ agenda: arr }); }} />
                  <Input value={a.text || ""} placeholder="Descrição curta" onChange={(e) => { const arr = [...(page.agenda || [])]; arr[i] = { ...a, text: e.target.value }; patch({ agenda: arr }); }} />
                  <Button variant="ghost" size="sm" onClick={() => patch({ agenda: (page.agenda || []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </Card>

            <Card className="p-6 space-y-3">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h3 className="font-bold">Mentores / Palestrantes</h3>
                <Button variant="outline" size="sm" onClick={() => {
                  const about = page.about || {};
                  const existing = about.people && about.people.length > 0
                    ? about.people
                    : (about.name || about.bio || about.role || about.photoUrl)
                      ? [{ name: about.name, role: about.role, bio: about.bio, photoUrl: about.photoUrl }]
                      : [];
                  const people = [...existing, { name: "", role: "", bio: "", photoUrl: "" }];
                  patch({ about: { ...about, people, columns: about.columns || (people.length > 1 ? 2 : 1) } });
                }}>
                  <Plus className="h-4 w-4 mr-1" />Adicionar palestrante
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>Título da seção</Label>
                  <Input
                    value={page.about?.sectionTitle || ""}
                    placeholder="Sobre / Palestrantes / Quem ministra"
                    onChange={(e) => patch({ about: { ...(page.about || {}), sectionTitle: e.target.value } })}
                  />
                </div>
                {(page.about?.people?.length || 0) > 1 && (
                  <div>
                    <Label>Colunas no desktop</Label>
                    <Input
                      type="number"
                      min={1}
                      max={4}
                      value={page.about?.columns ?? 2}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(4, Number(e.target.value) || 1));
                        patch({ about: { ...(page.about || {}), columns: n } });
                      }}
                    />
                  </div>
                )}
              </div>

              {(page.about?.people?.length || 0) === 0 ? (
                <>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div><Label>Nome</Label><Input value={page.about?.name || ""} onChange={(e) => patch({ about: { ...(page.about || {}), name: e.target.value } })} /></div>
                    <div><Label>Função / cargo</Label><Input value={page.about?.role || ""} onChange={(e) => patch({ about: { ...(page.about || {}), role: e.target.value } })} placeholder="Especialista em IA aplicada" /></div>
                  </div>
                  <div>
                    <Label>Bio</Label>
                    <Textarea rows={4} value={page.about?.bio || ""} onChange={(e) => patch({ about: { ...(page.about || {}), bio: e.target.value } })} />
                  </div>
                  <ImageUploadField label="Foto do mentor" value={page.about?.photoUrl} onChange={(url) => patch({ about: { ...(page.about || {}), photoUrl: url } })} aspect="1/1" />
                </>
              ) : (
                <div className="space-y-4">
                  {(page.about?.people || []).map((p, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-3 bg-muted/30">
                      <div className="flex justify-between items-center">
                        <div className="text-sm font-semibold text-muted-foreground">Palestrante #{i + 1}</div>
                        <Button variant="ghost" size="sm" onClick={() => {
                          const people = (page.about?.people || []).filter((_, j) => j !== i);
                          patch({ about: { ...(page.about || {}), people } });
                        }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div><Label>Nome</Label><Input value={p.name || ""} onChange={(e) => {
                          const people = [...(page.about?.people || [])]; people[i] = { ...p, name: e.target.value };
                          patch({ about: { ...(page.about || {}), people } });
                        }} /></div>
                        <div><Label>Função / cargo</Label><Input value={p.role || ""} placeholder="Palestrante / Mentor / CEO" onChange={(e) => {
                          const people = [...(page.about?.people || [])]; people[i] = { ...p, role: e.target.value };
                          patch({ about: { ...(page.about || {}), people } });
                        }} /></div>
                      </div>
                      <div>
                        <Label>Bio</Label>
                        <Textarea rows={3} value={p.bio || ""} onChange={(e) => {
                          const people = [...(page.about?.people || [])]; people[i] = { ...p, bio: e.target.value };
                          patch({ about: { ...(page.about || {}), people } });
                        }} />
                      </div>
                      <ImageUploadField label="Foto" value={p.photoUrl} onChange={(url) => {
                        const people = [...(page.about?.people || [])]; people[i] = { ...p, photoUrl: url };
                        patch({ about: { ...(page.about || {}), people } });
                      }} aspect="1/1" />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-3">
              <h3 className="font-bold">Urgência / escassez</h3>
              <Textarea rows={2} value={page.urgencyText || ""} onChange={(e) => patch({ urgencyText: e.target.value })} placeholder="Lote 1 esgota em 48h · Vagas limitadas" />
            </Card>
          </TabsContent>
        )}


        {/* ===== IA ===== */}
        <TabsContent value="ai">
          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-bold mb-1 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Descreva seu produto
              </h3>
              <p className="text-sm text-muted-foreground">
                A IA vai escrever hero, benefícios, FAQ, CTA e SEO. Você revisa e ajusta.
              </p>
            </div>
            <div>
              <Label>O que você vende? (obrigatório)</Label>
              <Textarea
                rows={3}
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
                placeholder="Ex: mentoria em grupo de 3 meses para advogados iniciantes que querem sair da CLT e abrir escritório próprio. Inclui 12 encontros ao vivo, comunidade e templates de contratos."
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Público-alvo</Label>
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Advogados de 25-40 anos, recém-formados" />
              </div>
              <div>
                <Label>Preço / oferta</Label>
                <Input value={priceHint} onChange={(e) => setPriceHint(e.target.value)} placeholder="R$ 2.997 à vista ou 12x R$ 297" />
              </div>
            </div>
            <Button onClick={generateWithAi} disabled={generating} className="bg-gradient-primary shadow-glow">
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Gerar copy com IA
            </Button>
          </Card>
        </TabsContent>

        {/* ===== Conteúdo ===== */}
        <TabsContent value="content" className="space-y-4">
          <Card className="p-6 space-y-4">
            <div>
              <Label>Nome interno / título</Label>
              <Input value={page.title} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={page.slug} onChange={(e) => patch({ slug: e.target.value })} />
            </div>
            <div>
              <Label>Headline (título do hero)</Label>
              <Input value={page.headline || ""} onChange={(e) => patch({ headline: e.target.value })} />
            </div>
            <div>
              <Label>Subheadline</Label>
              <Textarea rows={2} value={page.subheadline || ""} onChange={(e) => patch({ subheadline: e.target.value })} />
            </div>
            <div>
              <Label>Descrição / pitch</Label>
              <Textarea rows={4} value={page.description || ""} onChange={(e) => patch({ description: e.target.value })} />
            </div>
            <ImageUploadField
              label="Imagem hero"
              value={page.heroImageUrl}
              onChange={(url) => patch({ heroImageUrl: url })}
              aspect="16/9"
            />
            <div>
              <Label>URL de vídeo (YouTube/Vimeo — opcional)</Label>
              <Input value={page.videoUrl || ""} onChange={(e) => patch({ videoUrl: e.target.value })} placeholder="https://youtube.com/watch?v=..." />
            </div>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold">Benefícios / Features</h3>
              <Button variant="outline" size="sm" onClick={() => patch({ features: [...page.features, { title: "Novo benefício", text: "" }] })}>
                <Plus className="h-4 w-4 mr-1" />Adicionar
              </Button>
            </div>
            {page.features.map((f, i) => (
              <div key={i} className="grid md:grid-cols-[1fr_2fr_auto] gap-2 items-start">
                <Input value={f.title} onChange={(e) => {
                  const arr = [...page.features]; arr[i] = { ...f, title: e.target.value }; patch({ features: arr });
                }} placeholder="Título" />
                <Input value={f.text || ""} onChange={(e) => {
                  const arr = [...page.features]; arr[i] = { ...f, text: e.target.value }; patch({ features: arr });
                }} placeholder="Descrição curta" />
                <Button variant="ghost" size="sm" onClick={() => patch({ features: page.features.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </Card>

          <Card className="p-6 space-y-3">
            <h3 className="font-bold">Badges (destaque abaixo do CTA)</h3>
            <div className="flex gap-2 flex-wrap">
              {page.badges.map((b, i) => (
                <div key={i} className="flex items-center gap-1 border rounded-full pl-3 pr-1 py-1 bg-muted/40">
                  <input
                    className="bg-transparent text-sm outline-none w-40"
                    value={b}
                    onChange={(e) => {
                      const arr = [...page.badges]; arr[i] = e.target.value; patch({ badges: arr });
                    }}
                  />
                  <button onClick={() => patch({ badges: page.badges.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => patch({ badges: [...page.badges, "Novo destaque"] })}>
                <Plus className="h-3 w-3 mr-1" />Adicionar
              </Button>
            </div>
            <div>
              <Label>Texto de garantia</Label>
              <Input value={page.guaranteeText || ""} onChange={(e) => patch({ guaranteeText: e.target.value })} placeholder="Garantia incondicional de 7 dias" />
            </div>
          </Card>
        </TabsContent>

        {/* ===== Oferta ===== */}
        <TabsContent value="offer">
          <Card className="p-6 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Preço (R$)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={(page.priceCents / 100).toString()}
                  onChange={(e) => patch({ priceCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                />
              </div>
              <div>
                <Label>Preço "de" — opcional (riscado)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={page.originalPriceCents ? (page.originalPriceCents / 100).toString() : ""}
                  onChange={(e) => patch({ originalPriceCents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null })}
                />
              </div>
              <div>
                <Label>Máximo de parcelas (cartão)</Label>
                <Input
                  type="number" min="1" max="12"
                  value={page.maxInstallments}
                  onChange={(e) => patch({ maxInstallments: Math.max(1, Math.min(12, parseInt(e.target.value || "1"))) })}
                />
              </div>
              <div>
                <Label>Modelo</Label>
                <Select value={page.paymentMode} onValueChange={(v: any) => patch({ paymentMode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">Pagamento único</SelectItem>
                    <SelectItem value="subscription">Assinatura recorrente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {page.paymentMode === "subscription" && (
                <div>
                  <Label>Ciclo</Label>
                  <Select value={page.subscriptionCycle || "MONTHLY"} onValueChange={(v) => patch({ subscriptionCycle: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Mensal</SelectItem>
                      <SelectItem value="QUARTERLY">Trimestral</SelectItem>
                      <SelectItem value="SEMIANNUALLY">Semestral</SelectItem>
                      <SelectItem value="YEARLY">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label>Texto do botão (CTA)</Label>
              <Input value={page.ctaText} onChange={(e) => patch({ ctaText: e.target.value })} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-bold mb-1">Contagem regressiva</h3>
                <p className="text-sm text-muted-foreground">Cria um cronômetro no topo da página para gerar urgência. Você pode ativar ou desativar a qualquer momento.</p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={!!page.countdown?.enabled}
                  onChange={(e) => patch({ countdown: { ...(page.countdown || {}), enabled: e.target.checked } })}
                />
                <span className="text-sm font-medium">{page.countdown?.enabled ? "Ativa" : "Desativada"}</span>
              </label>
            </div>
            {page.countdown?.enabled && (
              <div className="grid md:grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <Label>Termina em</Label>
                  <Input
                    type="datetime-local"
                    value={page.countdown?.endsAt ? page.countdown.endsAt.slice(0, 16) : ""}
                    onChange={(e) => patch({ countdown: { ...(page.countdown || {}), endsAt: e.target.value ? new Date(e.target.value).toISOString() : "" } })}
                  />
                </div>
                <div>
                  <Label>Rótulo</Label>
                  <Input
                    value={page.countdown?.label || ""}
                    placeholder="A oferta termina em"
                    onChange={(e) => patch({ countdown: { ...(page.countdown || {}), label: e.target.value } })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={!!page.countdown?.hideWhenExpired}
                      onChange={(e) => patch({ countdown: { ...(page.countdown || {}), hideWhenExpired: e.target.checked } })}
                    />
                    <span className="text-sm">Esconder o cronômetro quando expirar</span>
                  </label>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ===== FAQ ===== */}
        <TabsContent value="faq">
          <Card className="p-6 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold">Perguntas frequentes</h3>
              <Button variant="outline" size="sm" onClick={() => patch({ faqs: [...page.faqs, { q: "Nova pergunta", a: "" }] })}>
                <Plus className="h-4 w-4 mr-1" />Adicionar
              </Button>
            </div>
            {page.faqs.map((f, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <div className="flex gap-2 items-start">
                  <Input value={f.q} onChange={(e) => {
                    const arr = [...page.faqs]; arr[i] = { ...f, q: e.target.value }; patch({ faqs: arr });
                  }} placeholder="Pergunta" />
                  <Button variant="ghost" size="sm" onClick={() => patch({ faqs: page.faqs.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <Textarea rows={2} value={f.a} onChange={(e) => {
                  const arr = [...page.faqs]; arr[i] = { ...f, a: e.target.value }; patch({ faqs: arr });
                }} placeholder="Resposta" />
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* ===== Checkout ===== */}
        <TabsContent value="checkout">
          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-bold mb-1">Provedor de pagamento Asaas</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Cada mentor conecta a própria conta Asaas em <Link to="/app/integrations" className="text-primary underline">Integrações</Link>. O dinheiro cai direto na sua conta.
              </p>
              {providers.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum provedor Asaas configurado ainda. <Link to="/app/integrations" className="text-primary font-medium underline">Configurar agora →</Link>
                </div>
              ) : (
                <Select
                  value={page.paymentProviderId || ""}
                  onValueChange={(v) => patch({ paymentProviderId: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione uma conta Asaas" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label || "Asaas"} · {p.environment === "production" ? "Produção" : "Sandbox"} {p.hasApiKey ? "" : " (sem key)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="rounded-lg bg-primary/5 border border-primary/15 p-4 text-sm space-y-1">
              <div className="font-semibold">Como funciona</div>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                <li>Cliente escolhe <b>PIX</b> ou <b>Cartão</b> no checkout transparente (sem sair da página).</li>
                <li>PIX gera QR Code + copia-e-cola na hora.</li>
                <li>Cartão aceita parcelamento até {page.maxInstallments}x.</li>
                <li>O valor cai direto na sua conta Asaas — 0% de intermediário da plataforma.</li>
              </ul>
            </div>

            {/* Cupons de desconto */}
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold">Cupons de desconto</h3>
                  <p className="text-xs text-muted-foreground">
                    O cliente digita o código no checkout. Percentual (1–100) ou valor fixo em centavos.
                  </p>
                </div>
                <Button
                  size="sm" variant="outline"
                  onClick={() =>
                    patch({
                      coupons: [
                        ...(page.coupons || []),
                        {
                          code: "",
                          discountType: "percent",
                          discountValue: 10,
                          isActive: true,
                          oneUsePerPerson: true,
                        },
                      ],
                    })
                  }
                >
                  <Plus className="h-4 w-4 mr-1" /> Cupom
                </Button>
              </div>

              {(page.coupons || []).length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum cupom criado.
                </div>
              ) : (
                <div className="space-y-2">
                  {(page.coupons || []).map((c, i) => {
                    const upd = (u: Partial<Coupon>) => {
                      const list = [...(page.coupons || [])];
                      list[i] = { ...list[i], ...u };
                      patch({ coupons: list });
                    };
                    const remove = () => {
                      const list = [...(page.coupons || [])];
                      list.splice(i, 1);
                      patch({ coupons: list });
                    };
                    return (
                      <div key={i} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                        <div className="grid sm:grid-cols-[1fr_140px_120px_auto] gap-2 items-end">
                          <div>
                            <Label className="text-xs">Código</Label>
                            <Input
                              value={c.code}
                              onChange={(e) => upd({ code: e.target.value.toUpperCase() })}
                              placeholder="EX: LANCAMENTO20"
                              className="font-mono uppercase"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Tipo</Label>
                            <Select
                              value={c.discountType}
                              onValueChange={(v: any) => upd({ discountType: v })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percent">Percentual (%)</SelectItem>
                                <SelectItem value="fixed">Valor fixo (centavos)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">
                              {c.discountType === "percent" ? "% desconto" : "Centavos"}
                            </Label>
                            <Input
                              type="number"
                              value={c.discountValue}
                              onChange={(e) => upd({ discountValue: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                          <Button variant="ghost" size="icon" onClick={remove} className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">Máx. usos (vazio = ilimitado)</Label>
                            <Input
                              type="number"
                              value={c.maxUses ?? ""}
                              onChange={(e) =>
                                upd({ maxUses: e.target.value ? parseInt(e.target.value) : null })
                              }
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-5">
                            <Switch
                              checked={c.oneUsePerPerson !== false}
                              onCheckedChange={(v) => upd({ oneUsePerPerson: v })}
                            />
                            <Label className="text-xs">1 uso por e-mail</Label>
                          </div>
                          <div className="flex items-center gap-2 pt-5">
                            <Switch
                              checked={c.isActive !== false}
                              onCheckedChange={(v) => upd({ isActive: v })}
                            />
                            <Label className="text-xs">Ativo</Label>
                          </div>
                        </div>
                        {(c.usedCount || 0) > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Usos: <b>{c.usedCount}</b>
                            {c.maxUses ? ` / ${c.maxUses}` : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
