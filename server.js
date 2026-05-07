require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const { Pool }     = require('pg');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const nodemailer   = require('nodemailer');
const PDFDocument  = require('pdfkit');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.DATABASE_URL) { console.error('ERRO: configure DATABASE_URL no .env'); process.exit(1); }
if (!process.env.JWT_SECRET)   { console.error('ERRO: configure JWT_SECRET no .env');   process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── E-mail ───────────────────────────────────────────────────────────────────

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function enviarEmail(assunto, mensagem) {
  if (!process.env.EMAIL_DESTINO || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  await mailer.sendMail({ from: process.env.SMTP_USER, to: process.env.EMAIL_DESTINO, subject: assunto, text: mensagem });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function gerarToken(u) {
  return jwt.sign({ id: u.id, email: u.email, nome: u.nome }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function autenticar(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token não informado' });
  try { req.usuario = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ erro: 'Sessão inválida ou expirada' }); }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const _rl = new Map();
function rateLimiter(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const e   = _rl.get(req.ip) || { n: 0, reset: now + windowMs };
    if (now > e.reset) { e.n = 0; e.reset = now + windowMs; }
    e.n++;
    _rl.set(req.ip, e);
    if (e.n > max) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    next();
  };
}
const limiteAuth = rateLimiter(10, 15 * 60 * 1000);

// ─── Cálculos financeiros ──────────────────────────────────────────────────────

function formatarData(d) { return d.toISOString().split('T')[0]; }

function calcularDataVencimento(dataPegou) {
  const d = new Date(`${dataPegou}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  return formatarData(d);
}

function calcularJuros(valor, dataPagamento, dataVencimento, dataRef = new Date()) {
  const pegou = new Date(`${dataPagamento}T00:00:00`);  pegou.setHours(0, 0, 0, 0);
  const venc  = new Date(`${dataVencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
  const hoje  = new Date(dataRef); hoje.setHours(0, 0, 0, 0);

  const diasEmprestimo = Math.max(0, Math.floor((venc - pegou) / 864e5));

  // Mínimo 2 meses para garantir ao menos 40% no 1º mês (mês 1 = base, mês 2 = 40% × 1.40)
  const meses = Math.max(2, Math.ceil(diasEmprestimo / 30));
  let juros = valor * 0.40 * Math.pow(1.40, meses - 1);

  // Acréscimo de 2% ao dia após vencimento
  if (hoje > venc) {
    const atraso = Math.floor((hoje - venc) / 864e5);
    juros += atraso * (valor * 0.02);
  }
  return Number(juros.toFixed(2));
}

function diasAtraso(dataVencimento, dataPago) {
  if (dataPago) return 0;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(`${dataVencimento}T00:00:00`);
  const diff = Math.floor((hoje - venc) / 864e5);
  return diff > 0 ? diff : 0;
}

function statusAutomatico(dataVencimento, dataPago) {
  if (dataPago) return 'PAGO';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(`${dataVencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
  if (venc < hoje) return 'VENCIDO';
  const diasAviso = Number(process.env.DIAS_AVISO_VENCIMENTO || 3);
  const diff = Math.floor((venc - hoje) / 864e5);
  if (diff === 0) return 'VENCE_HOJE';
  return diff <= diasAviso ? 'PERTO_DE_VENCER' : 'PENDENTE';
}

function toNum(v) { return Number(String(v).replace(/\./g, '').replace(',', '.')); }

// ─── Verificação de vencimentos por e-mail ────────────────────────────────────

async function verificarVencimentos() {
  try {
    const diasAviso = Number(process.env.DIAS_AVISO_VENCIMENTO || 3);
    const { rows } = await pool.query(`
      SELECT id, nome, valor,
             TO_CHAR(data_pagamento,'YYYY-MM-DD')  AS data_pagamento,
             TO_CHAR(data_vencimento,'YYYY-MM-DD') AS data_vencimento,
             CURRENT_DATE - data_vencimento AS dias_atraso,
             email_vencimento_enviado, email_proximo_enviado
      FROM public.pagamentos
      WHERE data_pago IS NULL AND cancelado_em IS NULL
    `);

    for (const p of rows) {
      const atraso = Number(p.dias_atraso);
      if (atraso > 0 && !p.email_vencimento_enviado) {
        const jurosAtual = calcularJuros(Number(p.valor), p.data_pagamento, p.data_vencimento);
        const totalAtual = Number(p.valor) + jurosAtual;
        await enviarEmail(`Pagamento vencido - ${p.nome}`,
          `Pagamento vencido!\n\nNome: ${p.nome}\nVencimento: ${p.data_vencimento}\nValor original: R$ ${Number(p.valor).toFixed(2)}\nJuros acumulados: R$ ${jurosAtual.toFixed(2)}\nValor atualizado: R$ ${totalAtual.toFixed(2)}\nDias em atraso: ${atraso} dia(s)`);
        await pool.query(`UPDATE public.pagamentos SET email_vencimento_enviado=TRUE WHERE id=$1`, [p.id]);
      }

      if (atraso <= 0 && !p.email_proximo_enviado) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const venc = new Date(`${p.data_vencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
        const faltam = Math.floor((venc - hoje) / 864e5);
        if (faltam >= 0 && faltam <= diasAviso) {
          const assunto = faltam === 0 ? `Vence hoje - ${p.nome}` : `Perto de vencer - ${p.nome}`;
          const prazo   = faltam === 0 ? `Vence hoje!` : `Faltam ${faltam} dia(s)`;
          await enviarEmail(assunto,
            `${faltam === 0 ? 'Vence hoje' : 'Perto de vencer'}.\n\nNome: ${p.nome}\nVencimento: ${p.data_vencimento}\nValor: R$ ${Number(p.valor).toFixed(2)}\nJuros: R$ ${Number(p.juros).toFixed(2)}\nTotal: R$ ${Number(p.valor_total).toFixed(2)}\n${prazo}`);
          await pool.query(`UPDATE public.pagamentos SET email_proximo_enviado=TRUE WHERE id=$1`, [p.id]);
        }
      }
    }
  } catch (err) { console.error('Erro ao verificar vencimentos:', err); }
}

setInterval(verificarVencimentos, 60 * 60 * 1000);
verificarVencimentos();

// ─── Rotas: saúde ─────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ sucesso: true, versao: '2026-05-07-v2', juros_teste: calcularJuros(250, '2026-05-07', '2026-05-30') });
  }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── Rotas: auth ──────────────────────────────────────────────────────────────

app.post('/api/auth/cadastrar', limiteAuth, async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios' });
    if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      'INSERT INTO public.usuarios (nome,email,senha_hash) VALUES ($1,LOWER($2),$3) RETURNING id,nome,email',
      [nome.trim(), email.trim(), hash]
    );
    const u = rows[0];
    res.json({ sucesso: true, usuario: u, token: gerarToken(u) });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ erro: 'Este email já está cadastrado' });
    console.error(e); res.status(500).json({ erro: 'Erro ao cadastrar usuário' });
  }
});

