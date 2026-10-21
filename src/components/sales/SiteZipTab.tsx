import { useCallback, useEffect, useRef, useState } from "react";
import { api, API_BASE, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Copy, FileCode2, Eye, Save } from "lucide-react";
import { toast } from "sonner";

export type SiteInfo = {
  enabled: boolean;
  siteToken: string | null;
  entry: string | null;
  files: { path: string; size: number }[];
  uploadedAt: string | null;
  successType: "internal" | "url" | "file";
  successUrl: string | null;
  successFile: string | null;
  eventSlug: string | null;
  previewToken: string;
  previewExpiresAt: string;
};

type Props = { pageId: string };

const SNIPPET = `<button data-mf="checkout">Comprar agora</button>

<form data-mf="signup">
  <input data-mf-field="name"  name="name"  type="text" required>
  <input data-mf-field="email" name="email" type="email" required>
  <input data-mf-field="phone" name="phone" type="tel">
  <button type="submit">Criar meu acesso</button>
</form>

<button data-mf="signup">Quero me cadastrar</button>
<button data-mf="event">Garantir vaga</button>
<a data-mf="link" data-mf-href="/programa">Ver o programa</a>`;

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Aba "Página HTML (ZIP)" do editor de páginas de vendas.
 *
 * O upload usa `fetch` cru com `FormData` porque o helper `api()` sempre
 * envia `Content-Type: application/json`, o que quebraria o multipart.
 */
