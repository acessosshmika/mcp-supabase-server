// src/index.ts - MCP Server HTTP para N8N
// Este servidor usa HTTP direto ao invés de SSE/Stdio

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const VERTEX_PROJECT = process.env.VERTEX_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Mcp-Session-Id']
}));
app.use(express.json());

// Cliente Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// LOGS
// ==========================================
function log(mensagem: string, dados?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${mensagem}`, dados ? JSON.stringify(dados, null, 2) : '');
}

// ==========================================
// GERAR EMBEDDING
// ==========================================
async function gerarEmbedding(texto: string): Promise<number[]> {
  log('Gerando embedding', { texto_length: texto.length });

  if (!VERTEX_PROJECT) {
    throw new Error('VERTEX_PROJECT não configurado');
  }

  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/text-embedding-004:predict`;

  // Obter token (você deve implementar isso corretamente)
  const token = await getVertexToken();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{ content: texto }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Erro no Vertex AI', { status: response.status, error: errorText });
    throw new Error(`Vertex AI falhou: ${response.status}`);
  }

  const result = await response.json();
  const embedding = result.predictions[0].embeddings.values;
  
  log('Embedding gerado', { dimensoes: embedding.length });
  return embedding;
}

async function getVertexToken(): Promise<string> {
  // Opção 1: Usar variável de ambiente
  if (process.env.VERTEX_TOKEN) {
    return process.env.VERTEX_TOKEN;
  }

  // Opção 2: Usar gcloud CLI
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec('gcloud auth print-access-token', (error: any, stdout: string) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

// ==========================================
// ENDPOINT: GET / (Info)
// ==========================================
app.get('/', (req: Request, res: Response) => {
  res.json({
    nome: 'MCP Supabase Server HTTP',
    versao: '2.0.0',
    status: 'online',
    endpoints: {
      '/tools': 'Lista de ferramentas disponíveis (GET)',
      '/buscar_arsenal': 'Busca semântica no arsenal (POST)',
      '/buscar_lead': 'Busca lead por telefone (POST)',
      '/atualizar_lead': 'Atualiza dados do lead (POST)'
    }
  });
});

// ==========================================
// ENDPOINT: GET /tools (Lista de Tools)
// ==========================================
app.get('/tools', (req: Request, res: Response) => {
  log('Listando tools');
  
  res.json({
    tools: [
      {
        name: 'buscar_arsenal',
        description: 'Busca SEMÂNTICA no arsenal de vendas (imagens, provas sociais, especificações). Use quando cliente perguntar sobre produtos, pedir imagens, ou você precisar de argumentos de venda.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Termo de busca. Seja específico: "prova social resistência água" ao invés de só "resistente"'
            },
            limit: {
              type: 'number',
              description: 'Máximo de resultados (padrão: 5)',
              default: 5
            }
          },
          required: ['query']
        }
      },
      {
        name: 'buscar_lead',
        description: 'Busca dados de um lead pelo telefone',
        inputSchema: {
          type: 'object',
          properties: {
            telefone: {
              type: 'string',
              description: 'Telefone no formato: 5511999999999@s.whatsapp.net'
            }
          },
          required: ['telefone']
        }
      },
      {
        name: 'atualizar_lead',
        description: 'Atualiza perfil de lead (dores, objeções, estágio)',
        inputSchema: {
          type: 'object',
          properties: {
            telefone: { type: 'string' },
            funnel_stage: { type: 'string' },
            perfil_completo_ia: { type: 'object' }
          },
          required: ['telefone']
        }
      }
    ]
  });
});