app.post('/api/auth/login', limiteAuth, async (req, res) => {
  try {
    const { email, senha } = req.body;
    const { rows } = await pool.query(
      'SELECT id,nome,email,senha_hash FROM public.usuarios WHERE email=LOWER($1)', [email || '']
    );
    if (!rows.length || !await bcrypt.compare(senha || '', rows[0].senha_hash))
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    const u = rows[0];
    res.json({ sucesso: true, usuario: { id: u.id, nome: u.nome, email: u.email }, token: gerarToken(u) });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao fazer login' }); }
});

app.get('/api/me', autenticar, (req, res) => res.json({ usuario: req.usuario }));

// ─── Rotas: resumo ────────────────────────────────────────────────────────────

app.get('/api/resumo', autenticar, async (req, res) => {
  try {
    const { mes, busca, status, dataInicio, dataFim, vencInicio, vencFim } = req.query;

    const params = [req.usuario.id];
    const where  = ['usuario_id=$1', 'cancelado_em IS NULL'];

    // Período por data que pegou: range explícito tem prioridade sobre mes
    if (dataInicio) { params.push(dataInicio); where.push(`data_pagamento >= $${params.length}`); }
    if (dataFim)    { params.push(dataFim);    where.push(`data_pagamento <= $${params.length}`); }
    if (!dataInicio && !dataFim && mes) {
      const inicio = `${mes}-01`;
      params.push(inicio);
      const idx = params.length;
      where.push(`data_pagamento >= $${idx}::date`);
      where.push(`data_pagamento <  ($${idx}::date + INTERVAL '1 month')`);
    }

    // Filtros adicionais (mesmo que /api/pagamentos)
    if (vencInicio) { params.push(vencInicio); where.push(`data_vencimento >= $${params.length}`); }
    if (vencFim)    { params.push(vencFim);    where.push(`data_vencimento <= $${params.length}`); }
    if (busca)      { params.push(`%${busca}%`); where.push(`nome ILIKE $${params.length}`); }

    const { rows } = await pool.query(`
      SELECT valor, juros,
             TO_CHAR(data_pagamento, 'YYYY-MM-DD') AS data_pagamento,
             TO_CHAR(data_vencimento,'YYYY-MM-DD') AS data_vencimento,
             TO_CHAR(data_pago,     'YYYY-MM-DD')  AS data_pago
      FROM public.pagamentos
      WHERE ${where.join(' AND ')}
    `, params);

    let lista = rows.map(p => {
      let juros = Number(p.juros);
      if (!p.data_pago) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const venc = new Date(`${p.data_vencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
        if (hoje > venc) {
          const atraso = Math.floor((hoje - venc) / 864e5);
          juros += atraso * (Number(p.valor) * 0.02);
        }
      }
      return {
        ...p,
        juros,
        valor_total: Number(p.valor) + juros,
        status_pagamento: statusAutomatico(p.data_vencimento, p.data_pago)
      };
    });

    if (status && status !== 'TODOS')
      lista = lista.filter(p => p.status_pagamento === status);

    const emAberto       = lista.filter(p => !p.data_pago);
    const totalEmprestado = emAberto.reduce((s, p) => s + Number(p.valor),       0);
    const totalJuros      = emAberto.reduce((s, p) => s + Number(p.juros),       0);
    const totalRecebido   = lista.filter(p =>  p.data_pago).reduce((s, p) => s + Number(p.valor_total), 0);
    const totalVencido    = lista.filter(p => p.status_pagamento === 'VENCIDO').reduce((s, p) => s + Number(p.valor_total), 0);

    res.json({
      total_emprestado: totalEmprestado.toFixed(2),
      total_juros:      totalJuros.toFixed(2),
      total_recebido:   totalRecebido.toFixed(2),
      total_vencido:    totalVencido.toFixed(2),
      registros:        lista.length
    });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao buscar resumo' }); }
});

// ─── Rotas: gráficos ──────────────────────────────────────────────────────────

app.get('/api/graficos', autenticar, async (req, res) => {
  try {
    const uid       = req.usuario.id;
    const diasAviso = Number(process.env.DIAS_AVISO_VENCIMENTO || 3);

    const [mensal, statusDist, clientes] = await Promise.all([

      // Evolução dos últimos 6 meses
      pool.query(`
        SELECT
          TO_CHAR(data_pagamento, 'YYYY-MM')   AS mes,
          COALESCE(SUM(valor), 0)              AS total_emprestado,
          COALESCE(SUM(juros),  0)             AS total_juros
        FROM public.pagamentos
        WHERE usuario_id = $1
          AND cancelado_em IS NULL
          AND data_pagamento >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY 1
        ORDER BY 1
      `, [uid]),

      // Distribuição por status
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN data_pago IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS pago,
          COALESCE(SUM(CASE WHEN data_pago IS NULL AND data_vencimento < CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS vencido,
          COALESCE(SUM(CASE WHEN data_pago IS NULL AND data_vencimento >= CURRENT_DATE
                             AND data_vencimento <= CURRENT_DATE + ($2::int * INTERVAL '1 day') THEN 1 ELSE 0 END), 0)::int AS perto,
          COALESCE(SUM(CASE WHEN data_pago IS NULL AND data_vencimento > CURRENT_DATE + ($2::int * INTERVAL '1 day') THEN 1 ELSE 0 END), 0)::int AS pendente
        FROM public.pagamentos
        WHERE usuario_id = $1 AND cancelado_em IS NULL
      `, [uid, diasAviso]),

      // Top clientes por valor total
      pool.query(`
        SELECT nome,
               COALESCE(SUM(valor), 0)       AS total_valor,
               COALESCE(SUM(juros),  0)      AS total_juros,
               COALESCE(SUM(valor+juros), 0) AS total
        FROM public.pagamentos
        WHERE usuario_id = $1 AND cancelado_em IS NULL
        GROUP BY nome
        ORDER BY total DESC
        LIMIT 8
      `, [uid])
    ]);

    res.json({ mensal: mensal.rows, status: statusDist.rows[0], clientes: clientes.rows });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao buscar dados dos gráficos' }); }
});

// ─── Rotas: nomes de clientes ─────────────────────────────────────────────────

app.get('/api/nomes', autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT nome FROM public.pagamentos WHERE usuario_id=$1 AND cancelado_em IS NULL ORDER BY nome`,
      [req.usuario.id]
    );
    res.json(rows.map(r => r.nome));
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao buscar nomes' }); }
});

// ─── Rotas: pagamentos ────────────────────────────────────────────────────────

app.get('/api/pagamentos', autenticar, async (req, res) => {
  try {
    const { busca, status, dataInicio, dataFim, vencInicio, vencFim } = req.query;
    const params = [req.usuario.id];
    const where  = ['usuario_id=$1', 'cancelado_em IS NULL'];

    if (busca)      { params.push(`%${busca}%`);    where.push(`nome ILIKE $${params.length}`); }
    if (dataInicio) { params.push(dataInicio);       where.push(`data_pagamento >= $${params.length}`); }
    if (dataFim)    { params.push(dataFim);          where.push(`data_pagamento <= $${params.length}`); }
    if (vencInicio) { params.push(vencInicio);       where.push(`data_vencimento >= $${params.length}`); }
    if (vencFim)    { params.push(vencFim);          where.push(`data_vencimento <= $${params.length}`); }

    const colMap = {
      nome:            'nome',
      data_pagamento:  'data_pagamento',
      data_vencimento: 'data_vencimento',
      valor:           'valor',
      valor_total:     'valor+juros',
    };
    const coluna   = colMap[req.query.ordenarPor] || 'data_vencimento';
    const direcao  = req.query.ordenarDir === 'DESC' ? 'DESC' : 'ASC';

    const { rows } = await pool.query(`
      SELECT id, nome,
             TO_CHAR(data_pagamento, 'YYYY-MM-DD')  AS data_pagamento,
             TO_CHAR(data_vencimento,'YYYY-MM-DD')  AS data_vencimento,
             valor, juros, valor+juros              AS valor_total,
             TO_CHAR(data_pago,     'YYYY-MM-DD')   AS data_pago,
             observacao, criado_em
      FROM public.pagamentos
      WHERE ${where.join(' AND ')}
      ORDER BY ${coluna} ${direcao}, id DESC
    `, params);

    let lista = rows.map(p => {
      let juros = Number(p.juros);
      if (!p.data_pago) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const venc = new Date(`${p.data_vencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
        if (hoje > venc) {
          const atraso = Math.floor((hoje - venc) / 864e5);
          juros += atraso * (Number(p.valor) * 0.02);
        }
      }
      return {
        ...p,
        juros,
        valor_total: Number(p.valor) + juros,
        status_pagamento: statusAutomatico(p.data_vencimento, p.data_pago),
        dias_atraso:      diasAtraso(p.data_vencimento, p.data_pago)
      };
    });

    if (status && status !== 'TODOS') lista = lista.filter(p => p.status_pagamento === status);

    res.json(lista);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao buscar pagamentos' }); }
});

