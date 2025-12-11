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
  console.error("   SUPABASE_URL:", supabaseUrl ? "✓" : "✗");
  console.error("   SUPABASE_KEY:", supabaseKey ? "✓" : "✗");
  process.exit(1);
}

// Inicializar Supabase
const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Cliente Supabase inicializado");

// Configurar Express
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 80;

// CORS configurado para n8n
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
        description: "Lista todas as tabelas disponíveis no Supabase",
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
      
      // Buscar na tabela arsenal
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
      // Buscar informações do schema
      const { data, error } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');
      
      if (error) {
        throw new Error(`Erro ao listar tabelas: ${error.message}`);
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sucesso: true,
            tabelas: data
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

// Armazenar transportes ativos
const activeTransports = new Map();

// Endpoint SSE (Server-Sent Events)
app.get('/sse', async (req, res) => {
  console.log("🔗 Nova conexão SSE recebida!");
  
  try {
    // Criar novo transporte SSE
    const transport = new SSEServerTransport('/messages', res);
    
    // Conectar servidor MCP ao transporte
    await mcpServer.connect(transport);
    
    // Gerar ID único
    const connectionId = `conn_${Date.now()}`;
    activeTransports.set(connectionId, transport);
    
    console.log(`✅ Transporte SSE criado: ${connectionId}`);
    console.log(`📊 Conexões ativas: ${activeTransports.size}`);
    
    // Limpar quando a conexão fechar
    req.on('close', () => {
      console.log(`🔌 Conexão fechada: ${connectionId}`);
      activeTransports.delete(connectionId);
      console.log(`📊 Conexões restantes: ${activeTransports.size}`);
    });
    
    req.on('error', (error) => {
      console.error(`❌ Erro na conexão ${connectionId}:`, error);
      activeTransports.delete(connectionId);
    });
    
  } catch (error) {
    console.error("❌ Erro ao criar transporte SSE:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Falha ao estabelecer conexão SSE",
        details: error.message 
      });
    }
  }
});

// Endpoint para receber mensagens
app.post('/messages', async (req, res) => {
  console.log("📨 Mensagem POST recebida");
  console.log("Body:", JSON.stringify(req.body, null, 2));
  
  try {
    // Pegar primeiro transporte ativo
    const transports = Array.from(activeTransports.values());
    
    if (transports.length === 0) {
      console.warn("⚠️ Nenhuma conexão SSE ativa");
      return res.status(400).json({ 
        error: "Nenhuma conexão SSE ativa",
        hint: "Conecte-se primeiro via GET /sse"
      });
    }
    
    const transport = transports[0];
    console.log(`✅ Usando transporte ativo (${transports.length} disponível(is))`);
    
    // Processar mensagem através do transporte
    await transport.handlePostMessage(req, res);
    
  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Erro ao processar mensagem",
        details: error.message 
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
    conexoes_ativas: activeTransports.size,
    timestamp: new Date().toISOString(),
    supabase_url: supabaseUrl
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({
    mensagem: "Servidor MCP Supabase",
    endpoints: {
      sse: '/sse (GET)',
      messages: '/messages (POST)',
      health: '/health (GET)'
    }
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
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});
