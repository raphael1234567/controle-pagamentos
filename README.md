# Controle de Pagamentos - Versão Completa

Inclui:
- Login por usuário
- Cada usuário vê somente seus próprios pagamentos
- Status automático: Pendente, Perto de vencer, Vencido, Pago
- Botão "Marcar como pago"
- Data real do pagamento
- Histórico sem apagar: o botão Arquivar só marca `cancelado_em`
- Valor total a receber = valor + juros
- Resumo mensal: emprestado, juros, recebido e vencido

## Banco
Execute o arquivo `supabase-completo.sql` no SQL Editor do Supabase.

## .env
Copie `.env.example` para `.env` e configure DATABASE_URL e JWT_SECRET.

## Rodar
```powershell
npm install
npm start
```
