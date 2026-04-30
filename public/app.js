const API_BASE = '/api';
const $ = id => document.getElementById(id);

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const authArea       = $('authArea');
const appArea        = $('appArea');
const formAuth       = $('formAuth');
const authNome       = $('authNome');
const authEmail      = $('authEmail');
const authSenha      = $('authSenha');
const grupoNome      = $('grupoNome');
const tabLogin       = $('tabLogin');
const tabCadastro    = $('tabCadastro');
const btnAuth        = $('btnAuth');
const btnSair        = $('btnSair');
const usuarioLogado  = $('usuarioLogado');
const btnAtualizar   = $('btnAtualizar');

const form           = $('formPagamento');
const pagamentoId    = $('pagamentoId');
const nome           = $('nome');
const dataPagamento  = $('dataPagamento');
const dataVencimento = $('dataVencimento');
const valor          = $('valor');
const observacao     = $('observacao');
const tbody          = $('tbodyPagamentos');
const busca          = $('busca');
const filtroStatus   = $('filtroStatus');
const mesResumo      = $('mesResumo');
const btnCancelar    = $('btnCancelar');
const tituloForm     = $('tituloForm');

const inputDataInicio = $('inputDataInicio');
const inputDataFim    = $('inputDataFim');
const btnLimpar       = $('btnLimparFiltros');

const modalPagar       = $('modalPagar');
const inputDataPago    = $('inputDataPago');
const btnConfirmarPago = $('btnConfirmarPago');
const btnCancelarPago  = $('btnCancelarPago');

const modalExtrato        = $('modalExtrato');
const extratoTituloEl     = $('extratoTitulo');
const extratoSubtituloEl  = $('extratoSubtitulo');
const extratoDtInicio     = $('extratoDtInicio');
const extratoDtFim        = $('extratoDtFim');
const extratoFiltroStatus = $('extratoFiltroStatus');
const extratoBusca        = $('extratoBusca');
const extratoEmailInput   = $('extratoEmailInput');
const extratoLoading      = $('extratoLoading');
const grupoExtratoBusca   = $('grupoExtratoBusca');
const btnBaixarExtrato    = $('btnBaixarExtrato');
const btnEnviarExtrato    = $('btnEnviarExtrato');
const btnFecharExtrato    = $('btnFecharExtrato');
const btnExtratoCompleto  = $('btnExtratoCompleto');

// ─── Estado ───────────────────────────────────────────────────────────────────

let pagamentos       = [];
let modoCadastro     = false;
let _resolveDataPago = null;
let extratoNomePessoa = null;

let filtroRapido   = null;
let filtroDtInicio = '';
let filtroDtFim    = '';
let filtroVencIni  = '';
let filtroVencFim  = '';

let ordenarPor  = 'data_vencimento';
let ordenarDir  = 'ASC';

let chartMensal, chartStatus, chartClientes;

// ─── Utilitários ──────────────────────────────────────────────────────────────

function token()   { return localStorage.getItem('token'); }
function usuario() {
  try { return JSON.parse(localStorage.getItem('usuario') || 'null'); } catch { return null; }
}
function headers(json = false) {
  const h = { Authorization: `Bearer ${token()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function moeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dataBR(d) {
  if (!d) return '';
  const [a, m, di] = d.split('-');
  return `${di}/${m}/${a}`;
}
function hojeISO()  { return new Date().toISOString().slice(0, 10); }
function mesAtual() { return new Date().toISOString().slice(0, 7); }

function calcularVencimento(d) {
  if (!d) return '';
  const x = new Date(`${d}T00:00:00`);
  x.setMonth(x.getMonth() + 1);
  return x.toISOString().split('T')[0];
}
function toValorNumero(v) {
  return Number(String(v).replace(/\./g, '').replace(',', '.'));
}
function formatarMesLabel(ym) {
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const [ano, mes] = ym.split('-');
  return `${meses[Number(mes) - 1]}/${ano.slice(2)}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Nav mobile (seções) ──────────────────────────────────────────────────────

function mostrarSecao(id) {
  if (window.innerWidth >= 860) return;
  document.querySelectorAll('.secao').forEach(s => {
    s.classList.toggle('secao-ativa', s.id === id);
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('ativa', btn.dataset.secao === id);
  });
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => mostrarSecao(btn.dataset.secao));
});

