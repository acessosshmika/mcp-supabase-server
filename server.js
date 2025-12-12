import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DO SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ ERRO FATAL: Variáveis SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- CRIAÇÃO DO SERVIDOR MCP ---
const mcpServer = new McpServer({
  name: "MCP Supabase Server",
  version: "2.1.0"
});

// --- DEFINIÇÃO DA FERRAMENTA (TOOL) ---
mcpServer.tool(
  "buscar_arsenal",
  "Busca materiais de vendas, argumentos e links de imagens na base de conhecimento.",
  {
    query: z.string().describe("Termo de busca (ex: 'ciclismo', 'argumentos de venda')"),
    limit: z.number().optional().default(5).describe("Máximo de resultados")
  },
  async ({ query, limit }) => {
    console.log(`🔍 Buscando por: "${query}"`);
    try {
      const { data, error } = await supabase
        .from('arsenal_vendas')
        .select('*')
        .or(`descricao_semantica.ilike.%${query}%,conteudo_texto.ilike.%${query}%,modelo_associado.ilike.%${query}%`)
        .limit(limit);

      if (error) throw error;
      
      // Formatação da resposta para o Agente (Incluindo o Link!)
      const texto = data && data.length > 0 
        ? data.map(i => `
---
📂 Arquivo: ${i.nome_arquivo}
🔗 Link Público: ${i.link_publico}
🤖 Modelo: ${i.modelo_associado || "Geral"}
📝 Conteúdo: ${i.conteudo_texto ? i.conteudo_texto.substring(0, 400) : "Sem texto extraído"}...
---`).join("\n")
        : "Nenhum resultado encontrado para esta busca.";

      return { content: [{ type: "text", text: texto }] };

    } catch (err) {
      console.error(`❌ Erro na busca: ${err.message}`);
      return { isError: true, content: [{ type: "text", text: `Erro ao consultar banco de dados: ${err.message}` }] };
    }
  }
);

// --- CONFIGURAÇÃO DO SERVIDOR HTTP & SSE ---
app.use(cors());

// Variável para manter a sessão de transporte ativa
let transport;

app.get('/sse', async (req, res) => {
  console.log("🔌 Conexão SSE iniciada pelo n8n");
  
  // CORREÇÃO CRÍTICA PARA EASYPANEL/NGINX:
  // Impede que o proxy segure a resposta, permitindo streaming em tempo real
  res.setHeader('X-Accel-Buffering', 'no'); 
  
  transport = new SSEServerTransport("/message", res);
  await mcpServer.connect(transport);
});

app.post('/message', async (req, res) => {
  if (!transport) {
    console.error("❌ Erro: Tentativa de mensagem sem conexão SSE ativa.");
    res.status(500).send("No active transport");
    return;
  }
  // O SDK processa a mensagem e responde via SSE
  await transport.handlePostMessage(req, res);
});

// Rota de verificação simples
app.get('/', (req, res) => {
  res.status(200).send("Servidor MCP Supabase Online 🚀. Conecte via /sse");
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
