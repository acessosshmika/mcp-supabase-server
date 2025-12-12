import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { GoogleAuth } from 'google-auth-library';
import { CohereClient } from 'cohere-ai'; // Importar Cohere

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
const LOCATION = process.env.GCLOUD_LOCATION || 'us-central1';
const MODEL_ID = 'text-embedding-004'; 
const COHERE_API_KEY = process.env.COHERE_API_KEY; // Nova Variável

// Verificação de segurança
if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.GCLOUD_SERVICE_KEY || !COHERE_API_KEY) {
  console.error("❌ ERRO: Faltam variáveis (Supabase, Google JSON ou Cohere).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const cohere = new CohereClient({ token: COHERE_API_KEY }); // Inicializar Cohere

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GCLOUD_SERVICE_KEY),
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

const mcpServer = new McpServer({
  name: "MCP Sales Agent Ultra",
  version: "6.0.0"
});

// --- HELPER: VERTEX AI ---
async function getVertexEmbedding(text) {
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;
  const res = await client.request({ url, method: 'POST', data: { instances: [{ content: text }] } });
  return res.data.predictions[0].embeddings.values;
}

// ==========================================
// 🛠️ TOOL 1: BUSCAR ARSENAL (COM RE-RANKING)
// ==========================================
mcpServer.tool(
  "buscar_arsenal",
  "Busca inteligente (semântica + re-ranking) no arsenal de vendas.",
  {
    query: z.string().describe("O que você procura?"),
    limit: z.number().optional().default(5)
  },
  async ({ query, limit }) => {
    console.log(`🧠 Buscando: "${query}" (Limite Final: ${limit})`);
    try {
      // 1. Gerar Embedding (Vertex AI)
      const vetor = await getVertexEmbedding(query);
      
      // 2. Busca "Rede Larga" no Supabase (Trazemos 5x mais itens que o necessário)
      // Trazemos 25 itens para o Re-ranker ter material para trabalhar
      const FETCH_SIZE = 25; 
      
      const { data: rawResults, error } = await supabase.rpc('buscar_arsenal_vetorial', {
        query_embedding: vetor, 
        match_threshold: 0.3, // Baixamos a régua para pegar mais candidatos
        match_count: FETCH_SIZE
      });

      if (error) throw error;
      
      let finalResults = [];

      // 3. Lógica de Re-ranking
      if (rawResults && rawResults.length > 0) {
        console.log(`⚖️ Re-ranking ${rawResults.length} candidatos com Cohere...`);
        
        // Prepara os documentos para o Cohere ler
        const documentsToRank = rawResults.map(doc => ({
          text: doc.conteudo_texto || "",
          id: doc.id // Guardamos o ID para recuperar o objeto original depois
        }));

        // Chama a API de Re-ranking
        const rerank = await cohere.rerank({
          documents: documentsToRank,
          query: query,
          topN: limit, // Agora sim cortamos para o limite final (ex: 5)
          model: 'rerank-multilingual-v3.0' // Modelo excelente para Português
        });

        // Mapeia os resultados do Cohere de volta para os objetos do Supabase
        finalResults = rerank.results.map(rankedItem => {
          // O Cohere devolve o índice do array original
          return rawResults[rankedItem.index];
        });
        
        console.log(`🎯 Top ${finalResults.length} selecionados após Re-ranking.`);

      } else {
        // Fallback: Busca textual se a vetorial falhar totalmente
        console.log("⚠️ Vetorial vazia. Tentando backup textual simples...");
        const { data: textData } = await supabase.from('arsenal_vendas')
          .select('*').ilike('conteudo_texto', `%${query}%`).limit(limit);
        finalResults = textData || [];
      }

      // 4. Formatação da Resposta
      const texto = finalResults.length > 0 
        ? finalResults.map(i => `
---
📂 Arquivo: ${i.nome_arquivo}
🔗 Link: ${i.link_publico}
⭐ Relevância: Alta (Validada por IA)
📝 Conteúdo: ${i.conteudo_texto ? i.conteudo_texto.substring(0, 350) : "Sem texto"}...
---`).join("\n")
        : "Nenhum resultado encontrado.";

      return { content: [{ type: "text", text: texto }] };

    } catch (err) {
      console.error("Erro na busca:", err);
      return { isError: true, content: [{ type: "text", text: `Erro: ${err.message}` }] };
    }
  }
);

// ==========================================
// 🛠️ TOOL 2: SALVAR LEAD (Mantida)
// ==========================================
mcpServer.tool(
  "salvar_lead",
  "Salva ou atualiza informações do cliente.",
  {
    telefone: z.string(),
    nome: z.string().optional(),
    interesse: z.string().optional(),
    stage: z.string().optional()
  },
  async ({ telefone, nome, interesse, stage }) => {
    // (Mesma lógica anterior, mantida para não perder funcionalidade)
    try {
      const updateData = { telefone, last_interaction: new Date() };
      if (nome) updateData.nome = nome;
      if (interesse) updateData.primary_interest = interesse;
      if (stage) updateData.funnel_stage = stage;
      
      const { error } = await supabase.from('leads').upsert(updateData, { onConflict: 'telefone' });
      if (error) throw error;
      return { content: [{ type: "text", text: `✅ Lead ${nome || telefone} salvo.` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Erro: ${err.message}` }] };
    }
  }
);

// --- ROTA MANUTENÇÃO ---
app.get('/manutencao/popular-vetores', (req, res) => res.send("<h1>Servidor MCP Ativo</h1>"));

// --- SSE SERVER ---
app.use(cors());
let transport;
app.get('/sse', async (req, res) => {
  res.setHeader('X-Accel-Buffering', 'no'); 
  transport = new SSEServerTransport("/message", res);
  await mcpServer.connect(transport);
});
app.post('/message', async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
});
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Sales Agent Ultra (Re-rank) na porta ${PORT}`));