app.post('/api/pagamentos', autenticar, async (req, res) => {
  try {
    const { nome, dataPagamento, dataVencimento, valor, observacao } = req.body;
    if (!nome || !dataPagamento || valor == null || valor === '')
      return res.status(400).json({ erro: 'Nome, data que pegou e valor são obrigatórios' });
    const valorNum = toNum(valor);
    if (Number.isNaN(valorNum) || valorNum < 0) return res.status(400).json({ erro: 'Valor inválido' });
    const venc  = dataVencimento || calcularDataVencimento(dataPagamento);
    const juros = calcularJuros(valorNum, dataPagamento, venc);
    await pool.query(
      'INSERT INTO public.pagamentos (usuario_id,nome,data_pagamento,data_vencimento,valor,juros,observacao) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.usuario.id, nome.trim().toUpperCase(), dataPagamento, venc, valorNum, juros, observacao || null]
    );
    res.json({ sucesso: true, mensagem: 'Pagamento salvo com sucesso' });
    enviarExtratoAutomatico(req.usuario.id, req.usuario.nome).catch(() => {});
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao salvar pagamento' }); }
});

app.put('/api/pagamentos/:id', autenticar, async (req, res) => {
  try {
    const { nome, dataPagamento, dataVencimento, valor, observacao } = req.body;
    const id       = Number(req.params.id);
    const valorNum = toNum(valor);
    if (Number.isNaN(valorNum) || valorNum < 0) return res.status(400).json({ erro: 'Valor inválido' });
    const venc  = dataVencimento || calcularDataVencimento(dataPagamento);
    const juros = calcularJuros(valorNum, dataPagamento, venc);

    await pool.query(`
      UPDATE public.pagamentos
      SET nome=$1,data_pagamento=$2,data_vencimento=$3,valor=$4,juros=$5,observacao=$6,atualizado_em=NOW()
      WHERE id=$7 AND usuario_id=$8 AND data_pago IS NULL AND cancelado_em IS NULL
    `, [nome.trim().toUpperCase(), dataPagamento, venc, valorNum, juros, observacao || null, id, req.usuario.id]);

    res.json({ sucesso: true, mensagem: 'Pagamento atualizado com sucesso' });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao atualizar pagamento' }); }
});

app.patch('/api/pagamentos/:id/pagar', autenticar, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const dataPago = req.body.dataPago || formatarData(new Date());
    await pool.query(
      'UPDATE public.pagamentos SET data_pago=$1,atualizado_em=NOW() WHERE id=$2 AND usuario_id=$3 AND cancelado_em IS NULL',
      [dataPago, id, req.usuario.id]
    );
    res.json({ sucesso: true, mensagem: 'Pagamento marcado como pago' });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao marcar como pago' }); }
});

app.delete('/api/pagamentos/:id', autenticar, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query(
      'UPDATE public.pagamentos SET cancelado_em=NOW() WHERE id=$1 AND usuario_id=$2',
      [id, req.usuario.id]
    );
    res.json({ sucesso: true, mensagem: 'Registro arquivado no histórico' });
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao arquivar registro' }); }
});