export default function SiteZipTab({ pageId }: Props) {
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [entry, setEntry] = useState("");
  const [successType, setSuccessType] = useState<"internal" | "url" | "file">("internal");
  const [successUrl, setSuccessUrl] = useState("");
  const [successFile, setSuccessFile] = useState("");
  const [eventSlug, setEventSlug] = useState("");
  const [enabled, setEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<SiteInfo>(`/sales-pages/${pageId}/site`);
      setInfo(data);
      setEntry(data.entry || "");
      setSuccessType(data.successType || "internal");
      setSuccessUrl(data.successUrl || "");
      setSuccessFile(data.successFile || "");
      setEventSlug(data.eventSlug || "");
      setEnabled(data.enabled);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Envie um arquivo .zip.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const t = getToken();
      const res = await fetch(`${API_BASE}/sales-pages/${pageId}/site/upload`, {
        method: "POST",
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
        throw new Error(msg || `Erro ${res.status}`);
      }
      toast.success(`Site enviado: ${data.files?.length || 0} arquivos.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Não foi possível enviar o ZIP.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const data = await api<SiteInfo>(`/sales-pages/${pageId}/site/config`, {
        method: "PUT",
        body: {
          enabled,
          entry: entry || null,
          successType,
          successUrl: successType === "url" ? successUrl : null,
          successFile: successType === "file" ? successFile : null,
          eventSlug: eventSlug || null,
        },
      });
      setInfo(data);
      toast.success("Configuração do site salva.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remover o site enviado? A página voltará ao layout interno.")) return;
    setRemoving(true);
    try {
      await api(`/sales-pages/${pageId}/site`, { method: "DELETE" });
      toast.success("Site removido.");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  const hasSite = !!info?.siteToken;
  const htmlFiles = (info?.files || []).filter((f) => /\.html?$/i.test(f.path));
  const previewSrc = hasSite && info?.previewToken
    ? `${API_BASE}/sales-pages/${pageId}/site/preview/${encodeURIComponent(info.previewToken)}/`
    : "";

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-bold mb-1">Página HTML em ZIP</h3>
          <p className="text-sm text-muted-foreground">
            Envie sua página pronta (HTML, CSS, imagens e JS). A plataforma só conecta os botões:
            checkout, cadastro e evento. Limite de 50 MB.
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Enviando e extraindo…
            </div>
          ) : (
            <div className="space-y-1">
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <div className="text-sm font-medium">Clique ou arraste seu .zip aqui</div>
              <div className="text-xs text-muted-foreground">Substitui o site anterior, se houver</div>
            </div>
          )}
        </div>

        {hasSite && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <div className="font-medium flex items-center gap-2">
                <FileCode2 className="h-4 w-4" /> Site enviado
                <Badge variant="outline">{info?.files?.length || 0} arquivos</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {info?.uploadedAt ? new Date(info.uploadedAt).toLocaleString("pt-BR") : "—"}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={remove} disabled={removing}>
              {removing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Remover
            </Button>
          </div>
        )}

        {info?.files && info.files.length > 0 && (
          <details className="rounded-lg border">
            <summary className="px-3 py-2 text-sm cursor-pointer select-none">Arquivos ({info.files.length})</summary>
            <div className="max-h-64 overflow-y-auto divide-y">
              {info.files.map((f) => (
                <div key={f.path} className="px-3 py-1.5 flex items-center justify-between text-xs">
                  <span className="font-mono truncate">{f.path}</span>
                  <span className="text-muted-foreground ml-3 shrink-0">{humanSize(f.size)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {hasSite && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Configuração</h3>
            <div className="flex items-center gap-2">
              <Switch id="site-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="site-enabled" className="text-sm">Usar esta página HTML</Label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Arquivo de entrada</Label>
              <Select value={entry || "__none"} onValueChange={(v) => setEntry(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="index.html" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— automático —</SelectItem>
                  {htmlFiles.map((f) => (
                    <SelectItem key={f.path} value={f.path}>{f.path}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Página aberta quando o visitante chega na sua página.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Destino após o cadastro</Label>
              <Select value={successType} onValueChange={(v) => setSuccessType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Área de membro interna</SelectItem>
                  <SelectItem value="url">Link externo (redirect)</SelectItem>
                  <SelectItem value="file">Página de "obrigado" do ZIP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {successType === "url" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label>Link de destino</Label>
                <Input
                  value={successUrl}
                  onChange={(e) => setSuccessUrl(e.target.value)}
                  placeholder="https://... ou /programa"
                />
                <p className="text-xs text-muted-foreground">Aceita http(s) ou caminhos internos começando com /.</p>
              </div>
            )}

            {successType === "file" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label>Página de "obrigado"</Label>
                <Select value={successFile || "__none"} onValueChange={(v) => setSuccessFile(v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="obrigado.html" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— selecione —</SelectItem>
                    {htmlFiles.map((f) => (
                      <SelectItem key={f.path} value={f.path}>{f.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2">
              <Label>Slug do evento (opcional)</Label>
              <Input
                value={eventSlug}
                onChange={(e) => setEventSlug(e.target.value)}
                placeholder="deixe vazio para desativar o botão de evento"
              />
              <p className="text-xs text-muted-foreground">Usado pelo botão <code>data-mf="event"</code> para inscribed o visitante no evento.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar configuração
            </Button>
            {info?.enabled && (
              <Badge variant="outline" className="text-primary border-primary/30">Ativa no site público</Badge>
            )}
          </div>
        </Card>
      )}

      {hasSite && previewSrc && (
        <Card className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2"><Eye className="h-4 w-4" />Preview</h3>
            <span className="text-xs text-muted-foreground">Token válido por 30 minutos</span>
          </div>
          <iframe
            title="Preview do site"
            src={previewSrc}
            /* Sem `allow-same-origin`: em produção a API é servida no mesmo
               origin do app (nginx), então sem sandbox o HTML do mentor
               conseguiria ler o localStorage com o token do mentor. */
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="w-full border rounded-lg"
            style={{ height: "70vh" }}
          />
        </Card>
      )}

      <Card className="p-6 space-y-3">
        <h3 className="font-bold">Como marcar os botões</h3>
        <p className="text-sm text-muted-foreground">
          No seu HTML, use o atributo <code>data-mf</code> para dizer o que cada botão faz.
          Campos de formulário usam <code>data-mf-field</code>.
        </p>
        <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto">
          <code>{SNIPPET}</code>
        </pre>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { navigator.clipboard.writeText(SNIPPET); toast.success("Exemplo copiado"); }}
        >
          <Copy className="h-4 w-4 mr-2" />Copiar exemplo
        </Button>
      </Card>
    </div>
  );
}
