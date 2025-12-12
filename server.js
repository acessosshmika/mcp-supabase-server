import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { GoogleAuth } from 'google-auth-library';

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// --- CONFIGURAÇÃO VERTEX AI ---
const PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
const LOCATION = process.env.GCLOUD_LOCATION || 'us-central1';
// O modelo 004 é mais recente e melhor, gera vetores de 768 dimensões
const MODEL_ID = 'text-embedding-004'; 

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.GCLOUD_SERVICE_KEY) {
  console.error("❌ ERRO: Faltam variáveis de ambiente (Supabase ou Google JSON).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuração da Autenticação Google
const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GCLOUD_SERVICE_KEY),
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

const mcpServer = new McpServer({
  name: "MCP Supabase Vertex AI",
  version: "4.0.0"
});

// Função auxiliar para chamar a API REST do Vertex AI
async function getVertexEmbedding(text) {
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;
  
  const data = {
    instances: [{ content: text }]
  };

  const res = await client.request({ url, method: 'POST', data });
  // O Vertex AI retorna: { predictions: [ { embeddings: { values: [...] } } ] }
  return res.data.predictions[0].embeddings.values;
}

// --- TOOL ---
mcpServer.tool(
  "buscar_arsenal",
  "Busca inteligente (semântica) no arsenal de vendas usando Google Vertex AI.",
  {
    query: z.string().describe("O que você procura?"),
    limit: z.number().optional().default(5)
  },
  async ({ query, limit }) => {
    console.log(`🧠 (Vertex AI) Gerando embedding para: "${query}"`);
    
    try {
      // 1. Gerar Embedding
      const vetor = await getVertexEmbedding(query);

      // 2. Consultar Supabase (RPC)
      // Nota: Certifica-te que a coluna no Supabase é vector(768)
      console.log("🔍 Consultando Supabase...");
      const { data, error } = await supabase.rpc('buscar_arsenal_vetorial', {
        query_embedding: vetor,
        match_threshold: 0.5,
        match_count: limit
      });

      if (error) throw error;
      
      // 3. Backup Textual
      let resultados = data;
      if (!resultados || resultados.length === 0) {
        console.log("⚠️ Busca vetorial vazia. Usando backup textual...");
        const { data: textData } = await supabase
          .from('arsenal_vendas')
          .select('*')
          .ilike('conteudo_texto', `%${query}%`)
          .limit(limit);
        resultados = textData || [];
      }

      // 4. Formatar
      const texto = resultados && resultados.length > 0 
        ? resultados.map(i => `
---
📂 Arquivo: ${i.nome_arquivo}
🔗 Link: ${i.link_publico}
🤖 IA: Vertex AI
📝 Conteúdo: ${i.conteudo_texto ? i.conteudo_texto.substring(0, 350) : "Sem texto"}...
---`).join("\n")
        : "Nenhum resultado encontrado.";

      return { content: [{ type: "text", text: texto }] };

    } catch (err) {
      console.error(`❌ Erro: ${err.message}`);
      return { isError: true, content: [{ type: "text", text: `Erro técnico: ${err.message}` }] };
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Vertex AI pronto na porta ${PORT}`);
});
