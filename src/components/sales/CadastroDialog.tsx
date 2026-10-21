import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SignupFields } from "@/types/sales-page";

export type SignupResult = {
  ok: boolean;
  leadId?: string | null;
  successType?: "internal" | "url" | "file";
  accessUrl?: string | null;
  redirectUrl?: string | null;
  successFile?: string | null;
};

export type CadastroDialogProps = {
  open: boolean;
  onClose: () => void;
  mentorSlug: string;
  pageSlug: string;
  /** Dados já coletados pela página HTML do mentor. */
  initial?: SignupFields;
  /** Chamado com o resultado do cadastro (o pai decide o destino). */
  onSuccess?: (result: SignupResult) => void;
};

/**
 * Modal de cadastro exibido quando o mentor marca um botão `data-mf="signup"`
 * que **não** está dentro de um formulário — a página não tem campos para
 * coletar, então a plataforma fornece o formulário.
 */
export default function CadastroDialog({
  open, onClose, mentorSlug, pageSlug, initial, onSuccess,
}: CadastroDialogProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [company, setCompany] = useState(initial?.company || "");
  const [revenue, setRevenue] = useState(initial?.revenue || "");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open || !initial) return;
    setName((v) => v || initial.name || "");
    setEmail((v) => v || initial.email || "");
    setPhone((v) => v || initial.phone || "");
    setCompany((v) => v || initial.company || "");
    setRevenue((v) => v || initial.revenue || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async () => {
    if (name.trim().length < 2) { toast.error("Informe o nome completo."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error("Informe um e-mail válido."); return; }
    if (password && password.length < 8) { toast.error("A senha deve ter no mínimo 8 caracteres."); return; }

    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/public/sales-pages/${mentorSlug}/${pageSlug}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          revenue: revenue.trim() || undefined,
          password: password || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Não foi possível concluir o cadastro.");
      onSuccess?.(data as SignupResult);
      toast.success("Cadastro realizado com sucesso!");
    } catch (e: any) {
      toast.error(e.message || "Não foi possível concluir o cadastro.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar meu acesso</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>Nome completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
          </div>
          <div>
            <Label>Empresa (opcional)</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <Label>Receita / faturamento (opcional)</Label>
            <Input value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </div>
          <div>
            <Label>Senha (opcional)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
          </div>

          <Button onClick={submit} disabled={loading} className="w-full bg-primary hover:opacity-90">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Criar meu acesso
          </Button>
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Seus dados ficam com o mentor
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