window.addEventListener('resize', () => {
  if (window.innerWidth >= 860) {
    document.querySelectorAll('.secao').forEach(s => s.classList.add('secao-ativa'));
  }
});

// ─── Modal de pagamento ───────────────────────────────────────────────────────

function pedirDataPago() {
  return new Promise(resolve => {
    _resolveDataPago = resolve;
    inputDataPago.value = hojeISO();
    modalPagar.classList.remove('hidden');
    inputDataPago.focus();
  });
}

btnConfirmarPago.addEventListener('click', () => {
  if (!inputDataPago.value) return;
  modalPagar.classList.add('hidden');
  if (_resolveDataPago) _resolveDataPago(inputDataPago.value);
});
btnCancelarPago.addEventListener('click', () => {
  modalPagar.classList.add('hidden');
  if (_resolveDataPago) _resolveDataPago(null);
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

function mostrarApp() {
  const u = usuario();
  if (token() && u) {
    authArea.classList.add('hidden');
    appArea.classList.remove('hidden');
    usuarioLogado.textContent = `${u.nome} · ${u.email}`;
    mesResumo.value = mesResumo.value || mesAtual();
    carregarTudo();
  } else {
    authArea.classList.remove('hidden');
    appArea.classList.add('hidden');
  }
}

function configurarModoAuth(cadastro) {
  modoCadastro = cadastro;
  grupoNome.style.display = cadastro ? 'block' : 'none';
  btnAuth.textContent = cadastro ? 'Cadastrar' : 'Entrar';
  tabLogin.classList.toggle('ativa', !cadastro);
  tabCadastro.classList.toggle('ativa', cadastro);
}

async function autenticar(e) {
  e.preventDefault();
  const endpoint = modoCadastro ? '/auth/cadastrar' : '/auth/login';
  const payload  = modoCadastro
    ? { nome: authNome.value, email: authEmail.value, senha: authSenha.value }
    : { email: authEmail.value, senha: authSenha.value };

  const res  = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { toast(data.erro || 'Erro ao autenticar'); return; }

  localStorage.setItem('token', data.token);
  localStorage.setItem('usuario', JSON.stringify(data.usuario));
  formAuth.reset();
  mostrarApp();
}

function sair() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  configurarModoAuth(false);
  mostrarApp();
}

// ─── Resumo financeiro ────────────────────────────────────────────────────────

async function carregarResumo() {
  const p = new URLSearchParams();

  // Período: range explícito tem prioridade; sem range usa o seletor de mês do Dashboard
  if (filtroDtInicio || filtroDtFim) {
    if (filtroDtInicio) p.append('dataInicio', filtroDtInicio);
    if (filtroDtFim)    p.append('dataFim',    filtroDtFim);
  } else {
    p.append('mes', mesResumo.value || mesAtual());
  }

  // Estes filtros se combinam com qualquer período
  if (filtroVencIni)                                        p.append('vencInicio', filtroVencIni);
  if (filtroVencFim)                                        p.append('vencFim',    filtroVencFim);
  if (busca.value.trim())                                   p.append('busca',      busca.value.trim());
  if (filtroStatus.value && filtroStatus.value !== 'TODOS') p.append('status',     filtroStatus.value);

  const res = await fetch(`${API_BASE}/resumo?${p}`, { headers: headers() });
  if (!res.ok) return;
  const r = await res.json();
  const semJuros = Number(r.total_emprestado || 0);
  const juros    = Number(r.total_juros || 0);
  $('totalEmprestado').textContent = moeda(semJuros);
  $('totalJuros').textContent      = moeda(juros);
  $('totalComJuros').textContent   = moeda(semJuros + juros);
  $('totalRecebido').textContent   = moeda(r.total_recebido);
  $('totalVencido').textContent    = moeda(r.total_vencido);
}

// ─── Gráficos ─────────────────────────────────────────────────────────────────

async function carregarGraficos() {
  if (typeof Chart === 'undefined') return;
  try {
    const res = await fetch(`${API_BASE}/graficos`, { headers: headers() });
    if (!res.ok) return;
    const { mensal, status, clientes } = await res.json();
    renderGraficoMensal(mensal);
    renderGraficoStatus(status);
    renderGraficoClientes(clientes);
  } catch { /* silencioso — charts opcionais */ }
}

function renderGraficoMensal(dados) {
  const ctx = $('graficoMensal').getContext('2d');
  if (chartMensal) chartMensal.destroy();
  chartMensal = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dados.map(d => formatarMesLabel(d.mes)),
      datasets: [
        {
          label: 'Emprestado',
          data: dados.map(d => Number(d.total_emprestado)),
          borderColor: '#157347',
          backgroundColor: 'rgba(21,115,71,.12)',
          fill: true,
          tension: .4,
          pointRadius: 5,
          pointBackgroundColor: '#157347'
        },
        {
          label: 'Juros',
          data: dados.map(d => Number(d.total_juros)),
          borderColor: '#b54708',
          backgroundColor: 'rgba(181,71,8,.10)',
          fill: true,
          tension: .4,
          pointRadius: 5,
          pointBackgroundColor: '#b54708'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${moeda(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => `R$ ${Number(v).toLocaleString('pt-BR')}` },
          grid: { color: '#f0f0f0' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderGraficoStatus(dados) {
  const ctx = $('graficoStatus').getContext('2d');
  if (chartStatus) chartStatus.destroy();
  const total = dados.pago + dados.pendente + dados.perto + dados.vencido;
  chartStatus = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pago', 'Pendente', 'Perto de vencer', 'Vencido'],
      datasets: [{
        data: [dados.pago, dados.pendente, dados.perto, dados.vencido],
        backgroundColor: ['#067647', '#94a3b8', '#f59e0b', '#ef4444'],
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12 }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return ` ${ctx.raw} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderGraficoClientes(dados) {
  const ctx  = $('graficoClientes').getContext('2d');
  const wrap = $('graficoClientesWrap');
  const h    = Math.max(180, dados.length * 38);
  wrap.style.height = `${h}px`;
  if (chartClientes) chartClientes.destroy();
  const palette = ['#0f5132','#157347','#1a8a56','#1e9f64','#23b472','#27c980','#2cde8e','#52eba0'];
  chartClientes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dados.map(d => d.nome),
      datasets: [{
        label: 'Total a receber',
        data: dados.map(d => Number(d.total)),
        backgroundColor: dados.map((_, i) => palette[i] || '#157347'),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${moeda(ctx.raw)}` } }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: v => `R$ ${Number(v).toLocaleString('pt-BR')}` },
          grid: { color: '#f0f0f0' }
        },
        y: { grid: { display: false } }
      }
    }
  });
}

