import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  
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

// SOLUÇÃO: Implementação manual do Streamable HTTP
// O SSE Transport foi deprecado, então implementamos manualmente
// Referência: https://modelcontextprotocol.io/docs/concepts/transports

// Armazenar sessões ativas
const sessions = new Map();

// Endpoint principal MCP (Streamable HTTP)
app.post('/sse', async (req, res) => {
  console.log("🔗 Requisição MCP recebida");
  console.log("Headers:", req.headers);
  console.log("Body:", JSON.stringify(req.body, null, 2));
  
  try {
    const sessionId = req.headers['mcp-session-id'] || `session_${Date.now()}`;
    
    // Verificar se é uma requisição JSON-RPC válida
    if (!req.body || !req.body.jsonrpc || !req.body.method) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request"
        },
        id: null
      });
    }
    
    const request = req.body;
    console.log(`📨 Método: ${request.method}, ID: ${request.id}`);
    
    // Processar a requisição através do servidor MCP
    let response;
    
    if (request.method === 'initialize') {
      // Responder com capacidades do servidor
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "supabase-mcp-server",
            version: "2.0.0"
          }
        }
      };
      sessions.set(sessionId, { initialized: true });
      res.setHeader('Mcp-Session-Id', sessionId);
      
    } else if (request.method === 'tools/list') {
      // Listar ferramentas
      const toolsResponse = await mcpServer.request(request, ListToolsRequestSchema);
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: toolsResponse
      };
      
    } else if (request.method === 'tools/call') {
      // Executar ferramenta
      const toolResponse = await mcpServer.request(request, CallToolRequestSchema);
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: toolResponse
      };
      
    } else {
      // Método não suportado
      response = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`
        }
      };
    }
    
    console.log("✅ Resposta:", JSON.stringify(response, null, 2));
    
    // Enviar resposta JSON
    res.setHeader('Content-Type', 'application/json');
    res.json(response);
    
  } catch (error) {
    console.error("❌ Erro ao processar requisição MCP:", error);
    console.error("Stack:", error.stack);
    
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: "Internal error",
        data: error.message
      }
    });
  }
});

// Endpoint compatível com n8n (fallback)
app.get('/sse', (req, res) => {
  console.log("ℹ️ Requisição GET recebida em /sse");
  res.json({
    mensagem: "Este é um servidor MCP via Streamable HTTP",
    instruções: "Use POST /sse com corpo JSON-RPC 2.0",
    exemplo: {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "n8n-client",
          version: "1.0.0"
        }
      },
      id: 1
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    servidor: 'MCP Supabase Server (Streamable HTTP)',
    versao: '2.0.0',
    sessoes_ativas: sessions.size,
    timestamp: new Date().toISOString(),
    supabase_url: supabaseUrl,
    transporte: 'Streamable HTTP (padrão moderno)'
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({
    mensagem: "Servidor MCP Supabase com Streamable HTTP",
    endpoints: {
      mcp: 'POST /sse - Endpoint principal MCP (JSON-RPC 2.0)',
      health: 'GET /health - Verifica status do servidor'
    },
    status: 'rodando',
    transporte: 'Streamable HTTP',
    nota: 'SSE Transport foi deprecado em favor do Streamable HTTP'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`✅ SERVIDOR MCP INICIADO COM SUCESSO`);
  console.log("=".repeat(60));
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`📍 Endpoint MCP: POST http://localhost:${PORT}/sse`);
  console.log(`📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`🗄️  Supabase URL: ${supabaseUrl}`);
  console.log(`🔄 Transporte: Streamable HTTP (moderno)`);
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
