# Migração Railway → Neon

O Neon hospeda **apenas o banco Postgres**. A aplicação FastAPI continua precisando de um host
(Railway, Render, Fly.io, etc.). Este guia cobre mover o banco; a seção 5 cobre mover a aplicação.

## 1. Criar o banco no Neon

1. Neon Console → **New Project** (região `aws-sa-east-1` / São Paulo se disponível, senão `us-east-1`).
2. Em **Connect**, copie a connection string. Existem duas:
   - **Pooled** (host contém `-pooler`) → usar na aplicação (`DATABASE_URL`).
   - **Direct** (sem `-pooler`) → usar no script de migração abaixo.

## 2. Pegar a URL atual do Railway

```bash
railway login
```

```bash
railway variables
```

Copie o valor de `DATABASE_PUBLIC_URL` (a `DATABASE_URL` interna `*.railway.internal` não é acessível de fora).

## 3. Copiar os dados

Pare o serviço no Railway (ou aceite que gravações durante a cópia se perdem), então no PowerShell:

```powershell
$env:SOURCE_DATABASE_URL = "postgresql://...@....railway.app:PORT/railway"
$env:TARGET_DATABASE_URL = "postgresql://...@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require"
python scripts/migrate_db.py
```

O script cria as tabelas, copia todas as linhas mantendo os IDs, realinha as sequences e
imprime uma comparação de contagens. Rode `python scripts/migrate_db.py --verify` para conferir de novo.

**Rede corporativa bloqueando a porta 5432?** (erro `Connection timed out`) Adicione `--http`:
o destino passa a ser gravado pelo endpoint SQL-over-HTTPS do Neon (porta 443). A origem
(Railway) ainda precisa ser alcançável — a porta pública do Railway é aleatória (ex.: 12345),
teste com `Test-NetConnection HOST -Port PORTA`. Se também estiver bloqueada, rode de outra rede
(celular/casa) ou exporte do Railway via `railway connect` de lá.

Status em 22/08/2026: projeto Neon criado (`ep-wispy-darkness-ac5dmxlu`, sa-east-1), schema já
criado e vazio. Falta apenas copiar os dados do Railway.

Se o Railway já não estiver acessível, a origem pode ser o SQLite local: `sqlite:///./treinoja.db`.

## 4. Apontar a aplicação para o Neon

No host da aplicação, troque `DATABASE_URL` pela string **pooled** do Neon e reinicie.
`database.py` já adiciona `sslmode=require` automaticamente e usa `pool_pre_ping` porque o
Neon suspende o compute ocioso (free tier) — a primeira requisição após idle leva ~1 s.

Confira que `SECRET_KEY` está definido no novo ambiente; se mudar, todos os logins expiram.

## 5. (Opcional) Tirar a aplicação do Railway

`render.yaml` já está pronto: Render → New → Blueprint → selecionar o repositório → colar
`DATABASE_URL` (Neon pooled) e `SUPERADMIN_PASS`. Free tier do Render dorme após 15 min sem uso.

Depois de validar o novo ambiente, remova o serviço e o Postgres no Railway.

## Checklist de validação

- [ ] `/admin` loga com superadmin
- [ ] usuário existente loga e vê o treino
- [ ] concluir um treino grava em `workout_history`
- [ ] `/api/backup` exporta JSON
