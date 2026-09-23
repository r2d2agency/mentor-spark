// Kanban do Funil — /app/leads (Dark Premium)
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
   Loader2, Kanban as KanbanIcon, Flame, Snowflake, Cloud, Tag,
   TrendingUp, Users, Sparkles, Plus, Zap, Filter, List, UserPlus, Download,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import LeadDetailModal from "@/components/leads/LeadDetailModal";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

interface Lead {
  id: string;
  name: string;
  email: string;
  company?: string;
  stage: string;
  temperature?: "cold" | "warm" | "hot";
  score?: number;
  createdAt: string;
  phone?: string;
  source?: string;
  eventId?: string | null;
  eventName?: string | null;
  salesPageSlug?: string | null;
}

interface EventGroup {
  eventId: string | null;
  eventName: string;
  slug: string | null;
  total: number;
}

function originLabel(lead: Lead) {
  if (lead.eventName) return lead.eventName;
  if (lead.salesPageSlug) return `Vendas: ${lead.salesPageSlug}`;
  if (lead.source) return lead.source;
  return null;
}

 type FunnelView = "principal" | "hot" | "tested" | "negotiating" | "clients" | "lost" | "list";

const STAGES = [
  { id: "new",         label: "Novo Lead",   gradient: "from-slate-500/20 to-slate-700/10",   dot: "bg-slate-400" },
  { id: "tested",      label: "Fez Teste",   gradient: "from-blue-500/20 to-blue-700/10",     dot: "bg-blue-400" },
  { id: "engaged",     label: "Engajado",    gradient: "from-amber-500/20 to-amber-700/10",   dot: "bg-amber-400" },
  { id: "negotiating", label: "Negociação",  gradient: "from-violet-500/20 to-violet-700/10", dot: "bg-violet-400" },
  { id: "client",      label: "Mentorado",   gradient: "from-emerald-500/20 to-emerald-700/10", dot: "bg-emerald-400" },
  { id: "lost",        label: "Perdido",     gradient: "from-rose-500/20 to-rose-700/10",     dot: "bg-rose-400" },
];

const FUNNEL_VIEWS: { id: FunnelView; label: string; description: string; stages: string[] }[] = [
  { id: "principal",   label: "Funil principal",       description: "Todas as etapas do pipeline",         stages: STAGES.map((s) => s.id) },
  { id: "hot",         label: "Hot leads",             description: "Apenas leads com temperatura HOT",     stages: ["new", "tested", "engaged", "negotiating"] },
  { id: "tested",      label: "Fizeram teste",         description: "Leads que já responderam um teste",    stages: ["tested", "engaged", "negotiating", "client"] },
  { id: "negotiating", label: "Em negociação",         description: "Pipeline final — fechamento",          stages: ["negotiating", "client", "lost"] },
  { id: "clients",     label: "Mentorados ativos",     description: "Apenas quem já é cliente",             stages: ["client"] },
   { id: "lost",        label: "Perdidos / reengajar",  description: "Recuperação de oportunidades",         stages: ["lost"] },
   { id: "list",        label: "Lista de Contatos",     description: "Visão em lista com tags e histórico",  stages: STAGES.map(s => s.id) },
];

function tempBadge(t?: string) {
  if (t === "hot")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_12px_hsl(var(--hot)/0.3)]">
        <Flame className="h-2.5 w-2.5" /> HOT
      </span>
    );
  if (t === "warm")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <Cloud className="h-2.5 w-2.5" /> WARM
      </span>
    );
  if (t === "cold")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
        <Snowflake className="h-2.5 w-2.5" /> COLD
      </span>
    );
  return null;
}

