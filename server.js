import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// 1. Configurações
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Erro: Faltam credenciais no .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Criar a Aplicação Web (Express)
const app = express();
const PORT = process.env.PORT || 3000;

// Configurar servidor MCP
const server = new Server(
  { name: 'supabase-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 3. Ferramentas (O Menu)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ler_tabela",
        description: "Lê dados da tabela.",
        inputSchema: {
          type: "object",
          properties: {
            tabela: { type: "string" },
            colunas: { type: "string" },
            limite: { type: "number" }
          },
          required: ["tabela"],
        },
      },
      {
        name: "modificar_dados",
        description: "CRUD: insert, update, delete.",
        inputSchema: {
          type: "object",
          properties: {
            acao: { type: "string", enum: ["insert", "update", "delete"] },
            tabela: { type: "string" },
            dados: { type: "object" },
            id_alvo: { type: "string" }
          },
          required: ["acao", "tabela"],
        },
      },
      {
        name: "gerar_link_download",
        description: "Link temporário do Storage.",
        inputSchema: {
          type: "object",
          properties: {
            bucket: { type: "string" },
            caminho: { type: "string" },
          },
          required: ["bucket", "caminho"],
        },
      },
    ],
  };
});

// 4. Lógica das Ferramentas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`🔨 A usar ferramenta: ${name}`);

  try {
    if (name === "ler_tabela") {
      const { data, error } = await supabase
        .from(args.tabela)
        .select(args.colunas || "*")
        .limit(args.limite || 10);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    if (name === "modificar_dados") {
      let result;
      if (args.acao === "insert") result = await supabase.from(args.tabela).insert(args.dados).select();
      else if (args.acao === "update") result = await supabase.from(args.tabela).update(args.dados).eq('id', args.id_alvo).select();
      else if (args.acao === "delete") result = await supabase.from(args.tabela).delete().eq('id', args.id_alvo).select();
      
      if (result.error) throw result.error;
      return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
    }

    if (name === "gerar_link_download") {
      const { data, error } = await supabase.storage.from(args.bucket).createSignedUrl(args.caminho, 3600);
      if (error) throw error;
      return { content: [{ type: "text", text: `Link: ${data.signedUrl}` }] };
    }

    throw new Error("Ferramenta desconhecida");
  } catch (error) {
    return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
  }
});

// 5. Ligar o Servidor Web (SSE)
let transport;

// Rota para iniciar a conexão SSE (o cliente chama isto)
app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida!");
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

// Rota para o cliente enviar mensagens para cá
app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Sessão não iniciada");
  }
});

// Rota de SAÚDE (Isto é o que deixa a luz VERDE 🟢)
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`✅ Servidor Web MCP a correr na porta ${PORT}`);
});
