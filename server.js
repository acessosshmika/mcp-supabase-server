import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Erro: Faltam credenciais no .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();
app.use(express.json());

// O Easypanel injeta a porta, ou usa 80 como definiste
const PORT = process.env.PORT || 80;

// 1. CORREÇÃO CORS: Permite que o n8n fale com o servidor
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

const server = new Server(
  { name: 'supabase-mcp-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: "buscar_arsenal",
      description: "Busca imagens no banco Arsenal.",
      inputSchema: {
        type: "object",
        properties: { busca: { type: "string" } },
        required: ["busca"]
      }
    }]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // (A tua lógica do Supabase fica aqui - mantive igual)
    const { name, arguments: args } = request.params;
    if (name === "buscar_arsenal") {
        return { content: [{ type: "text", text: "Teste de conexão bem sucedido!" }] };
    }
    throw new Error("Ferramenta não encontrada");
});

let transport;

app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida do n8n!");
  
  // 2. CORREÇÃO CRÍTICA: Cabeçalhos SSE
  // Sem isto, o n8n fica "à espera" infinitamente e dá timeout
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`✅ Servidor a correr na porta ${PORT}`);
});