// ─── Filtros rápidos ──────────────────────────────────────────────────────────

function ativarBtnFiltro(tipo) {
  document.querySelectorAll('.btn-filtro').forEach(b => {
    b.classList.toggle('ativa', b.dataset.filtro === tipo);
  });
}

function setFiltroRapido(tipo) {
  const hoje = hojeISO();
  filtroRapido  = tipo;
  filtroDtInicio = '';
  filtroDtFim    = '';
  filtroVencIni  = '';
  filtroVencFim  = '';
  inputDataInicio.value = '';
  inputDataFim.value    = '';
  filtroStatus.value    = 'TODOS';

  if (tipo === 'hoje') {
    filtroVencIni = hoje;
    filtroVencFim = hoje;
  } else if (tipo === 'semana') {
    const fim = new Date(); fim.setDate(fim.getDate() + 7);
    filtroVencIni = hoje;
    filtroVencFim = fim.toISOString().slice(0, 10);
  } else if (tipo === 'mes') {
    const mes = mesAtual();
    const fim = new Date(`${mes}-01`); fim.setMonth(fim.getMonth() + 1); fim.setDate(fim.getDate() - 1);
    filtroDtInicio = `${mes}-01`;
    filtroDtFim    = fim.toISOString().slice(0, 10);
  } else if (tipo === 'vencidos') {
    filtroStatus.value = 'VENCIDO';
  }

  ativarBtnFiltro(tipo);
  carregarListaEResumo();
}

function limparTodosFiltros() {
  filtroRapido   = null;
  filtroDtInicio = '';
  filtroDtFim    = '';
  filtroVencIni  = '';
  filtroVencFim  = '';
  busca.value           = '';
  filtroStatus.value    = 'TODOS';
  inputDataInicio.value = '';
  inputDataFim.value    = '';
  ativarBtnFiltro(null);
  carregarListaEResumo();
}