function avatarFromName(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;

  // Diferencia clique de drag: só dispara onOpen se o ponteiro mal se moveu
  let downX = 0, downY = 0;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => { downX = e.clientX; downY = e.clientY; (listeners as any)?.onPointerDown?.(e); }}
      onClick={(e) => {
        const dx = Math.abs(e.clientX - downX);
        const dy = Math.abs(e.clientY - downY);
        if (dx < 4 && dy < 4) onOpen();
      }}
      className="group glass-card border-border/60 p-3 cursor-pointer hover:border-primary/40 hover:shadow-glow transition-all space-y-2"
    >
      <div className="flex items-start gap-2.5">
        <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shadow-glow shrink-0">
          {avatarFromName(lead.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight truncate group-hover:text-gradient transition-all">
            {lead.name}
          </div>
          {lead.company && <div className="text-[11px] text-muted-foreground truncate">{lead.company}</div>}
          {!lead.company && <div className="text-[11px] text-muted-foreground truncate">{lead.email}</div>}
        </div>
      </div>
      {originLabel(lead) && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
          <Tag className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{originLabel(lead)}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <div className="flex items-center gap-1.5">
          {tempBadge(lead.temperature)}
          {lead.score != null && (
            <Badge variant="outline" className="text-[10px] h-5 border-border/60 bg-card/40">
              {Math.round(lead.score)}%
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          Abrir →
        </span>
      </div>
    </Card>
  );
}

function Column({
  stage,
  leads,
  onOpen,
  index,
}: {
  stage: typeof STAGES[0];
  leads: Lead[];
  onOpen: (id: string) => void;
  index: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className={`flex-shrink-0 w-72 animate-fade-in anim-delay-${Math.min((index + 1) * 100, 600)}`}>
      <div className={`rounded-2xl bg-gradient-to-br ${stage.gradient} border border-border/40 p-3 mb-2`}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${stage.dot} shadow-[0_0_8px_currentColor]`} />
          <h3 className="font-semibold text-sm">{stage.label}</h3>
          <Badge variant="outline" className="ml-auto text-xs border-border/60 bg-card/40">
            {leads.length}
          </Badge>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 min-h-[60vh] p-2 rounded-2xl border-2 border-dashed transition-all ${
          isOver
            ? "border-primary bg-primary/5 shadow-glow"
            : "border-border/30 bg-card/20"
        }`}
      >
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} onOpen={() => onOpen(l.id)} />
        ))}
        {leads.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">Solte um card aqui</div>
        )}
      </div>
    </div>
  );
}

 export default function LeadsPage() {
   const [leads, setLeads] = useState<Lead[] | null>(null);
   const [activeId, setActiveId] = useState<string | null>(null);
   const [quickOpen, setQuickOpen] = useState(false);
   const [quickSaving, setQuickSaving] = useState(false);
   const [quick, setQuick] = useState({ name: "", email: "", phone: "", company: "", sendInvite: false });
   const [funnelView, setFunnelView] = useState<FunnelView>("principal");
   const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
   const [groupDialogOpen, setGroupDialogOpen] = useState(false);
   const [availableGroups, setAvailableGroups] = useState<any[]>([]);
   const [loadingGroups, setLoadingGroups] = useState(false);
   const [targetGroup, setTargetGroup] = useState("");
   const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
   const [originFilter, setOriginFilter] = useState<string>("all");
   const [detailId, setDetailId] = useState<string | null>(null);
   const nav = useNavigate();
   async function loadGroups() {
     setLoadingGroups(true);
     try {
       const r = await api<{ ok: boolean; groups?: any[] }>("/integrations/whatsapp/groups");
       if (r.ok) setAvailableGroups(r.groups || []);
     } catch (e) { console.error(e); } finally { setLoadingGroups(false); }
   }
 
   async function addToGroup() {
     if (!targetGroup || selectedLeads.length === 0) return;
     try {
       const leadData = leads?.filter(l => selectedLeads.includes(l.id)) || [];
       // Buscar instâncias para usar a correta (padrão ou primeira conectada)
       const instancesRes = await api<{ instances: any[] }>("/integrations/whatsapp");
       const instance = instancesRes.instances?.find((i: any) => i.isDefault) || instancesRes.instances?.find((i: any) => i.status === "connected");
       const customHeaders: any = {};
       if (instance) customHeaders["x-instance-id"] = instance.id;

       const phones = leadData.map(l => (l as any).phone).filter(Boolean);
       if (phones.length === 0) { toast.error("Leads selecionados não possuem telefone"); return; }
       
       await api(`/integrations/whatsapp/groups/${encodeURIComponent(targetGroup)}/participants`, {
         method: "POST", headers: customHeaders, body: { participants: phones }
       });
       toast.success(`${phones.length} contatos adicionados ao grupo!`);
       setGroupDialogOpen(false);
       setSelectedLeads([]);
     } catch (e: any) { toast.error(e.message); }
   }
 
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function load() {
    try {
      const params = new URLSearchParams();
      if (originFilter === "none") params.set("eventId", "none");
      else if (originFilter !== "all") {
        if (originFilter.startsWith("sales:")) params.set("source", originFilter);
        else params.set("eventId", originFilter);
      }
      const qs = params.toString();
      const [list, groups] = await Promise.all([
        api<Lead[]>(`/leads${qs ? `?${qs}` : ""}`),
        api<EventGroup[]>("/leads/by-event").catch(() => [] as EventGroup[]),
      ]);
      setLeads(list);
      setEventGroups(groups);
    }
    catch (e: any) { toast.error(e.message); }
  }
  useEffect(() => { load(); }, [originFilter]);

  async function quickCreate() {
    if (!quick.name || !quick.email) { toast.error("Nome e email obrigatórios"); return; }
    setQuickSaving(true);
    try {
      const lead = await api<any>("/leads/manual", { method: "POST", body: quick });
      toast.success("Lead criado!");
      setQuickOpen(false);
      setQuick({ name: "", email: "", phone: "", company: "", sendInvite: false });
      setLeads((prev) => prev ? [lead, ...prev] : [lead]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setQuickSaving(false);
    }
  }

  function onStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  function exportCsv() {
    const rows = filteredLeads;
    if (rows.length === 0) { toast.error("Nada para exportar com o filtro atual"); return; }
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["nome", "email", "telefone", "empresa", "etapa", "temperatura", "score", "origem", "evento", "criado_em"];
    const lines = rows.map((l) => [
      l.name, l.email, l.phone || "", l.company || "", l.stage, l.temperature || "",
      l.score ?? "", l.source || "", l.eventName || "", l.createdAt ? new Date(l.createdAt).toLocaleString("pt-BR") : "",
    ].map(esc).join(";"));
    const csv = "﻿" + header.join(";") + "\r\n" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const origin = originFilter === "all" ? "todos" : (eventGroups.find((g) => (g.eventId || "none") === originFilter)?.eventName || originFilter);
    a.href = url;
    a.download = `leads-${origin}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} leads exportados!`);
  }

  async function onEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !leads) return;
    const lead = leads.find((l) => l.id === active.id);
    if (!lead || lead.stage === over.id) return;

    const prev = leads;
    setLeads(leads.map((l) => (l.id === active.id ? { ...l, stage: String(over.id) } : l)));

    try {
      await api(`/leads/${active.id}`, { method: "PATCH", body: { stage: over.id } });
      toast.success("Lead movido");
    } catch (e: any) {
      setLeads(prev);
      toast.error(e.message);
    }
  }

  const view = useMemo(() => FUNNEL_VIEWS.find((v) => v.id === funnelView)!, [funnelView]);

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    let result = leads.filter((l) => view.stages.includes(l.stage));
    if (funnelView === "hot") result = result.filter((l) => l.temperature === "hot");
    return result;
  }, [leads, view, funnelView]);

  const visibleStages = useMemo(
    () => STAGES.filter((s) => view.stages.includes(s.id)),
    [view],
  );

  if (!leads) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const dragging = activeId ? leads.find((l) => l.id === activeId) : null;
  const hot = leads.filter((l) => l.temperature === "hot").length;
  const clients = leads.filter((l) => l.stage === "client").length;
  const conversionRate = leads.length > 0 ? Math.round((clients / leads.length) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-hero border border-border/60 p-8 md:p-10">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />

        <div className="relative animate-fade-in flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge variant="outline" className="mb-3 border-accent/40 bg-accent/10 text-accent">
              <KanbanIcon className="h-3 w-3 mr-1" /> Pipeline de vendas
            </Badge>
            <h1 className="text-4xl md:text-5xl font-display tracking-tight text-balance">
              Funil de <span className="text-gradient">leads</span>
            </h1>
            <p className="text-muted-foreground mt-2 max-w-lg">
              Arraste cards entre as etapas. Clique no card para abrir o prontuário completo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-accent/40" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-2" />Exportar CSV
            </Button>
            <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-accent/40">
                  <Zap className="h-4 w-4 mr-2" />Cadastro rápido
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cadastro rápido</DialogTitle>
                  <DialogDescription>Apenas o essencial. Você pode completar depois no prontuário.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2"><Label className="text-xs">Nome *</Label><Input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} /></div>
                  <div className="space-y-1 col-span-2"><Label className="text-xs">Email *</Label><Input type="email" value={quick.email} onChange={(e) => setQuick({ ...quick, email: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Telefone</Label><Input value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Empresa</Label><Input value={quick.company} onChange={(e) => setQuick({ ...quick, company: e.target.value })} /></div>
                  <div className="col-span-2 flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/40">
                    <div>
                      <div className="text-sm font-medium">Enviar convite</div>
                      <div className="text-xs text-muted-foreground">Cria login + envia senha por email.</div>
                    </div>
                    <Switch checked={quick.sendInvite} onCheckedChange={(v) => setQuick({ ...quick, sendInvite: v })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={quickCreate} disabled={quickSaving} className="bg-gradient-primary">
                    {quickSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Criar lead
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button onClick={() => nav("/app/leads/novo")} className="bg-gradient-primary">
              <Plus className="h-4 w-4 mr-2" />Cadastro completo
            </Button>
          </div>
        </div>

        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[
            { label: "Total", value: leads.length, icon: Users, glow: "text-foreground" },
            { label: "Hot leads", value: hot, icon: Flame, glow: "text-rose-400" },
            { label: "Mentorados", value: clients, icon: Sparkles, glow: "text-emerald-400" },
            { label: "Conversão", value: `${conversionRate}%`, icon: TrendingUp, glow: "text-violet-400" },
          ].map((s, i) => (
            <div key={s.label} className={`glass-card rounded-2xl p-4 animate-fade-in anim-delay-${(i + 1) * 100}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</span>
                <s.icon className={`h-4 w-4 ${s.glow}`} />
              </div>
              <div className={`text-3xl font-display font-bold mt-1 ${s.glow}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SELETOR DE FUNIL */}
      <div className="flex flex-wrap items-center gap-3 -mt-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4 text-primary" />
          <span>Visualizar funil:</span>
        </div>
        <Select value={funnelView} onValueChange={(v) => setFunnelView(v as FunnelView)}>
          <SelectTrigger className="w-[260px] bg-card/50 border-border/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FUNNEL_VIEWS.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <div className="flex flex-col">
                  <span className="font-medium">{v.label}</span>
                  <span className="text-[11px] text-muted-foreground">{v.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="border-border/60 bg-card/40">
          {filteredLeads.length} leads nesta visão
        </Badge>
        <Select value={originFilter} onValueChange={setOriginFilter}>
          <SelectTrigger className="w-[240px] bg-card/50 border-border/60">
            <SelectValue placeholder="Origem: todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            {eventGroups.map((g) => (
              <SelectItem key={g.eventId || "none"} value={g.eventId || "none"}>
                {g.eventName} ({g.total})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

       {funnelView === "list" ? (
         <div className="space-y-4 animate-fade-in">
           <div className="flex items-center justify-between p-4 bg-muted/20 rounded-xl border border-border/40">
             <div className="text-sm text-muted-foreground">
               {selectedLeads.length} selecionados
             </div>
             <div className="flex gap-2">
               <Button 
                 size="sm" 
                 variant="outline" 
                 disabled={selectedLeads.length === 0}
                 onClick={() => { loadGroups(); setGroupDialogOpen(true); }}
               >
                 <UserPlus className="h-4 w-4 mr-2" /> Incluir em Grupo/Canal
               </Button>
             </div>
           </div>
 
           <div className="grid gap-3">
             {filteredLeads.map((l) => (
               <Card 
                 key={l.id} 
                 className={`p-4 flex items-center gap-4 hover:border-primary/40 transition-all cursor-pointer ${selectedLeads.includes(l.id) ? 'border-primary bg-primary/5' : ''}`}
                 onClick={() => setDetailId(l.id)}
               >
                 <div 
                   className="h-5 w-5 rounded border border-primary flex items-center justify-center shrink-0"
                   onClick={(e) => {
                     e.stopPropagation();
                     setSelectedLeads(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev, l.id]);
                   }}
                 >
                   {selectedLeads.includes(l.id) && <div className="h-3 w-3 bg-primary rounded-sm" />}
                 </div>
                 <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center font-bold text-xs shrink-0">
                   {avatarFromName(l.name)}
                 </div>
                 <div className="flex-1 min-w-0">
                   <div className="font-medium truncate">{l.name}</div>
                   <div className="text-xs text-muted-foreground truncate">{l.email}</div>
                 </div>
                 <div className="hidden md:flex flex-wrap gap-1 items-center max-w-[300px]">
                   <Badge variant="outline" className="text-[10px] capitalize">
                     {STAGES.find(s => s.id === l.stage)?.label}
                   </Badge>
                   {originLabel(l) && (
                     <Badge variant="outline" className="text-[10px] border-accent/40 bg-accent/10 text-accent">
                       <Tag className="h-2 w-2 mr-1" /> {originLabel(l)}
                     </Badge>
                   )}
                   {(l as any).tags?.map((tag: string) => (
                     <Badge key={tag} className="text-[10px] bg-secondary/20 text-secondary-foreground border-secondary/30">
                       <Tag className="h-2 w-2 mr-1" /> {tag}
                     </Badge>
                   ))}
                   {l.stage === 'client' && <Badge className="text-[10px] bg-violet-500/20 text-violet-300 border-violet-500/30">Mentorado</Badge>}
                 </div>
                 <div className="text-right shrink-0">
                   <div className="text-xs font-medium">Histórico</div>
                   <div className="text-[10px] text-muted-foreground">3 eventos · 2 testes</div>
                 </div>
               </Card>
             ))}
           </div>
         </div>
       ) : (
         <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd}>
           <div className="flex gap-4 overflow-x-auto pb-6 -mx-4 px-4">
             {visibleStages.map((s, i) => (
               <Column
                 key={s.id}
                 index={i}
                 stage={s}
                 leads={filteredLeads.filter((l) => l.stage === s.id)}
                 onOpen={(id) => setDetailId(id)}
               />
             ))}
           </div>
           <DragOverlay>{dragging && <LeadCard lead={dragging} onOpen={() => {}} />}</DragOverlay>
         </DndContext>
       )}
 
       <LeadDetailModal
         leadId={detailId}
         eventGroups={eventGroups}
         onClose={() => setDetailId(null)}
         onSaved={(saved) => {
           setLeads((prev) => prev ? prev.map((l) => (l.id === saved.id ? { ...l, ...saved } : l)) : prev);
           setDetailId(null);
         }}
         onOpenDossier={(id) => { setDetailId(null); nav(`/app/leads/${id}`); }}
       />
       <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>         <DialogContent>
           <DialogHeader>
             <DialogTitle>Incluir leads em Grupo/Canal</DialogTitle>
             <DialogDescription>
               Selecione o grupo do WhatsApp para onde deseja enviar os {selectedLeads.length} contatos selecionados.
             </DialogDescription>
           </DialogHeader>
           <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label>Grupo ou Canal Alvo</Label>
               <Select value={targetGroup} onValueChange={setTargetGroup}>
                 <SelectTrigger>
                   <SelectValue placeholder={loadingGroups ? "Carregando grupos..." : "Selecione um grupo"} />
                 </SelectTrigger>
                 <SelectContent>
                   {availableGroups.map((g) => (
                     <SelectItem key={g.jid} value={g.jid}>{g.name}</SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
           </div>
           <DialogFooter>
             <Button variant="ghost" onClick={() => setGroupDialogOpen(false)}>Cancelar</Button>
             <Button onClick={addToGroup} disabled={!targetGroup}>Confirmar Inclusão</Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
    </div>
  );
}
