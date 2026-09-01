import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ExternalLink, Copy, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type SalesPage = {
  id: string;
  slug: string;
  title: string;
  headline?: string;
  priceCents: number;
  published: boolean;
  updatedAt: string;
};

const AI_BUSINESS_TEMPLATE = {
  title: "IA na Prática para Empresários", productType: "event", template: "long_form",
  headline: "Sua empresa pode produzir mais. Sem precisar aumentar sua equipe.",
  subheadline: "Descubra como a Inteligência Artificial pode aumentar a capacidade dos seus colaboradores, reduzir horas de tarefas operacionais e transformar a produtividade da sua empresa.",
  description: "Uma imersão prática para empresários, CEOs e gestores que querem entender como usar IA na própria rotina e identificar onde ela pode gerar resultados reais em suas equipes.",
  priceCents: 19700, currency: "BRL", maxInstallments: 1,
  ctaText: "Quero garantir minha vaga", guaranteeText: "Traga seu notebook. Será mão na massa.",
  badges: ["Imersão presencial", "Mão na massa", "Vagas limitadas"],
  eventInfo: { date: "[ DATA ]", time: "[ HORÁRIO ]", location: "[ LOCAL ]", extra: "Traga seu notebook" },
  sections: [
    { eyebrow: "O custo invisível", title: "Quanto custa uma hora improdutiva dentro da sua empresa?", body: "Agora multiplique isso por 10, 50 ou 100 colaboradores.\n\nTodos os dias, sua equipe gasta tempo em atividades que a Inteligência Artificial já consegue reduzir de horas para minutos.", items: ["Criando documentos do zero", "Analisando planilhas manualmente", "Montando relatórios", "Pesquisando informações", "Preparando apresentações", "Participando de reuniões que não viram ação", "Executando tarefas repetitivas"].map((text) => ({ text })), quote: "Talvez sua empresa não precise apenas de mais pessoas. Talvez precise aumentar a capacidade das pessoas que já tem.", ctaText: "Quero descobrir como — R$ 197", variant: "muted" },
    { eyebrow: "Primeiro, entenda o que é possível", title: "Antes de levar IA para sua equipe, você precisa entender o que ela é capaz de fazer.", body: "Durante a imersão, você vai experimentar diferentes ferramentas de Inteligência Artificial e aplicá-las a situações reais do dia a dia empresarial.", items: [
      { title: "Analisar", text: "Dados, planilhas, relatórios e indicadores." }, { title: "Decidir", text: "Comparar cenários, questionar informações e identificar riscos." }, { title: "Gerenciar", text: "Preparar reuniões, analisar entregas e transformar discussões em planos de ação." }, { title: "Pesquisar", text: "Mercado, concorrência, tendências e oportunidades." }, { title: "Produzir", text: "Documentos, apresentações, análises e materiais em muito menos tempo." }, { title: "Automatizar", text: "Identificar atividades repetitivas que podem deixar de depender de trabalho manual." },
    ], quote: "Não é sobre aprender uma única ferramenta de IA. É entender qual utilizar para cada desafio.", variant: "default" },
    { eyebrow: "Agora multiplique isso pela sua empresa", title: "E se sua equipe também soubesse trabalhar dessa forma?", items: [
      { title: "Comercial", text: "Mais tempo vendendo e menos tempo preparando informações, pesquisas e propostas." }, { title: "Financeiro", text: "Menos trabalho operacional para consolidar e analisar dados." }, { title: "RH", text: "Mais agilidade em processos, documentos e comunicação." }, { title: "Marketing", text: "Mais capacidade de pesquisa, planejamento e produção." }, { title: "Gestores", text: "Relatórios analisados, reuniões mais objetivas e planos de ação claros." }, { title: "Operações", text: "Menos tarefas repetitivas e mais processos inteligentes." },
    ], quote: "Não é fazer seus colaboradores trabalharem mais. É fazer cada hora de trabalho produzir mais resultado.", variant: "highlight" },
    { eyebrow: "O próximo passo", title: "Antes de contratar mais pessoas, descubra o que sua equipe atual pode fazer com IA.", body: "Você vai experimentar. Vai aplicar. Vai olhar para sua empresa.\n\nE vai sair sabendo onde a IA pode começar a gerar resultado.", ctaText: "Garantir minha vaga", variant: "default" },
  ],
  forWho: ["Lidera uma empresa e uma equipe.", "Quer aumentar produtividade sem simplesmente aumentar estrutura.", "Percebe que seus colaboradores gastam horas em atividades que poderiam ser aceleradas.", "Já viu pessoas usando IA, mas não sabe como transformar isso em produtividade real para a empresa.", "Quer preparar seus gestores e equipes para essa nova forma de trabalhar.", "Quer descobrir onde começar sem transformar a empresa em um laboratório de ferramentas."],
  urgencyText: "Vagas limitadas.", features: [], faqs: [],
  seo: { title: "IA na Prática para Empresários", description: "Imersão prática para aumentar a produtividade da sua empresa com Inteligência Artificial." },
};

