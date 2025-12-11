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
  { name: 'supabase-mcp-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// 3. Ferramentas (O Menu)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "buscar_arsenal",
        description: "Busca imagens de produtos e provas sociais no banco de dados Arsenal. Use para encontrar fotos baseadas em contexto (ex: 'relógio para ciclismo', 'uso executivo', 'segurança').",
        inputSchema: {
          type: "object",
          properties: {
            busca: { type: "string", description: "Termo de busca (ex: 'ciclismo', 'T20', 'segurança')" },
            categoria: { type: "string", description: "Filtro opcional de categoria (ex: 'ETAPA_3_SOLUCAO')" }
          },
          required: ["busca"],
        },
      },
      // Mantivemos estas ferramentas úteis caso precises
      {
        name: "ler_tabela",
        description: "Lê dados brutos de qualquer tabela.",
        inputSchema: {
          type: "object",
          properties: {
            tabela: { type: "string" },
            limite: { type: "number" }
          },
          required: ["tabela"],
        },
      }
    ],
  };
});

// 4. Lógica das Ferramentas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`🔨 A usar ferramenta: ${name}`);

  try {
    // --- NOVA LÓGICA: BUSCA INTELIGENTE NO ARSENAL ---
    if (name === "buscar_arsenal") {
      const termo = args.busca;
      
      // Iniciamos a query na tabela 'arsenal'
      // IMPORTANTE: Não trazemos o 'embedding' para não pesar na resposta
      let query = supabase
        .from('arsenal')
        .select('link_publico, descricao_semantica, modelo_associado, emocao_predominante, detalhes_visuais')
        .limit(5); // Trazemos apenas as 5 melhores para não confundir o agente

      // Se houver termo de busca, procuramos em várias colunas de texto (ILIKE é case-insensitive)
      if (termo) {
        // A sintaxe .or() permite procurar "termo" NA descrição OU no modelo OU na emoção
        const filtro = `descricao_semantica.ilike.%${termo}%,modelo_associado.ilike.%${termo}%,emocao_predominante.ilike.%${termo}%,detalhes_visuais.ilike.%${termo}%`;
        query = query.or(filtro);
      }

      if (args.categoria) {
        query = query.eq('categoria', args.categoria);
      }

      const { data, error } = await query;

      if (error) throw error;
      if (!data || data.length === 0) {
        return { content: [{ type: "text", text: "Não encontrei imagens no arsenal com esses termos." }] };
      }

      // Formatamos a resposta para o Agente entender bem o que encontrou
      const resultadoFormatado = data.map(item => {
        return `📸 Imagem (${item.modelo_associado}):
Contexto: ${item.descricao_semantica}
Emoção: ${item.emocao_predominante}
Link: ${item.link_publico}
---`;
      }).join("\n");

      return { content: [{ type: "text", text: resultadoFormatado }] };
    }
    // --------------------------------------------------

    if (name === "ler_tabela") {
      const { data, error } = await supabase
        .from(args.tabela)
        .select("*")
        .limit(args.limite || 5);
      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    throw new Error("Ferramenta desconhecida");
  } catch (error) {
    console.error(error);
    return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
  }
});

// 5. Ligar o Servidor Web (SSE)
let transport;

app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida!");
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Sessão não iniciada");
  }
});

app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`✅ Servidor Arsenal MCP a correr na porta ${PORT}`);
});
