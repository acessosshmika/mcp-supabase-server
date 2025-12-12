import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ ERRO FATAL: Variáveis SUPABASE ausentes.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const mcpServer = new McpServer({
  name: "MCP Supabase Server",
  version: "2.0.0"
});

// --- DEFINIÇÃO DA TOOL ---
mcpServer.tool(
  "buscar_arsenal",
  "Busca informações de vendas na base de dados.",
  {
    query: z.string(),
    limit: z.number().optional().default(5)
  },
  async ({ query, limit }) => {
    console.log(`🔍 Buscando: ${query}`);
    try {
      const { data, error } = await supabase
        .from('arsenal_vendas')
        .select('*')
        .or(`descricao_semantica.ilike.%${query}%,conteudo_texto.ilike.%${query}%,modelo_associado.ilike.%${query}%`)
        .limit(limit);

      if (error) throw error;
      
      const texto = data && data.length > 0 
        ? data.map(i => `Item: ${i.nome_arquivo}\nConteúdo: ${i.conteudo_texto?.substring(0, 200)}...`).join("\n---\n")
        : "Nenhum resultado encontrado.";

      return { content: [{ type: "text", text: texto }] };
    } catch (err) {
      console.error(`❌ Erro na busca: ${err.message}`);
      return { isError: true, content: [{ type: "text", text: `Erro: ${err.message}` }] };
    }
  }
);

// --- CONFIGURAÇÃO DO TRANSPORTE SSE ---
app.use(cors());

// Variável global para manter o transporte ativo
let transport;

app.get('/sse', async (req, res) => {
  console.log("🔌 N8N Bateu à porta (/sse)!");
  
  // --- CORREÇÃO PARA EASYPANEL / NGINX ---
  // Isto força o proxy a não segurar a resposta
  res.setHeader('X-Accel-Buffering', 'no'); 
  
  transport = new SSEServerTransport("/message", res);
  await mcpServer.connect(transport);
  
  console.log("✅ Conexão SSE iniciada com sucesso!");
});

app.post('/message', async (req, res) => {
  console.log("📨 Mensagem recebida (/message)");
  
  if (!transport) {
    console.error("❌ Erro: Transporte não inicializado. O n8n precisa conectar em /sse primeiro.");
    res.status(500).send("No active transport");
    return;
  }

  await transport.handlePostMessage(req, res);
});

// Rota de saúde simples para verificares no navegador
app.get('/', (req, res) => {
  res.status(200).send("Servidor Online. Use /sse no n8n.");
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor pronto na porta ${PORT}`);
});