document.querySelectorAll('.btn-filtro[data-filtro]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('ativa')) {
      limparTodosFiltros();
    } else {
      setFiltroRapido(btn.dataset.filtro);
    }
  });
});

btnLimpar.addEventListener('click', limparTodosFiltros);

// ─── Pagamentos ───────────────────────────────────────────────────────────────

function atualizarIconesSort() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    icon.textContent = th.dataset.col === ordenarPor
      ? (ordenarDir === 'ASC' ? ' ↑' : ' ↓')
      : '';
  });
}

async function carregarPagamentos() {
  const p = new URLSearchParams();
  if (busca.value.trim()) p.append('busca', busca.value.trim());
  if (filtroStatus.value && filtroStatus.value !== 'TODOS') p.append('status', filtroStatus.value);
  if (filtroDtInicio) p.append('dataInicio', filtroDtInicio);
  if (filtroDtFim)    p.append('dataFim',    filtroDtFim);
  if (filtroVencIni)  p.append('vencInicio', filtroVencIni);
  if (filtroVencFim)  p.append('vencFim',    filtroVencFim);
  p.append('ordenarPor', ordenarPor);
  p.append('ordenarDir', ordenarDir);

  const res = await fetch(`${API_BASE}/pagamentos?${p}`, { headers: headers() });
  if (res.status === 401) { sair(); return; }
  if (!res.ok) { toast('Erro ao carregar pagamentos'); return; }

  pagamentos = await res.json();
  renderizar();
}

async function carregarTudo() {
  await Promise.all([carregarResumo(), carregarPagamentos(), carregarGraficos()]);
}

async function carregarListaEResumo() {
  await Promise.all([carregarResumo(), carregarPagamentos()]);
}

function statusTexto(s) {
  return { PENDENTE: 'PENDENTE', PERTO_DE_VENCER: 'PERTO DE VENCER', VENCE_HOJE: 'VENCE HOJE', VENCIDO: 'VENCIDO', PAGO: 'PAGO' }[s] || s;
}