// ─── Extrato: helpers ─────────────────────────────────────────────────────────

async function fetchExtratoRows(uid, f) {
  const params = [uid];
  const where  = ['usuario_id=$1', 'cancelado_em IS NULL'];

  if (f.nome)       { params.push(f.nome);         where.push(`nome=$${params.length}`); }
  if (f.busca)      { params.push(`%${f.busca}%`); where.push(`nome ILIKE $${params.length}`); }
  if (f.dataInicio) { params.push(f.dataInicio);   where.push(`data_pagamento >= $${params.length}`); }
  if (f.dataFim)    { params.push(f.dataFim);      where.push(`data_pagamento <= $${params.length}`); }

  const { rows } = await pool.query(`
    SELECT nome,
           TO_CHAR(data_pagamento, 'YYYY-MM-DD')  AS data_pagamento,
           TO_CHAR(data_vencimento,'YYYY-MM-DD')  AS data_vencimento,
           valor, juros, valor+juros              AS valor_total,
           TO_CHAR(data_pago,     'YYYY-MM-DD')   AS data_pago,
           observacao
    FROM public.pagamentos
    WHERE ${where.join(' AND ')}
    ORDER BY data_vencimento ASC, id DESC
  `, params);

  let lista = rows.map(p => {
    let juros = Number(p.juros);
    if (!p.data_pago) {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const venc = new Date(`${p.data_vencimento}T00:00:00`); venc.setHours(0, 0, 0, 0);
      if (hoje > venc) {
        const atraso = Math.floor((hoje - venc) / 864e5);
        juros += atraso * (Number(p.valor) * 0.02);
      }
    }
    return {
      ...p,
      juros,
      valor_total: Number(p.valor) + juros,
      status_pagamento: statusAutomatico(p.data_vencimento, p.data_pago),
      dias_atraso:      diasAtraso(p.data_vencimento, p.data_pago)
    };
  });

  if (f.status && f.status !== 'TODOS')
    lista = lista.filter(p => p.status_pagamento === f.status);

  return lista;
}

