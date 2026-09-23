import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Settings, Trash2, ArrowLeft, Tag } from "lucide-react";
import { toast } from "sonner";
import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";

interface Column { id: string; name: string; color: string; order: number; slug?: string; }
interface Card { id: string; columnId: string; title: string; description?: string; originLabel?: string | null; order: number; }
interface Board { id: string; name: string; color?: string; columns: Column[]; cards: Card[]; }

function CardItem({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, opacity: isDragging ? 0.4 : 1 } : undefined;
  return (
    <Card ref={setNodeRef} style={style} {...attributes} {...listeners} className="p-3 cursor-grab active:cursor-grabbing hover:border-primary/40">
      <div className="font-medium text-sm">{card.title}</div>
      {card.description && <div className="text-xs text-muted-foreground mt-1">{card.description}</div>}
      {card.originLabel && <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2 truncate"><Tag className="h-3 w-3 shrink-0" /><span className="truncate">{card.originLabel}</span></div>}
    </Card>
  );
}

function ColumnView({ col, cards, onAddCard }: { col: Column; cards: Card[]; onAddCard: (colId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="w-72 shrink-0">
      <div className="rounded-xl p-3 mb-2 border" style={{ backgroundColor: `${col.color}20`, borderColor: `${col.color}40` }}>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
          <h3 className="font-semibold text-sm flex-1">{col.name}</h3>
          <Badge variant="outline" className="text-xs">{cards.length}</Badge>
        </div>
      </div>
      <div ref={setNodeRef} className={`space-y-2 min-h-[60vh] p-2 rounded-xl border-2 border-dashed transition-all ${isOver ? "border-primary bg-primary/5" : "border-border/30 bg-card/20"}`}>
        {cards.map((c) => <CardItem key={c.id} card={c} />)}
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => onAddCard(col.id)}>
          <Plus className="h-3 w-3 mr-1" />Adicionar
        </Button>
      </div>
    </div>
  );
}

export default function BoardDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [colOpen, setColOpen] = useState(false);
  const [colForm, setColForm] = useState({ name: "", color: "#6366f1" });
  const [cardOpen, setCardOpen] = useState(false);
  const [cardForm, setCardForm] = useState({ columnId: "", title: "", description: "" });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function load() { try { setBoard(await api<Board>(`/kanban/boards/${id}`)); } catch (e: any) { toast.error(e.message); } }
  useEffect(() => { load(); }, [id]);

  async function moveCard(e: DragEndEvent) {
    if (!e.over || !board) return;
    const card = board.cards.find((c) => c.id === e.active.id);
    if (!card || card.columnId === e.over.id) return;
    const newColId = String(e.over.id);
    setBoard({ ...board, cards: board.cards.map((c) => c.id === card.id ? { ...c, columnId: newColId } : c) });
    try { await api(`/kanban/cards/${card.id}/move`, { method: "PATCH", body: { columnId: newColId } }); }
    catch (e: any) { toast.error(e.message); load(); }
  }

  async function addColumn() {
    if (!colForm.name) return;
    try { await api(`/kanban/boards/${id}/columns`, { method: "POST", body: colForm }); setColOpen(false); setColForm({ name: "", color: "#6366f1" }); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  async function deleteColumn(colId: string) {
    if (!confirm("Excluir coluna?")) return;
    try { await api(`/kanban/columns/${colId}`, { method: "DELETE" }); load(); } catch (e: any) { toast.error(e.message); }
  }

  function openAddCard(colId: string) { setCardForm({ columnId: colId, title: "", description: "" }); setCardOpen(true); }
  async function addCard() {
    if (!cardForm.title) return;
    try { await api("/kanban/cards", { method: "POST", body: { ...cardForm, boardId: id } }); setCardOpen(false); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  if (!board) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => nav("/app/boards")} className="mb-2"><ArrowLeft className="h-4 w-4 mr-1" />Boards</Button>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: board.color || "#6366f1" }} />
            {board.name}
          </h1>
        </div>
        <div className="flex gap-2">
          <Dialog open={colOpen} onOpenChange={setColOpen}>
            <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-2" />Coluna</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova coluna</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Nome</Label><Input value={colForm.name} onChange={(e) => setColForm({ ...colForm, name: e.target.value })} /></div>
                <div><Label className="text-xs">Cor</Label><Input type="color" value={colForm.color} onChange={(e) => setColForm({ ...colForm, color: e.target.value })} className="h-10 w-20" /></div>
              </div>
              <DialogFooter><Button onClick={addColumn}>Adicionar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={moveCard}>
        <div className="flex gap-4 overflow-x-auto pb-6">
          {board.columns.sort((a, b) => a.order - b.order).map((col) => (
            <div key={col.id} className="relative">
              <ColumnView col={col} cards={board.cards.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order)} onAddCard={openAddCard} />
              <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6 opacity-50 hover:opacity-100" onClick={() => deleteColumn(col.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
      </DndContext>

      <Dialog open={cardOpen} onOpenChange={setCardOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo card</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Título</Label><Input value={cardForm.title} onChange={(e) => setCardForm({ ...cardForm, title: e.target.value })} /></div>
            <div><Label className="text-xs">Descrição</Label><Input value={cardForm.description} onChange={(e) => setCardForm({ ...cardForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={addCard}>Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
