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
const MODEL_ID = 'text-embedding-004'; 

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.GCLOUD_SERVICE_KEY) {
  console.error("❌ ERRO: Faltam variáveis de ambiente (Supabase ou Google JSON).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Autenticação Google
const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GCLOUD_SERVICE_KEY),
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

const mcpServer = new McpServer({
  name: "MCP Supabase Vertex AI",
  version: "4.1.0"
});

// Função auxiliar para Vertex AI
async function getVertexEmbedding(text) {
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;
  
  const data = { instances: [{ content: text }] };
  const res = await client.request({ url, method: 'POST', data });
  return res.data.predictions[0].embeddings.values;
}

// --- ROTA DE MANUTENÇÃO (PARA RODAR NA VPS) ---
// Acessa isto pelo navegador para forçar a criação dos vetores
app.get('/manutencao/popular-vetores', async (req, res) => {
  res.write(`
    <html>
      <body style="background:#1e1e1e; color:#00ff00; font-family:monospace; padding:20px;">
      <h1>🛠️ Iniciando Manutenção de Vetores...</h1>
      <p>Verifique os logs do Easypanel para acompanhar o progresso detalhado.</p>
      <pre>
  `);

  try {
    // 1. Buscar itens SEM embedding
    const { data: itens, error } = await supabase
      .from('arsenal_vendas')
      .select('id, conteudo_texto, nome_arquivo')
      .is('embedding', null);

    if (error) throw error;

    if (!itens || itens.length === 0) {
      res.write(`✅ Nenhum item pendente. Tudo atualizado!\n`);
      res.end('</pre></body></html>');
      return;
    }

    res.write(`📦 Encontrados ${itens.length} itens pendentes. Processando em background...\n`);

    // Processamento Assíncrono (para não travar o navegador)
    (async () => {
      console.log("🔄 INICIANDO POPULAÇÃO DE VETORES...");
      for (const [index, item] of itens.entries()) {
        if (!item.conteudo_texto) continue;
        
        try {
          console.log(`Processing [${index+1}/${itens.length}]: ${item.nome_arquivo}`);
          const vetor = await getVertexEmbedding(item.conteudo_texto);
          
          await supabase
            .from('arsenal_vendas')
            .update({ embedding: vetor })
            .eq('id', item.id);
            
        } catch (err) {
          console.error(`❌ Erro no item ${item.id}:`, err.message);
        }
        // Pequena pausa para respeitar limites da API
        await new Promise(r => setTimeout(r, 200));
      }
      console.log("🏁 POPULAÇÃO CONCLUÍDA!");
    })();

  } catch (err) {
    res.write(`❌ Erro Critico: ${err.message}\n`);
    console.error(err);
  }

  res.write(`🚀 O processo continua rodando no servidor. Pode fechar esta janela.\n`);
  res.end('</pre></body></html>');
});

// --- TOOL MCP ---
mcpServer.tool(
  "buscar_arsenal",
  "Busca inteligente (semântica) no arsenal de vendas usando Google Vertex AI.",
  {
    query: z.string().describe("O que você procura?"),
    limit: z.number().optional().default(5)
  },
  async ({ query, limit }) => {
    console.log(`🧠 (Vertex AI) Buscando: "${query}"`);
    try {
      const vetor = await getVertexEmbedding(query);
      const { data, error } = await supabase.rpc('buscar_arsenal_vetorial', {
        query_embedding: vetor,
        match_threshold: 0.5,
        match_count: limit
      });

      if (error) throw error;
      
      let resultados = data;
      if (!resultados || resultados.length === 0) {
        console.log("⚠️ Vetorial vazio. Usando backup textual.");
        const { data: textData } = await supabase
          .from('arsenal_vendas')
          .select('*')
          .ilike('conteudo_texto', `%${query}%`)
          .limit(limit);
        resultados = textData || [];
      }

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
      return { isError: true, content: [{ type: "text", text: `Erro: ${err.message}` }] };
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