function buildPDF(rows, titulo, subtitulo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    fillPDF(doc, rows, titulo, subtitulo);
    doc.end();
  });
}

function fillPDF(doc, rows, titulo, subtitulo) {
  const ML = 40, MT = 40;
  const CW = doc.page.width - ML * 2;   // ~762 pt (A4 landscape)
  const BOTTOM   = doc.page.height - 40;
  const HEADER_H = 52, HEAD_H = 24, ROW_H = 20;

  const dBR = d => { if (!d) return '-'; const [a, m, di] = d.split('-'); return `${di}/${m}/${a}`; };
  const mBR = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const sBR = s => ({ PENDENTE: 'Pendente', PERTO_DE_VENCER: 'Perto vencer', VENCE_HOJE: 'Vence hoje', VENCIDO: 'Vencido', PAGO: 'Pago' }[s] || s);

  // widths: 150+75+75+90+90+90+90+102 = 762
  const COLS = [
    { label: 'Nome',    key: 'nome',             w: 150, align: 'left'               },
    { label: 'Pegou',   key: 'data_pagamento',   w:  75, align: 'center', fmt: dBR   },
    { label: 'Vence',   key: 'data_vencimento',  w:  75, align: 'center', fmt: dBR   },
    { label: 'Valor',   key: 'valor',            w:  90, align: 'right',  fmt: mBR   },
    { label: 'Juros',   key: 'juros',            w:  90, align: 'right',  fmt: mBR   },
    { label: 'Total',   key: 'valor_total',      w:  90, align: 'right',  fmt: mBR   },
    { label: 'Status',  key: 'status_pagamento', w:  90, align: 'center', fmt: sBR   },
    { label: 'Pago em', key: 'data_pago',        w: 102, align: 'center', fmt: dBR   },
  ];

  function drawPageHeader(y0) {
    doc.rect(ML, y0, CW, HEADER_H).fill('#0f5132');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
       .text(titulo, ML + 14, y0 + 10, { width: CW - 28, lineBreak: false });
    doc.fillColor('#dcfae6').font('Helvetica').fontSize(9)
       .text(subtitulo, ML + 14, y0 + 33, { width: CW - 28, lineBreak: false });
    return y0 + HEADER_H;
  }

  function drawColHeaders(y0) {
    doc.rect(ML, y0, CW, HEAD_H).fill('#155c39');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    let x = ML;
    for (const c of COLS) {
      doc.text(c.label, x + 4, y0 + 8, { width: c.w - 8, align: c.align, lineBreak: false });
      x += c.w;
    }
    return y0 + HEAD_H;
  }

  let y = drawPageHeader(MT) + 8;
  y = drawColHeaders(y);

  let even = false;
  for (const row of rows) {
    if (y + ROW_H > BOTTOM - 60) {
      doc.addPage();
      y = drawPageHeader(MT) + 8;
      y = drawColHeaders(y);
      even = false;
    }

    doc.rect(ML, y, CW, ROW_H).fill(even ? '#f0f9f4' : '#ffffff');
    even = !even;

    doc.fillColor('#1d2939').font('Helvetica').fontSize(8.5);
    let x = ML;
    for (const c of COLS) {
      const raw = row[c.key];
      const txt = c.fmt ? c.fmt(raw) : (raw != null ? String(raw) : '-');
      doc.text(txt, x + 4, y + 6, { width: c.w - 8, align: c.align, lineBreak: false });
      x += c.w;
    }

    doc.strokeColor('#e4e7ec').lineWidth(0.3)
       .moveTo(ML, y + ROW_H).lineTo(ML + CW, y + ROW_H).stroke();
    y += ROW_H;
  }

  // Totals
  if (y + 56 > BOTTOM) { doc.addPage(); y = MT; }

  const tVal  = rows.reduce((s, r) => s + Number(r.valor),       0);
  const tJur  = rows.reduce((s, r) => s + Number(r.juros),       0);
  const tTot  = rows.reduce((s, r) => s + Number(r.valor_total), 0);
  const tPago = rows.filter(r => r.data_pago).reduce((s, r) => s + Number(r.valor_total), 0);

  y += 8;
  doc.rect(ML, y, CW, 36).fill('#e8f5ef');
  doc.fillColor('#0f5132').font('Helvetica-Bold').fontSize(8.5);
  doc.text(
    `${rows.length} registro(s)  ·  Valor: ${mBR(tVal)}  ·  Juros: ${mBR(tJur)}  ·  Total a receber: ${mBR(tTot)}  ·  Recebido: ${mBR(tPago)}  ·  Pendente: ${mBR(tTot - tPago)}`,
    ML + 12, y + 13, { width: CW - 24, align: 'center', lineBreak: false }
  );

  doc.fillColor('#98a2b3').font('Helvetica').fontSize(7.5)
     .text(
       `Gerado em ${new Date().toLocaleString('pt-BR')}  -  Controle de Pagamentos`,
       ML, y + 46, { width: CW, align: 'center', lineBreak: false }
     );
}

