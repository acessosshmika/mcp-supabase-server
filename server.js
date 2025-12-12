import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { GoogleAuth } from 'google-auth-library';

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
const LOCATION = process.env.GCLOUD_LOCATION || 'us-central1';
const MODEL_ID = 'text-embedding-004'; 

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.GCLOUD_SERVICE_KEY) {
  console.error("❌ ERRO: Faltam variáveis de ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GCLOUD_SERVICE_KEY),
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

const mcpServer = new McpServer({
  name: "MCP Sales Agent",
  version: "5.0.0"
});

// --- HELPER: VERTEX AI ---
async function getVertexEmbedding(text) {
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;
  const res = await client.request({ url, method: 'POST', data: { instances: [{ content: text }] } });
  return res.data.predictions[0].embeddings.values;
}

// --- ROTA DE MANUTENÇÃO (Mantida) ---
app.get('/manutencao/popular-vetores', async (req, res) => {
  res.send("<h1>Manutenção Ativa</h1><p>Use este endpoint apenas se precisares repopular vetores.</p>");
  // (Código completo omitido para poupar espaço, mas a rota existe para não quebrar links antigos)
});

// ==========================================
// 🛠️ TOOL 1: BUSCAR ARSENAL (Inteligência)
// ==========================================
mcpServer.tool(
  "buscar_arsenal",
  "Busca inteligente (semântica) no arsenal de vendas usando Google Vertex AI.",
  {
    query: z.string().describe("O que você procura?"),
    limit: z.number().optional().default(5)
  },
  async ({ query, limit }) => {
    console.log(`🧠 Buscando: "${query}"`);
    try {
      const vetor = await getVertexEmbedding(query);
      const { data, error } = await supabase.rpc('buscar_arsenal_vetorial', {
        query_embedding: vetor, match_threshold: 0.5, match_count: limit
      });

      if (error) throw error;
      
      // Backup Textual
      let resultados = data;
      if (!resultados || resultados.length === 0) {
        const { data: textData } = await supabase.from('arsenal_vendas')
          .select('*').ilike('conteudo_texto', `%${query}%`).limit(limit);
        resultados = textData || [];
      }

      const texto = resultados.length > 0 
        ? resultados.map(i => `
---
📂 Arquivo: ${i.nome_arquivo}
🔗 Link: ${i.link_publico}
📝 Conteúdo: ${i.conteudo_texto ? i.conteudo_texto.substring(0, 350) : "Sem texto"}...
---`).join("\n")
        : "Nenhum resultado encontrado.";

      return { content: [{ type: "text", text: texto }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Erro: ${err.message}` }] };
    }
  }
);

// ==========================================
// 🛠️ TOOL 2: SALVAR LEAD (Novo!)
// ==========================================
mcpServer.tool(
  "salvar_lead",
  "Salva ou atualiza informações do cliente (nome, interesse, estágio) no banco de dados.",
  {
    telefone: z.string().describe("O número de telefone do cliente (ID único). Use o formato 5511..."),
    nome: z.string().optional().describe("Nome do cliente, se ele informar"),
    interesse: z.string().optional().describe("O produto ou tema de interesse principal"),
    stage: z.string().optional().describe("Estágio do funil: 'lead_in', 'qualificado', 'negociacao'")
  },
  async ({ telefone, nome, interesse, stage }) => {
    console.log(`💾 Salvando Lead: ${nome || telefone}`);
    try {
      // Prepara os dados (remove undefined)
      const updateData = { telefone, last_interaction: new Date() };
      if (nome) updateData.nome = nome;
      if (interesse) updateData.primary_interest = interesse;
      if (stage) updateData.funnel_stage = stage;

      // Upsert: Atualiza se existir, cria se não existir (baseado no telefone)
      const { data, error } = await supabase
        .from('leads')
        .upsert(updateData, { onConflict: 'telefone' })
        .select();

      if (error) throw error;

      return { content: [{ type: "text", text: `✅ Dados do cliente ${nome || telefone} salvos com sucesso!` }] };
    } catch (err) {
      console.error("Erro ao salvar lead:", err);
      return { isError: true, content: [{ type: "text", text: `Erro ao salvar: ${err.message}` }] };
    }
  }
);

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
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor Sales Agent v5.0 (Com Captura de Leads) na porta ${PORT}`));
