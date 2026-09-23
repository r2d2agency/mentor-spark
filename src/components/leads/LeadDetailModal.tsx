// Modal de detalhe/edição do lead — aberto no clique do card no kanban.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface LeadEventGroup {
  eventId: string | null;
  eventName: string;
  slug: string | null;
}

interface Props {
  leadId: string | null;
  eventGroups: LeadEventGroup[];
  onClose: () => void;
  onSaved: (lead: any) => void;
  onOpenDossier: (id: string) => void;
}

const STAGE_OPTIONS = [
  { id: "new", label: "Novo Lead" },
  { id: "tested", label: "Fez Teste" },
  { id: "engaged", label: "Engajado" },
  { id: "negotiating", label: "Negociação" },
  { id: "client", label: "Mentorado" },
  { id: "lost", label: "Perdido" },
];

const TEMP_OPTIONS = [
  { id: "", label: "—" },
  { id: "cold", label: "Cold" },
  { id: "warm", label: "Warm" },
  { id: "hot", label: "Hot" },
];

export default function LeadDetailModal({ leadId, eventGroups, onClose, onSaved, onOpenDossier }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    if (!leadId) { setForm(null); return; }
    setLoading(true);
    api<any>(`/leads/${leadId}`)
      .then((d) => setForm(d))
      .catch((e: any) => { toast.error(e.message); onClose(); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function set(k: string, v: any) {
    setForm((f: any) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const body: any = {
        name: form.name, email: form.email, phone: form.phone || null,
        company: form.company || null, stage: form.stage,
        temperature: form.temperature || null,
        score: form.score != null && form.score !== "" ? Number(form.score) : null,
        notes: form.notes || null,
        source: form.source || null,
        eventId: form.eventId || null,
      };
      const saved = await api<any>(`/leads/${form.id}`, { method: "PATCH", body });
      toast.success("Lead atualizado!");
      onSaved(saved);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function convert() {
    if (!form) return;
    setConverting(true);
    try {
      await api(`/leads/${form.id}/convert`, { method: "POST" });
      toast.success("Lead convertido em mentorado!");
      const saved = await api<any>(`/leads/${form.id}`);
      onSaved(saved);
      setForm((f: any) => ({ ...f, stage: "client" }));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConverting(false);
    }
  }

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe do lead</DialogTitle>
        </DialogHeader>
        {loading || !form ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {form.eventName && (
              <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent">
                Origem: {form.eventName}
              </Badge>
            )}
            {!form.eventName && form.source && (
              <Badge variant="outline">Origem: {form.source}</Badge>
            )}

            <div className="border border-border/40 rounded-lg p-3 bg-muted/20 space-y-3">
              <Badge variant="outline">Contato</Badge>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Nome *</Label><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Email *</Label><Input value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Telefone</Label><Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Empresa</Label><Input value={form.company || ""} onChange={(e) => set("company", e.target.value)} /></div>
              </div>
            </div>

            <div className="border border-border/40 rounded-lg p-3 bg-muted/20 space-y-3">
              <Badge variant="outline">Pipeline</Badge>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Etapa</Label>
                  <Select value={form.stage} onValueChange={(v) => set("stage", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGE_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Temperatura</Label>
                  <Select value={form.temperature || ""} onValueChange={(v) => set("temperature", v || null)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {TEMP_OPTIONS.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Score (%)</Label><Input type="number" value={form.score ?? ""} onChange={(e) => set("score", e.target.value)} /></div>
              </div>
            </div>

            <div className="border border-border/40 rounded-lg p-3 bg-muted/20 space-y-3">
              <Badge variant="outline">Origem</Badge>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Evento</Label>
                  <Select
                    value={form.eventId || "none"}
                    onValueChange={(v) => {
                      set("eventId", v === "none" ? null : v);
                      const g = eventGroups.find((x) => x.eventId === (v === "none" ? null : v));
                      if (g?.eventId && g.eventName !== "Sem evento") set("source", `event:${g.slug || ""}`);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Avulso / sem evento" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Avulso / sem evento</SelectItem>
                      {eventGroups.filter((g) => g.eventId).map((g) => (
                        <SelectItem key={g.eventId} value={g.eventId!}>{g.eventName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Source</Label><Input value={form.source || ""} onChange={(e) => set("source", e.target.value)} placeholder="ex.: event:slug, sales:pagina, manual" /></div>
              </div>
              {form.salesPageSlug && (
                <div className="text-xs text-muted-foreground">Página de vendas: <b>{form.salesPageSlug}</b></div>
              )}
            </div>

            <div className="border border-border/40 rounded-lg p-3 bg-muted/20 space-y-3">
              <Badge variant="outline">Observações</Badge>
              <div className="space-y-1"><Input value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Notas sobre o lead..." /></div>
              <div className="text-[11px] text-muted-foreground">
                Criado em {form.createdAt ? new Date(form.createdAt).toLocaleString("pt-BR") : "—"}
                {form.isMentorado ? " • Já é mentorado" : ""}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={() => form && onOpenDossier(form.id)}>Abrir prontuário</Button>
          <Button variant="outline" onClick={convert} disabled={!form || converting || form?.stage === "client"}>
            {converting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Converter em mentorado
          </Button>
          <Button onClick={save} disabled={!form || saving} className="bg-gradient-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