export default function SalesPagesListPage() {
  const [items, setItems] = useState<SalesPage[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    try {
      setLoading(true);
      const data = await api<SalesPage[]>("/sales-pages");
      setItems(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createEmpty = async () => {
    try {
      const p = await api<SalesPage>("/sales-pages", {
        method: "POST",
        body: { title: "Nova página de vendas" },
      });
      navigate(`/app/sales-pages/${p.id}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const createFromTemplate = async () => {
    try {
      const p = await api<SalesPage>("/sales-pages", { method: "POST", body: AI_BUSINESS_TEMPLATE });
      toast.success("Modelo criado. Personalize os dados e publique quando estiver pronto.");
      navigate(`/app/sales-pages/${p.id}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta página?")) return;
    try {
      await api(`/sales-pages/${id}`, { method: "DELETE" });
      toast.success("Página excluída");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const copyUrl = (slug: string) => {
    const url = `${window.location.origin}/p/${user?.slug || "seu-slug"}/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold font-display flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Páginas de Venda
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Uma página, um produto. IA escreve a copy, você publica com checkout Asaas em minutos.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={createFromTemplate}><Sparkles className="h-4 w-4 mr-2" /> Usar modelo IA para Empresários</Button>
          <Button onClick={createEmpty} className="bg-gradient-primary shadow-glow"><Plus className="h-4 w-4 mr-2" /> Nova página</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando…</div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center">
          <Sparkles className="h-10 w-10 mx-auto text-primary/50 mb-3" />
          <h2 className="font-bold text-lg mb-1">Sua primeira página de vendas</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Descreva seu produto em 1 frase e a IA gera hero, benefícios, FAQ e CTA. Depois é só configurar o preço e publicar.
          </p>
          <Button onClick={createEmpty} className="bg-gradient-primary shadow-glow">
            <Plus className="h-4 w-4 mr-2" /> Criar minha primeira página
          </Button>
          <Button variant="outline" onClick={createFromTemplate} className="ml-2">
            <Sparkles className="h-4 w-4 mr-2" /> Começar pelo modelo pronto
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((p) => (
            <Card key={p.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/app/sales-pages/${p.id}`} className="font-bold hover:text-primary">
                    {p.title}
                  </Link>
                  {p.published ? (
                    <Badge className="bg-primary/15 text-primary border-primary/20">Publicada</Badge>
                  ) : (
                    <Badge variant="outline">Rascunho</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  /p/{user?.slug || "seu-slug"}/{p.slug} · R$ {(p.priceCents / 100).toFixed(2)}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => copyUrl(p.slug)}>
                  <Copy className="h-4 w-4" />
                </Button>
                {p.published && (
                  <a href={`/p/${user?.slug}/${p.slug}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                  </a>
                )}
                <Link to={`/app/sales-pages/${p.id}`}>
                  <Button size="sm">Editar</Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
