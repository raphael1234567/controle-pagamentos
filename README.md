# Controle de Pagamentos

Sistema web para controle de empréstimos e pagamentos. Cada usuário tem login próprio e vê apenas os seus registros. Calcula juros automaticamente, exibe status em tempo real, gera extratos em PDF e envia alertas por e-mail.

---

## Funcionalidades

- Cadastro e login de usuários (senha criptografada com bcrypt, sessão via JWT)
- CRUD completo de pagamentos (criar, editar, marcar como pago, arquivar)
- Cálculo automático de juros: **40% ao mês** + **2% ao dia** de atraso
- Status automático calculado no servidor:
  - **PENDENTE** — vence em mais de 3 dias
  - **PERTO DE VENCER** — vence em 1 a 3 dias
  - **VENCE HOJE** — vence no dia atual
  - **VENCIDO** — passou da data de vencimento
  - **PAGO** — quitado
- Dashboard com resumo financeiro (emprestado, juros, total, recebido, vencido)
- Filtros por nome, período, status e data de vencimento
- Ordenação por qualquer coluna
- Gráficos: evolução mensal (6 meses), distribuição por status, top 8 clientes
- Extrato em PDF (completo ou por pessoa), com opção de envio por e-mail
- Alertas automáticos por e-mail: perto de vencer, vence hoje e vencido (com valor atualizado)
- Soft delete — registros arquivados ficam no banco sem aparecer na lista
- PWA: funciona instalado no celular/desktop e tem suporte offline básico

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL via Supabase |
| Autenticação | JWT + bcryptjs |
| E-mail | Nodemailer (SMTP) |
| PDF | PDFKit |
| Frontend | HTML + CSS + JavaScript puro |
| Gráficos | Chart.js |

---

## Estrutura de arquivos

```
├── public/
│   ├── index.html      interface principal (SPA)
│   ├── app.js          lógica do frontend
│   ├── style.css       estilos responsivos
│   ├── sw.js           service worker (PWA)
│   └── manifest.json   manifesto PWA
├── server.js           API REST + lógica de negócio
├── supabase-completo.sql  schema do banco de dados
├── package.json
├── .env.example        modelo de variáveis de ambiente
└── .gitignore
```

---

## Configuração do banco de dados