async function enviarEmailComPDF(para, assunto, texto, filename, buf) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
    throw new Error('SMTP nao configurado no servidor');
  await mailer.sendMail({
    from: process.env.SMTP_USER,
    to:   para,
    subject: assunto,
    text:    texto,
    attachments: [{ filename, content: buf, contentType: 'application/pdf' }]
  });
}

async function enviarExtratoAutomatico(uid, nomeUsuario) {
  if (!process.env.EMAIL_DESTINO || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  try {
    const rows = await fetchExtratoRows(uid, {});
    if (!rows.length) return;
    const titulo    = 'Extrato Completo de Pagamentos';
    const subtitulo = `Usuário: ${nomeUsuario}  |  ${rows.length} registro(s)  |  ${new Date().toLocaleDateString('pt-BR')}`;
    const buf = await buildPDF(rows, titulo, subtitulo);
    await enviarEmailComPDF(
      process.env.EMAIL_DESTINO,
      `Extrato atualizado — ${new Date().toLocaleDateString('pt-BR')}`,
      `Novo empréstimo registrado. Segue o extrato completo atualizado.\n\nTotal de registros: ${rows.length}`,
      'extrato-completo.pdf',
      buf
    );
  } catch (err) { console.error('Erro ao enviar extrato automático:', err); }
}

// ─── Rotas: extratos PDF ──────────────────────────────────────────────────────

app.get('/api/extratos/completo/pdf', autenticar, async (req, res) => {
  try {
    const { dataInicio, dataFim, status, busca } = req.query;
    const rows = await fetchExtratoRows(req.usuario.id, { dataInicio, dataFim, status, busca });
    if (!rows.length) return res.status(404).json({ erro: 'Nenhum registro encontrado para os filtros informados' });

    const titulo    = 'Extrato Completo de Pagamentos';
    const subtitulo = `Usuario: ${req.usuario.nome}  |  ${rows.length} registro(s)  |  ${new Date().toLocaleDateString('pt-BR')}`;
    const buf = await buildPDF(rows, titulo, subtitulo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="extrato-completo.pdf"');
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao gerar extrato' }); }
});

app.post('/api/extratos/completo/email', autenticar, async (req, res) => {
  try {
    const { emailDestino, dataInicio, dataFim, status, busca } = req.body;
    if (!emailDestino) return res.status(400).json({ erro: 'E-mail de destino e obrigatorio' });

    const rows = await fetchExtratoRows(req.usuario.id, { dataInicio, dataFim, status, busca });
    if (!rows.length) return res.status(404).json({ erro: 'Nenhum registro encontrado para os filtros informados' });

    const titulo    = 'Extrato Completo de Pagamentos';
    const subtitulo = `Usuario: ${req.usuario.nome}  |  ${rows.length} registro(s)  |  ${new Date().toLocaleDateString('pt-BR')}`;
    const buf = await buildPDF(rows, titulo, subtitulo);

    await enviarEmailComPDF(
      emailDestino, titulo,
      `Segue em anexo o extrato completo de pagamentos.\n\nTotal de registros: ${rows.length}`,
      'extrato-completo.pdf', buf
    );
    res.json({ sucesso: true, mensagem: 'Extrato enviado por e-mail com sucesso' });
  } catch (e) {
    console.error(e);
    if (e.message.includes('SMTP')) return res.status(503).json({ erro: e.message });
    res.status(500).json({ erro: 'Erro ao enviar e-mail' });
  }
});

app.get('/api/extratos/pessoa/:nome/pdf', autenticar, async (req, res) => {
  try {
    const nome = req.params.nome;
    const { dataInicio, dataFim, status } = req.query;
    const rows = await fetchExtratoRows(req.usuario.id, { nome, dataInicio, dataFim, status });
    if (!rows.length) return res.status(404).json({ erro: 'Nenhum registro encontrado para esta pessoa' });

    const titulo    = `Extrato - ${nome}`;
    const subtitulo = `Usuario: ${req.usuario.nome}  |  ${rows.length} registro(s)  |  ${new Date().toLocaleDateString('pt-BR')}`;
    const buf = await buildPDF(rows, titulo, subtitulo);
    const safeName = nome.toLowerCase().replace(/[^a-z0-9]/g, '-');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="extrato-${safeName}.pdf"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro ao gerar extrato' }); }
});

app.post('/api/extratos/pessoa/:nome/email', autenticar, async (req, res) => {
  try {
    const nome = req.params.nome;
    const { emailDestino, dataInicio, dataFim, status } = req.body;
    if (!emailDestino) return res.status(400).json({ erro: 'E-mail de destino e obrigatorio' });

    const rows = await fetchExtratoRows(req.usuario.id, { nome, dataInicio, dataFim, status });
    if (!rows.length) return res.status(404).json({ erro: 'Nenhum registro encontrado para esta pessoa' });

    const titulo    = `Extrato - ${nome}`;
    const subtitulo = `Usuario: ${req.usuario.nome}  |  ${rows.length} registro(s)  |  ${new Date().toLocaleDateString('pt-BR')}`;
    const buf = await buildPDF(rows, titulo, subtitulo);
    const safeName = nome.toLowerCase().replace(/[^a-z0-9]/g, '-');

    await enviarEmailComPDF(
      emailDestino, titulo,
      `Segue em anexo o extrato de pagamentos de ${nome}.\n\nTotal de registros: ${rows.length}`,
      `extrato-${safeName}.pdf`, buf
    );
    res.json({ sucesso: true, mensagem: 'Extrato enviado por e-mail com sucesso' });
  } catch (e) {
    console.error(e);
    if (e.message.includes('SMTP')) return res.status(503).json({ erro: e.message });
    res.status(500).json({ erro: 'Erro ao enviar e-mail' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Sistema rodando em http://localhost:${port}`));
