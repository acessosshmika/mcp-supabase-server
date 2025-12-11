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

// Validar variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Erro: Faltam credenciais no .env");
  process.exit(1);
}

// Inicializar Supabase
const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Cliente Supabase inicializado");

// Configurar Express
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 80;

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Log de requisições
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// Criar servidor MCP
const mcpServer = new Server(
  { 
    name: 'supabase-mcp-server', 
    version: '2.0.0' 
  },
  { 
    capabilities: { 
      tools: {} 
    } 
  }
);

console.log("✅ Servidor MCP criado");

// Registrar handler para listar ferramentas
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log("📋 Listando ferramentas disponíveis");
  return {
    tools: [
      {
        name: "buscar_arsenal",
        description: "Busca imagens e dados na tabela Arsenal do Supabase",
        inputSchema: {
          type: "object",
          properties: { 
            busca: { 
              type: "string",
              description: "Termo de busca para encontrar registros"
            } 
          },
          required: ["busca"]
        }
      },
      {
        name: "listar_tabelas",
        description: "Lista informações sobre as tabelas do Supabase",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

// Registrar handler para executar ferramentas
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`🔧 Executando ferramenta: ${name}`, args);
  
  try {
    if (name === "buscar_arsenal") {
      const searchTerm = args.busca || "";
      
      const { data, error } = await supabase
        .from('arsenal')
        .select('*')
        .ilike('nome', `%${searchTerm}%`)
        .limit(10);
      
      if (error) {
        throw new Error(`Erro no Supabase: ${error.message}`);
      }
      
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            sucesso: true,
            total: data.length,
            resultados: data
          }, null, 2)
        }] 
      };
    }
    
    if (name === "listar_tabelas") {
      const { data, error } = await supabase
        .from('arsenal')
        .select('*')
        .limit(1);
      
      if (error) {
        throw new Error(`Erro ao acessar tabela: ${error.message}`);
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sucesso: true,
            mensagem: "Tabela 'arsenal' acessível",
            exemplo: data
          }, null, 2)
        }]
      };
    }
    
    throw new Error(`Ferramenta desconhecida: ${name}`);
    
  } catch (error) {
    console.error(`❌ Erro ao executar ${name}:`, error);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          sucesso: false,
          erro: error.message
        }, null, 2)
      }],
      isError: true
    };
  }
});

// Armazenar transporte ativo (apenas um por vez, conforme documentação oficial)
let activeTransport = null;

// Endpoint SSE - Seguindo a documentação oficial do MCP SDK
app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida!");
  
  try {
    // Criar transporte SSE passando apenas o endpoint e o response
    // Documentação: https://modelcontextprotocol.io/docs/concepts/transports
    activeTransport = new SSEServerTransport('/messages', res);
    
    console.log(`📦 Transporte SSE criado`);
    
    // Conectar servidor ao transporte
    // IMPORTANTE: connect() chama start() internamente
    await mcpServer.connect(activeTransport);
    
    console.log(`✅ Conexão SSE estabelecida com sucesso!`);
    
    // Limpar quando a conexão fechar
    res.on('close', () => {
      console.log(`🔌 Conexão SSE fechada`);
      activeTransport = null;
    });
    
    res.on('error', (error) => {
      console.error(`❌ Erro na conexão SSE:`, error);
      activeTransport = null;
    });
    
  } catch (error) {
    console.error("❌ Erro ao criar transporte SSE:", error);
    console.error("Stack trace:", error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Falha ao estabelecer conexão SSE",
        details: error.message,
        stack: error.stack
      });
    }
  }
});

// Endpoint para receber mensagens
// Bug conhecido do SDK: precisa passar req.body explicitamente
// Referência: https://github.com/modelcontextprotocol/typescript-sdk/issues/187
app.post('/messages', async (req, res) => {
  console.log("📨 Mensagem POST recebida");
  console.log("Body:", JSON.stringify(req.body, null, 2));
  
  try {
    if (!activeTransport) {
      console.warn("⚠️ Nenhuma conexão SSE ativa");
      return res.status(400).json({ 
        error: "Nenhuma conexão SSE ativa",
        hint: "Conecte-se primeiro via GET /sse"
      });
    }
    
    console.log(`✅ Processando mensagem com transporte ativo`);
    
    // CORREÇÃO CRÍTICA: Passar req.body como terceiro parâmetro
    // Isso contorna um bug conhecido no SDK
    await activeTransport.handlePostMessage(req, res, req.body);
    
  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
    console.error("Stack trace:", error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Erro ao processar mensagem",
        details: error.message,
        stack: error.stack
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    servidor: 'MCP Supabase Server',
    versao: '2.0.0',
    conexao_ativa: activeTransport !== null,
    timestamp: new Date().toISOString(),
    supabase_url: supabaseUrl
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({
    mensagem: "Servidor MCP Supabase",
    endpoints: {
      sse: '/sse (GET) - Estabelece conexão Server-Sent Events',
      messages: '/messages (POST) - Envia mensagens ao servidor MCP',
      health: '/health (GET) - Verifica status do servidor'
    },
    status: 'rodando',
    conexao_ativa: activeTransport !== null
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`✅ SERVIDOR MCP INICIADO COM SUCESSO`);
  console.log("=".repeat(60));
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`📍 Endpoint SSE: http://localhost:${PORT}/sse`);
  console.log(`📍 Endpoint Messages: http://localhost:${PORT}/messages`);
  console.log(`📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`🗄️  Supabase URL: ${supabaseUrl}`);
  console.log("=".repeat(60) + "\n");
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});