// ==========================================
// ENDPOINT: POST /buscar_arsenal
// ==========================================
app.post('/buscar_arsenal', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;
    
    log('Busca recebida', { query, limit });

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        erro: true,
        mensagem: 'Query inválida. Envie: { "query": "termo de busca" }'
      });
    }

    // 1. Gerar embedding
    const embedding = await gerarEmbedding(query);

    // 2. Buscar no Supabase
    const { data, error } = await supabase.rpc('match_arsenal_vendas', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: limit
    });

    if (error) {
      log('Erro no RPC', error);
      throw error;
    }

    log('Busca concluída', { total: data?.length || 0 });

    // 3. Tratar resultado vazio
    if (!data || data.length === 0) {
      return res.json({
        status: 'sem_resultados',
        query_original: query,
        sugestao: 'Tente termos mais amplos ou diferentes',
        total: 0,
        resultados: []
      });
    }

    // 4. Formatar resposta
    const resultados = data.map((item: any) => ({
      nome_arquivo: item.nome_arquivo,
      link_publico: item.link_publico,
      categoria: item.categoria,
      modelo: item.modelo_associado,
      conteudo_texto: item.conteudo_texto,
      detalhes_visuais: item.detalhes_visuais,
      descricao_semantica: item.descricao_semantica,
      emocao: item.emocao_predominante,
      momento_uso: item.melhor_momento_uso,
      relevancia: `${(item.similarity * 100).toFixed(1)}%`
    }));

    res.json({
      status: 'sucesso',
      query: query,
      total: resultados.length,
      resultados: resultados,
      instrucoes_ia: {
        como_usar_imagens: 'Se houver link_publico, SEMPRE envie com sintaxe: ![descrição](url)',
        como_usar_texto: 'Use conteudo_texto para argumentos e detalhes_visuais para descrições sensoriais',
        prioridade: 'Primeiro resultado é o mais relevante'
      }
    });

  } catch (error: any) {
    log('Erro fatal', error);
    res.status(500).json({
      erro: true,
      mensagem: error.message,
      stack: error.stack
    });
  }
});

// ==========================================
// ENDPOINT: POST /buscar_lead
// ==========================================
app.post('/buscar_lead', async (req: Request, res: Response) => {
  try {
    const { telefone } = req.body;

    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('telefone', telefone)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      encontrado: !!data,
      lead: data || null
    });

  } catch (error: any) {
    res.status(500).json({
      erro: true,
      mensagem: error.message
    });
  }
});

// ==========================================
// ENDPOINT: POST /atualizar_lead
// ==========================================
app.post('/atualizar_lead', async (req: Request, res: Response) => {
  try {
    const { telefone, funnel_stage, perfil_completo_ia } = req.body;

    const updateData: any = {
      telefone,
      last_interaction: new Date().toISOString()
    };

    if (funnel_stage) updateData.funnel_stage = funnel_stage;
    if (perfil_completo_ia) updateData.perfil_completo_ia = perfil_completo_ia;

    const { data, error } = await supabase
      .from('leads')
      .upsert(updateData, { onConflict: 'telefone' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      status: 'atualizado',
      lead: data
    });

  } catch (error: any) {
    res.status(500).json({
      erro: true,
      mensagem: error.message
    });
  }
});

// ==========================================
// ENDPOINT SSE (para compatibilidade MCP oficial)
// ==========================================
app.post('/sse', async (req: Request, res: Response) => {
  res.json({
    mensagem: 'Este é um servidor MCP via HTTP, não SSE',
    instrucoes: 'Use POST diretamente nos endpoints: /buscar_arsenal, /buscar_lead, /atualizar_lead',
    erro_original: 'Use POST /sse com corpo JSON-RPC 2.0'
  });
});

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Testar Supabase
    const { error: supabaseError } = await supabase
      .from('arsenal_vendas')
      .select('id')
      .limit(1);

    // Testar Vertex (opcional)
    let vertexOk = false;
    try {
      if (VERTEX_PROJECT) {
        const token = await getVertexToken();
        vertexOk = !!token;
      }
    } catch (e) {
      vertexOk = false;
    }

    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      supabase: supabaseError ? 'erro' : 'ok',
      vertex_ai: vertexOk ? 'ok' : 'não configurado',
      config: {
        supabase_url: SUPABASE_URL ? 'configurado' : 'faltando',
        vertex_project: VERTEX_PROJECT || 'não configurado'
      }
    });

  } catch (error: any) {
    res.status(500).json({
      status: 'erro',
      mensagem: error.message
    });
  }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  log(`🚀 MCP Server HTTP rodando na porta ${PORT}`);
  log('Endpoints disponíveis:', {
    info: `http://localhost:${PORT}/`,
    tools: `http://localhost:${PORT}/tools`,
    buscar: `http://localhost:${PORT}/buscar_arsenal`,
    health: `http://localhost:${PORT}/health`
  });
});