1. Crie um projeto no [Supabase](https://supabase.com)
2. Acesse **SQL Editor** no painel do Supabase
3. Cole e execute o conteúdo do arquivo `supabase-completo.sql`

O script cria as tabelas `usuarios` e `pagamentos` com todos os índices necessários.

### Tabelas

**usuarios**
| Coluna | Tipo | Descrição |
|---|---|---|
| id | BIGINT PK | Identificador |
| nome | TEXT | Nome do usuário |
| email | TEXT UNIQUE | E-mail (chave de login) |
| senha_hash | TEXT | Senha criptografada (bcrypt) |
| criado_em | TIMESTAMPTZ | Data de cadastro |

**pagamentos**
| Coluna | Tipo | Descrição |
|---|---|---|
| id | BIGINT PK | Identificador |
| usuario_id | BIGINT FK | Dono do registro |
| nome | TEXT | Nome de quem pegou emprestado |
| data_pagamento | DATE | Data que pegou o dinheiro |
| data_vencimento | DATE | Data combinada para pagar |
| valor | NUMERIC(12,2) | Valor emprestado |
| juros | NUMERIC(12,2) | Juros calculados no cadastro |
| observacao | TEXT | Anotações livres |
| data_pago | DATE | Quando pagou (nulo = em aberto) |
| cancelado_em | TIMESTAMPTZ | Soft delete |
| email_vencimento_enviado | BOOLEAN | Controla envio único do alerta de vencido |
| email_proximo_enviado | BOOLEAN | Controla envio único do alerta de perto/hoje |

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```env
PORT=3000

# String de conexão do Supabase (Project Settings → Database → Connection string → URI)
DATABASE_URL=postgresql://postgres:SUA_SENHA@db.xxxx.supabase.co:5432/postgres

# Chave secreta para assinar os tokens JWT (use uma string longa e aleatória)
JWT_SECRET=troque_essa_chave_por_uma_bem_grande

# Quantos dias antes de vencer para mostrar "Perto de vencer" e enviar alerta (padrão: 3)
DIAS_AVISO_VENCIMENTO=3

# Domínio permitido no CORS (deixe vazio em desenvolvimento)
CORS_ORIGIN=https://seu-app.onrender.com

# Configurações de e-mail (opcional — sem isso os alertas não são enviados)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seuemail@gmail.com
SMTP_PASS=sua_senha_de_app_google
EMAIL_DESTINO=seuemail@gmail.com
```

> **Gmail:** ative a verificação em duas etapas e gere uma [Senha de app](https://myaccount.google.com/apppasswords) para usar em `SMTP_PASS`.

---

## Rodando localmente

```bash
# Instalar dependências
npm install

# Iniciar servidor
npm start
```

Acesse `http://localhost:3000`.

---

## Lógica de juros

O cálculo é feito pela função `calcularJuros` no `server.js`:

```
Juros = valor × 0,40 × meses_do_empréstimo
      + (dias_em_atraso × valor × 0,02)   ← se já venceu
```

- **40% ao mês** proporcional ao prazo do empréstimo (mínimo 1 mês)
- **+2% ao dia** sobre o valor original a partir do dia seguinte ao vencimento

O juros é **recalculado no momento em que o registro é criado ou editado** e salvo no banco. Para pagamentos vencidos, o sistema recalcula dinamicamente na hora de enviar o e-mail para mostrar o valor atualizado do dia.

---

## E-mails automáticos

O servidor verifica vencimentos **a cada 1 hora**. Para cada pagamento em aberto:

| Situação | Assunto enviado | Enviado quantas vezes |
|---|---|---|
| Vence em 1–3 dias | `Perto de vencer - NOME` | 1 vez |
| Vence hoje | `Vence hoje - NOME` | 1 vez |
| Vencido | `Pagamento vencido - NOME` | 1 vez |

O e-mail de **vencido** inclui o valor com juros acumulados até a data do envio.

Os alertas só são enviados se as variáveis SMTP estiverem configuradas.

---

## API — principais endpoints

Todos os endpoints (exceto `/api/health`, `/api/auth/*`) exigem o header:
```
Authorization: Bearer {token}
```

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Verifica conexão com o banco |
| POST | `/api/auth/cadastrar` | Cadastra novo usuário |
| POST | `/api/auth/login` | Faz login, retorna token JWT |
| GET | `/api/me` | Dados do usuário logado |
| GET | `/api/resumo` | Totalizadores financeiros |
| GET | `/api/graficos` | Dados para os gráficos |
| GET | `/api/pagamentos` | Lista pagamentos com filtros |
| POST | `/api/pagamentos` | Cria pagamento |
| PUT | `/api/pagamentos/:id` | Edita pagamento |
| PATCH | `/api/pagamentos/:id/pagar` | Marca como pago |
| DELETE | `/api/pagamentos/:id` | Arquiva (soft delete) |
| GET | `/api/extratos/completo/pdf` | Gera PDF completo |
| POST | `/api/extratos/completo/email` | Envia PDF completo por e-mail |
| GET | `/api/extratos/pessoa/:nome/pdf` | Gera PDF de uma pessoa |
| POST | `/api/extratos/pessoa/:nome/email` | Envia PDF de pessoa por e-mail |

---

## Deploy no Render

### Primeiro deploy

1. Faça push do código para o GitHub (veja seção abaixo)
2. Acesse [render.com](https://render.com) e crie uma conta
3. Clique em **New → Web Service**
4. Conecte ao repositório GitHub
5. Configure o serviço:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Em **Environment Variables**, adicione todas as variáveis do `.env` (exceto `PORT` — o Render define automaticamente)
7. Clique em **Create Web Service**

O Render fará o primeiro deploy automaticamente.

### Atualizar após mudanças no código

Toda vez que fizer push para o GitHub, o Render detecta e faz o deploy automaticamente.

```bash
# 1. Ver o que mudou
git status

# 2. Adicionar os arquivos alterados
git add nome-do-arquivo.js
# ou adicionar tudo:
git add .

# 3. Criar o commit
git commit -m "descrição do que foi alterado"

# 4. Enviar para o GitHub (Render faz deploy em seguida)
git push origin main
```

Acompanhe o deploy em tempo real no painel do Render em **Dashboard → seu serviço → Events**.

---

## Subindo para o GitHub (do zero)

Se ainda não tem o repositório no GitHub:

```bash
# Inicializar o git (se ainda não foi feito)
git init

# Adicionar todos os arquivos (o .gitignore já exclui node_modules e .env)
git add .

# Primeiro commit
git commit -m "primeiro commit"

# Criar o repositório no GitHub e conectar
git remote add origin https://github.com/seu-usuario/seu-repositorio.git

# Enviar
git push -u origin main
```

> **Importante:** o arquivo `.env` está no `.gitignore` e **nunca vai para o GitHub**. As variáveis de ambiente ficam apenas no Render (Environment Variables) e na sua máquina local.

---

## Segurança

- Senhas armazenadas com **bcrypt** (hash irreversível)
- Sessões via **JWT** com expiração de 7 dias
- **Rate limiter** nas rotas de autenticação: 10 tentativas por IP a cada 15 minutos
- **CORS** configurável por variável de ambiente
- Todos os dados filtrados por `usuario_id` — um usuário nunca vê dados de outro
- `.env` ignorado pelo git
