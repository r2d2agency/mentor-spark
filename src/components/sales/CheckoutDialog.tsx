import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2, ShieldCheck, Sparkles, Loader2, Copy, QrCode, CreditCard, Ticket, Check,
} from "lucide-react";
import { toast } from "sonner";
import { money, Payload, SignupFields } from "@/types/sales-page";

type Upsell = {
  trailId: string; priceCents: number; currency: string;
  headline: string; body: string | null; delayMinutes: number;
};

export type CheckoutDialogProps = {
  open: boolean;
  onClose: () => void;
  mentorSlug: string;
  pageSlug: string;
  page: Payload["page"];
  /** Dados já coletados pela página HTML do mentor (pré-preenchimento). */
  initial?: SignupFields;
  /** Chamado quando o pagamento é confirmado e o link de acesso está disponível. */
  onSuccess?: (accessUrl: string | null) => void;
};

export default function CheckoutDialog({
  open, onClose, mentorSlug, pageSlug, page, initial, onSuccess,
}: CheckoutDialogProps) {
  const [step, setStep] = useState<"form" | "pix" | "success">("form");
  const [method, setMethod] = useState<"PIX" | "CREDIT_CARD">("PIX");
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [cpfCnpj, setCpfCnpj] = useState(initial?.cpfCnpj || "");
  const [phone, setPhone] = useState(initial?.phone || "");

  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCcv, setCardCcv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [postalCode, setPostalCode] = useState("");
  const [addressNumber, setAddressNumber] = useState("");

  const [pix, setPix] = useState<{ payload?: string; qrImage?: string } | null>(null);

  // Dados do pós-checkout: cobrança, link de acesso e oferta de upsell.
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [chargeState, setChargeState] = useState<'pending' | 'paid' | 'denied'>('pending');
  const [checking, setChecking] = useState(false);
  const [upsellPix, setUpsellPix] = useState<{ payload?: string; qrImage?: string } | null>(null);
  const [upsellBought, setUpsellBought] = useState(false);

  // Pré-preenche quando a página do mentor já coletou os dados.
  useEffect(() => {
    if (!initial) return;
    setName((v) => v || initial.name || "");
    setEmail((v) => v || initial.email || "");
    setCpfCnpj((v) => v || initial.cpfCnpj || "");
    setPhone((v) => v || initial.phone || "");
  }, [initial]);

  const pollStatus = async (id: string) => {
    try {
      const r = await fetch(
        `${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/charge/${id}/status`,
      );
      if (!r.ok) return;
      const data = await r.json();
      // O status pode vir em caixa alta (Asaas) ou baixa (enum interno) —
      // normalizamos para não depender do formato.
      const status = String(data?.status || '').toUpperCase();
      if (status === 'PAID' || status === 'CONFIRMED' || status === 'RECEIVED') {
        setChargeState('paid');
        // O link de acesso só é emitido depois do pagamento (nunca no checkout).
        if (data?.accessUrl) setAccessUrl(data.accessUrl);
      } else if (status === 'CANCELLED' || status === 'REFUNDED') setChargeState('denied');
    } catch { /* mantém pending */ }
  };

  // Quando a cobrança existe, consulta o status periodicamente até aprovar.
  useEffect(() => {
    if (!chargeId || chargeState !== 'pending') return;
    pollStatus(chargeId);
    const t = setInterval(() => pollStatus(chargeId), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeId, chargeState]);

  // Avisa o pai assim que o pagamento cai (o link já vem no status).
  useEffect(() => {
    if (chargeState !== 'paid') return;
    onSuccess?.(accessUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeState, accessUrl]);

  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{
    valid: boolean; code?: string; discountCents?: number; finalCents?: number; message?: string;
  } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const finalCents = coupon?.valid ? (coupon.finalCents ?? page.priceCents) : page.priceCents;

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    if (!email) { toast.error("Informe o e-mail antes de aplicar o cupom"); return; }
    setValidatingCoupon(true);
    try {
      const r = await fetch(
        `${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/validate-coupon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: couponCode.trim(), email }),
        },
      );
      const data = await r.json();
      setCoupon(data);
      if (data.valid) toast.success(`Cupom aplicado! -${money(data.discountCents || 0)}`);
      else toast.error(data.message || "Cupom inválido");
    } catch (e: any) {
      toast.error("Erro ao validar cupom");
    } finally {
      setValidatingCoupon(false);
    }
  };

  const removeCoupon = () => { setCoupon(null); setCouponCode(""); };

  const submit = async () => {
    if (!name || !email || !cpfCnpj) { toast.error("Preencha nome, e-mail e CPF/CNPJ"); return; }
    if (method === "CREDIT_CARD" && (!cardNumber || !cardHolder || !cardExp || !cardCcv || !postalCode || !addressNumber)) {
      toast.error("Preencha todos os dados do cartão e endereço"); return;
    }
    setLoading(true);
    try {
      const [mm, yy] = cardExp.split("/").map((s) => s.trim());
      const body: any = {
        name, email, cpfCnpj, phone, billingType: method,
      };
      if (coupon?.valid && couponCode) body.couponCode = couponCode.trim();
      if (method === "CREDIT_CARD") {
        body.installments = installments;
        body.creditCard = {
          holderName: cardHolder,
          number: cardNumber,
          expiryMonth: mm,
          expiryYear: yy?.length === 2 ? `20${yy}` : yy,
          ccv: cardCcv,
        };
        body.creditCardHolderInfo = {
          name, email, cpfCnpj, phone, postalCode, addressNumber,
        };
      }
      const r = await fetch(`${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Falha no checkout");

      // Guarda a cobrança + oferta de upsell para a tela de sucesso.
      // O link de acesso só chega depois, via chargeStatus (pago).
      setChargeId(data.asaasChargeId || data.chargeId || null);
      setAccessUrl(data.accessUrl || null);
      setUpsell(data.upsell || null);
      setChargeState("pending");

      if (method === "PIX") {
        setPix(data.pix || null);
        setStep("pix");
      } else {
        setStep("success");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  /** Redireciona para a área de membro com o link de acesso emitido após o pagamento. */
  const goToAccess = () => {
    if (accessUrl) window.location.href = accessUrl;
    else window.location.href = "/me";
  };

  /** Upsell do pós-venda — cria uma segunda cobrança PIX na mesma página. */
  const buyUpsell = async () => {
    if (!chargeId || !upsell) return;
    setChecking(true);
    try {
      const r = await fetch(
        `${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/charge/${chargeId}/upsell`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Falha no upsell");
      setUpsellPix(data.pix || null);
      setUpsellBought(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === "success" ? "Compra confirmada" : `Finalizar compra — ${money(finalCents)}`}</DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            <Tabs value={method} onValueChange={(v: any) => setMethod(v)}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="PIX"><QrCode className="h-4 w-4 mr-2" />PIX</TabsTrigger>
                <TabsTrigger value="CREDIT_CARD"><CreditCard className="h-4 w-4 mr-2" />Cartão</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-3">
              <div>
                <Label>Nome completo</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>E-mail</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label>CPF/CNPJ</Label>
                  <Input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
              </div>

              {method === "CREDIT_CARD" && (
                <>
                  <div className="pt-2 border-t" />
                  <div>
                    <Label>Número do cartão</Label>
                    <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="0000 0000 0000 0000" />
                  </div>
                  <div>
                    <Label>Nome impresso no cartão</Label>
                    <Input value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Validade (MM/AA)</Label>
                      <Input value={cardExp} onChange={(e) => setCardExp(e.target.value)} placeholder="MM/AA" />
                    </div>
                    <div>
                      <Label>CVV</Label>
                      <Input value={cardCcv} onChange={(e) => setCardCcv(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>CEP</Label>
                      <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                    </div>
                    <div>
                      <Label>Nº do endereço</Label>
                      <Input value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} />
                    </div>
                  </div>
                  {page.maxInstallments > 1 && (
                    <div>
                      <Label>Parcelas</Label>
                      <select
                        className="w-full h-10 rounded-md border border-input bg-background px-3"
                        value={installments}
                        onChange={(e) => setInstallments(parseInt(e.target.value))}
                      >
                        {Array.from({ length: page.maxInstallments }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}x de {money(Math.floor(finalCents / n))} {n === 1 ? "(à vista)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Cupom */}
            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <Label className="flex items-center gap-2 text-sm">
                <Ticket className="h-4 w-4" /> Cupom de desconto
              </Label>
              {coupon?.valid ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-600 text-sm">
                    <Check className="h-4 w-4" />
                    <span className="font-mono font-semibold">{coupon.code}</span>
                    <span className="text-muted-foreground">-{money(coupon.discountCents || 0)}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={removeCoupon}>Remover</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Digite o código"
                    className="font-mono uppercase"
                  />
                  <Button
                    type="button" variant="outline"
                    onClick={applyCoupon}
                    disabled={validatingCoupon || !couponCode.trim()}
                  >
                    {validatingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
                  </Button>
                </div>
              )}
            </div>

            {/* Resumo */}
            <div className="rounded-lg border p-3 space-y-1 text-sm bg-background/40">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{money(page.priceCents)}</span>
              </div>
              {coupon?.valid && (
                <div className="flex justify-between text-emerald-600">
                  <span>Desconto ({coupon.code})</span>
                  <span>-{money(coupon.discountCents || 0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t">
                <span>Total</span>
                <span>{money(finalCents)}</span>
              </div>
            </div>

            <Button onClick={submit} disabled={loading} className="w-full bg-primary hover:opacity-90">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {method === "PIX" ? "Gerar PIX" : `Pagar ${money(finalCents)}`}
            </Button>
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Processado com segurança pela Asaas
            </div>
          </div>
        )}

        {step === "pix" && (
          <div className="space-y-4 text-center">
            {pix?.qrImage ? (
              <img src={pix.qrImage} alt="QR Code Pix" className="mx-auto w-56 h-56 rounded-lg border" />
            ) : (
              <div className="text-sm text-muted-foreground">Gerando QR Code…</div>
            )}
            {pix?.payload && (
              <>
                <div className="text-xs text-muted-foreground">Ou copie o código:</div>
                <div className="rounded-lg border p-3 text-xs break-all bg-muted/30">{pix.payload}</div>
                <Button
                  variant="outline" className="w-full"
                  onClick={() => { navigator.clipboard.writeText(pix.payload!); toast.success("Código copiado"); }}
                >
                  <Copy className="h-4 w-4 mr-2" /> Copiar código PIX
                </Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              {chargeState === "pending"
                ? "Assim que o pagamento cair, o acesso é liberado aqui mesmo — sem depender de e-mail."
                : "Pagamento confirmado! Seu acesso já está liberado."}
            </p>
            <Button
              variant="outline" className="w-full"
              disabled={chargeState !== "paid"}
              onClick={goToAccess}
            >
              {chargeState === "paid" ? (
                <>Acessar meu conteúdo <CheckCircle2 className="h-4 w-4 ml-2" /></>
              ) : (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aguardando confirmação…</>
              )}
            </Button>
          </div>
        )}

        {step === "success" && (
          <div className="text-center space-y-3 py-4">
            <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-bold text-lg">
              {chargeState === "paid" ? "Pagamento confirmado 🎉" : "Pagamento em processamento"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {chargeState === "paid"
                ? "Seu acesso está liberado. Clique abaixo para entrar na área de membro."
                : "Assim que a Asaas aprovar, o botão abaixo libera seu acesso automaticamente."}
            </p>
            <Button
              className="w-full"
              disabled={chargeState !== "paid"}
              onClick={goToAccess}
            >
              {chargeState === "paid" ? (
                <>Acessar meu conteúdo <CheckCircle2 className="h-4 w-4 ml-2" /></>
              ) : (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aguardando confirmação…</>
              )}
            </Button>
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
          </div>
        )}

        {/* Oferta de upgrade apresentada no pós-venda (mesmo PIX do produto principal). */}
        {upsell && !upsellBought && chargeState === "paid" && (
          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h4 className="font-semibold text-sm">{upsell.headline}</h4>
            </div>
            {upsell.body && <p className="text-xs text-muted-foreground">{upsell.body}</p>}
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-bold">{money(upsell.priceCents)}</span>
              <Button size="sm" onClick={buyUpsell} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Quero também"}
              </Button>
            </div>
          </div>
        )}

        {upsell && upsellBought && (
          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 text-center">
            <h4 className="font-semibold text-sm">Complete o pagamento do upgrade</h4>
            {upsellPix?.qrImage ? (
              <img src={upsellPix.qrImage} alt="QR Code Pix" className="mx-auto w-44 h-44 rounded-lg border" />
            ) : (
              <div className="text-sm text-muted-foreground">Gerando QR Code…</div>
            )}
            {upsellPix?.payload && (
              <div className="rounded-lg border p-2 text-[11px] break-all bg-muted/30">{upsellPix.payload}</div>
            )}
            <p className="text-xs text-muted-foreground">
              O acesso à trilha extra é liberado assim que este PIX confirmar.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
