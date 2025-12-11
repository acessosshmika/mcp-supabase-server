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

// Armazenar handlers manualmente para acesso direto
const handlers = {
  listTools: null,
  callTool: null
};

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

// Armazenar referência ao handler
handlers.listTools = async () => {
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
};

// Registrar handler para executar ferramentas (Implementação Padrão MCP SDK)
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`🔧 Executando ferramenta (SDK): ${name}`, args);
  
  // Reutiliza a lógica centralizada para garantir consistência
  const toolResult = await handlers.callTool(name, args);
  
  // Se retornou erro flagado, lança exceção para o SDK capturar se necessário,
  // ou retorna o conteúdo de erro formatado
  if (toolResult.isError) {
      // O SDK espera uma resposta com content, mesmo em erro, ou um throw.
      // Aqui mantemos o retorno estruturado.
      return { content: toolResult.content, isError: true };
  }
  
  return { content: toolResult.content };
});

// Lógica centralizada das ferramentas (CORRIGIDA)
handlers.callTool = async (name, args) => {
  console.log(`🔧 Executando ferramenta (Lógica Central): ${name}`, args);
  
  try {
    if (name === "buscar_arsenal") {
      const searchTerm = args?.busca || "";
      
      // CORREÇÃO: Tabela alterada de 'arsenal' para 'arsenal_vendas'
      const { data, error } = await supabase
        .from('arsenal_vendas') 
        .select('*')
        .ilike('nome_arquivo', `%${searchTerm}%`) // Ajustei para buscar pelo nome do arquivo ou outro campo texto relevante
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
      // CORREÇÃO: Tabela alterada de 'arsenal' para 'arsenal_vendas'
      const { data, error } = await supabase
        .from('arsenal_vendas')
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
            mensagem: "Tabela 'arsenal_vendas' acessível",
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
};

// SOLUÇÃO: Implementação manual do Streamable HTTP
// Armazenar sessões ativas
const sessions = new Map();

// Endpoint principal MCP (Streamable HTTP)
app.post('/sse', async (req, res) => {
  console.log("🔗 Requisição MCP recebida");
  
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
    
    let response;
    
    if (request.method === 'initialize') {
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
      
    } else if (request.method === 'notifications/initialized') {
      response = null;
      
    } else if (request.method === 'tools/list') {
      const toolsResult = await handlers.listTools();
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: toolsResult
      };
      
    } else if (request.method === 'tools/call') {
      const toolName = request.params?.name;
      const toolArgs = request.params?.arguments || {};
      
      const toolResult = await handlers.callTool(toolName, toolArgs);
      
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: toolResult
      };
      
    } else if (request.method === 'ping') {
      response = {
        jsonrpc: "2.0",
        id: request.id,
        result: {}
      };
      
    } else {
      response = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`
        }
      };
    }
    
    if (response === null) {
      return res.status(204).send();
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.json(response);
    
  } catch (error) {
    console.error("❌ Erro ao processar requisição MCP:", error);
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
  res.json({
    mensagem: "Este é um servidor MCP via Streamable HTTP",
    instruções: "Use POST /sse com corpo JSON-RPC 2.0"
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    servidor: 'MCP Supabase Server (Streamable HTTP)',
    versao: '2.0.0',
    tabela_alvo: 'arsenal_vendas',
    sessoes_ativas: sessions.size
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({
    mensagem: "Servidor MCP Supabase com Streamable HTTP",
    status: 'rodando'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`✅ SERVIDOR MCP INICIADO COM SUCESSO`);
  console.log("=".repeat(60));
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`📍 Endpoint MCP: POST http://localhost:${PORT}/sse`);
  console.log(`🗄️  Supabase Tabela: arsenal_vendas`);
  console.log("=".repeat(60) + "\n");
});