function renderizar() {
  tbody.innerHTML = '';
  if (!pagamentos.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#667085;padding:32px">Nenhum registro encontrado</td></tr>';
    return;
  }
  pagamentos.forEach(item => {
    const pago       = !!item.data_pago;
    const nomeAttr   = item.nome.replace(/"/g, '&quot;');
    const extratoBtn = `<button class="btn secundario" type="button" title="Extrato desta pessoa" data-nome="${nomeAttr}" onclick="window.abrirExtratoPessoa(this.dataset.nome)">📄</button>`;
    const botoes = pago
      ? `<span class="texto-suave">Pago</span>
         ${extratoBtn}
         <button class="btn perigo" type="button" title="Arquivar" onclick="arquivarPagamento(${item.id})">🗑️</button>`
      : `<button class="btn secundario" type="button" onclick="editarPagamento(${item.id})">Editar</button>
         <button class="btn principal"  type="button" onclick="marcarComoPago(${item.id})">Marcar pago</button>
         ${extratoBtn}
         <button class="btn perigo"     type="button" title="Arquivar" onclick="arquivarPagamento(${item.id})">🗑️</button>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Pagamentos">
        <strong>${item.nome}</strong>
        ${item.observacao ? `<br><small style="color:#667085">${item.observacao}</small>` : ''}
      </td>
      <td data-label="Data que pegou">${dataBR(item.data_pagamento)}</td>
      <td data-label="Data que vai pagar">${dataBR(item.data_vencimento)}</td>
      <td data-label="Valor">${moeda(item.valor)}</td>
      <td data-label="Juros">${moeda(item.juros)}</td>
      <td data-label="Total a receber"><strong>${moeda(item.valor_total)}</strong></td>
      <td data-label="Status">
        <span class="status ${item.status_pagamento}">${statusTexto(item.status_pagamento)}</span>
        ${Number(item.dias_atraso) > 0 ? `<br><small style="color:#b42318;font-size:12px">${item.dias_atraso} dia(s) em atraso</small>` : ''}
      </td>
      <td data-label="Pago em">${item.data_pago ? dataBR(item.data_pago) : '-'}</td>
      <td data-label="Ações" style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">${botoes}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function salvar(e) {
  e.preventDefault();
  const id = pagamentoId.value;
  const payload = {
    nome:          nome.value,
    dataPagamento: dataPagamento.value,
    dataVencimento: dataVencimento.value,
    valor:         toValorNumero(valor.value),
    observacao:    observacao.value
  };
  const res  = await fetch(id ? `${API_BASE}/pagamentos/${id}` : `${API_BASE}/pagamentos`, {
    method: id ? 'PUT' : 'POST', headers: headers(true), body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { toast(data.erro || 'Erro ao salvar'); return; }
  limparForm();
  await carregarTudo();
  toast(data.mensagem || 'Salvo com sucesso');
  mostrarSecao('secLista');
}

window.editarPagamento = function (id) {
  const item = pagamentos.find(p => Number(p.id) === Number(id));
  if (!item) { toast('Registro não encontrado'); return; }
  pagamentoId.value    = item.id;
  nome.value           = item.nome;
  dataPagamento.value  = item.data_pagamento;
  dataVencimento.value = item.data_vencimento || calcularVencimento(item.data_pagamento);
  valor.value          = String(Number(item.valor).toFixed(2)).replace('.', ',');
  observacao.value     = item.observacao || '';
  tituloForm.textContent = 'Editar pagamento';
  mostrarSecao('secNovo');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.marcarComoPago = async function (id) {
  const dataPago = await pedirDataPago();
  if (!dataPago) return;
  const res  = await fetch(`${API_BASE}/pagamentos/${id}/pagar`, {
    method: 'PATCH', headers: headers(true), body: JSON.stringify({ dataPago })
  });
  const data = await res.json();
  if (!res.ok) { toast(data.erro || 'Erro ao marcar como pago'); return; }
  await carregarTudo();
  toast(data.mensagem || 'Marcado como pago');
};

window.arquivarPagamento = async function (id) {
  if (!confirm('Arquivar este registro? Ele ficará salvo no histórico do banco.')) return;
  const res  = await fetch(`${API_BASE}/pagamentos/${id}`, { method: 'DELETE', headers: headers() });
  const data = await res.json();
  if (!res.ok) { toast(data.erro || 'Erro ao arquivar'); return; }
  await carregarTudo();
  toast(data.mensagem || 'Arquivado');
};

function limparForm() {
  form.reset();
  pagamentoId.value      = '';
  dataVencimento.value   = '';
  tituloForm.textContent = 'Novo pagamento';
}

// ─── Event listeners ──────────────────────────────────────────────────────────

dataPagamento.addEventListener('change', () => {
  dataVencimento.value = calcularVencimento(dataPagamento.value);
});

form.addEventListener('submit', salvar);
btnCancelar.addEventListener('click', limparForm);
btnAtualizar.addEventListener('click', carregarTudo);
mesResumo.addEventListener('change', () => { carregarResumo(); carregarGraficos(); });

busca.addEventListener('input', () => {
  filtroRapido = null; ativarBtnFiltro(null);
  carregarListaEResumo();
});
filtroStatus.addEventListener('change', () => {
  filtroRapido  = null; ativarBtnFiltro(null);
  filtroVencIni = ''; filtroVencFim = '';
  filtroDtInicio = ''; filtroDtFim   = '';
  carregarListaEResumo();
});
inputDataInicio.addEventListener('change', () => {
  filtroRapido  = null; ativarBtnFiltro(null);
  filtroDtInicio = inputDataInicio.value;
  carregarListaEResumo();
});
inputDataFim.addEventListener('change', () => {
  filtroRapido = null; ativarBtnFiltro(null);
  filtroDtFim  = inputDataFim.value;
  carregarListaEResumo();
});

document.querySelectorAll('th[data-col]').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (ordenarPor === col) {
      ordenarDir = ordenarDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      ordenarPor = col;
      ordenarDir = 'ASC';
    }
    atualizarIconesSort();
    carregarPagamentos();
  });
});

atualizarIconesSort();

tabLogin.addEventListener('click',    () => configurarModoAuth(false));
tabCadastro.addEventListener('click', () => configurarModoAuth(true));
formAuth.addEventListener('submit', autenticar);
btnSair.addEventListener('click', sair);

// ─── Extrato PDF ──────────────────────────────────────────────────────────────

function abrirModalExtrato(nomePessoa = null) {
  extratoNomePessoa = nomePessoa;
  extratoDtInicio.value     = '';
  extratoDtFim.value        = '';
  extratoFiltroStatus.value = '';
  extratoBusca.value        = '';
  extratoEmailInput.value   = '';
  extratoLoading.classList.add('hidden');
  btnBaixarExtrato.disabled = false;
  btnEnviarExtrato.disabled = false;

  if (nomePessoa) {
    extratoTituloEl.textContent    = `Extrato — ${nomePessoa}`;
    extratoSubtituloEl.textContent = 'PDF com todos os pagamentos desta pessoa';
    grupoExtratoBusca.style.display = 'none';
  } else {
    extratoTituloEl.textContent    = 'Extrato Completo';
    extratoSubtituloEl.textContent = 'PDF com todos os pagamentos (aplique filtros abaixo se desejar)';
    grupoExtratoBusca.style.display = '';
  }
  modalExtrato.classList.remove('hidden');
}

window.abrirExtratoPessoa = nome => abrirModalExtrato(nome);

function construirParamsExtrato() {
  const p = new URLSearchParams();
  if (extratoDtInicio.value)      p.append('dataInicio', extratoDtInicio.value);
  if (extratoDtFim.value)         p.append('dataFim',    extratoDtFim.value);
  if (extratoFiltroStatus.value)  p.append('status',     extratoFiltroStatus.value);
  if (!extratoNomePessoa && extratoBusca.value.trim())
    p.append('busca', extratoBusca.value.trim());
  return p;
}

function extratoSetLoading(on) {
  extratoLoading.classList.toggle('hidden', !on);
  btnBaixarExtrato.disabled = on;
  btnEnviarExtrato.disabled = on;
}

async function baixarExtrato() {
  extratoSetLoading(true);
  try {
    const params = construirParamsExtrato();
    const url = extratoNomePessoa
      ? `${API_BASE}/extratos/pessoa/${encodeURIComponent(extratoNomePessoa)}/pdf?${params}`
      : `${API_BASE}/extratos/completo/pdf?${params}`;

    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ erro: 'Erro ao gerar PDF' }));
      toast(err.erro || 'Erro ao gerar PDF'); return;
    }
    const blob   = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href     = objUrl;
    a.download = extratoNomePessoa
      ? `extrato-${extratoNomePessoa.toLowerCase().replace(/\s+/g, '-')}.pdf`
      : 'extrato-completo.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    toast('PDF gerado com sucesso!');
  } catch { toast('Erro ao gerar PDF'); }
  finally  { extratoSetLoading(false); }
}

async function enviarExtratoEmail() {
  const emailDestino = extratoEmailInput.value.trim();
  if (!emailDestino) { toast('Informe o e-mail de destino'); extratoEmailInput.focus(); return; }

  extratoSetLoading(true);
  try {
    const params = construirParamsExtrato();
    const url = extratoNomePessoa
      ? `${API_BASE}/extratos/pessoa/${encodeURIComponent(extratoNomePessoa)}/email`
      : `${API_BASE}/extratos/completo/email`;

    const body = { emailDestino };
    if (extratoDtInicio.value)     body.dataInicio = extratoDtInicio.value;
    if (extratoDtFim.value)        body.dataFim    = extratoDtFim.value;
    if (extratoFiltroStatus.value) body.status     = extratoFiltroStatus.value;
    if (!extratoNomePessoa && extratoBusca.value.trim()) body.busca = extratoBusca.value.trim();

    const res  = await fetch(url, { method: 'POST', headers: headers(true), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { toast(data.erro || 'Erro ao enviar e-mail'); return; }
    toast('E-mail enviado com sucesso!');
    modalExtrato.classList.add('hidden');
  } catch { toast('Erro ao enviar e-mail'); }
  finally  { extratoSetLoading(false); }
}

if (btnBaixarExtrato)   btnBaixarExtrato.addEventListener('click', baixarExtrato);
if (btnEnviarExtrato)   btnEnviarExtrato.addEventListener('click', enviarExtratoEmail);
if (btnFecharExtrato)   btnFecharExtrato.addEventListener('click', () => modalExtrato.classList.add('hidden'));
if (btnExtratoCompleto) btnExtratoCompleto.addEventListener('click', () => abrirModalExtrato(null));

// ─── PWA: Service Worker ───────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── Init ─────────────────────────────────────────────────────────────────────

configurarModoAuth(false);
mostrarApp();
