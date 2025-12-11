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

const PORT = process.env.PORT || 80;

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

const server = new Server(
  { name: 'supabase-mcp-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// Lista de ferramentas
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

// Lógica da ferramenta
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "buscar_arsenal") {
    // Exemplo de resposta de teste
    return { content: [{ type: "text", text: "Teste de conexão bem sucedido!" }] };
  }
  throw new Error("Ferramenta não encontrada");
});

let transport;

// Endpoint SSE
app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida do n8n!");
  // ✅ Passa o res no construtor, o SDK cuida dos cabeçalhos e do stream
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

// Endpoint para mensagens
app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("❌ Nenhuma conexão SSE ativa");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor a correr na porta ${PORT}`);
});
