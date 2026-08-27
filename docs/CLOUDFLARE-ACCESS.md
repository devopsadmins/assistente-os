# Cloudflare Access — Service Token (bypass programático)

O domínio público `assistente-os.coderstudio.club` fica atrás do Cloudflare
Access (302 → login SSO). Agentes e o CI precisam chamar a API sem passar pelo
fluxo de login interativo — para isso usa-se um **service token** do Cloudflare
Zero Trust, que trafega em dois headers e é validado na borda **antes** do
Bearer token do próprio daemon.

> Duas camadas independentes de autenticação, ambas obrigatórias no domínio público:
> 1. **Cloudflare Access** (borda): `CF-Access-Client-Id` + `CF-Access-Client-Secret`.
> 2. **Daemon** (aplicação): `Authorization: Bearer $ASSISTENTE_OS_DAEMON_TOKEN`.

## 1. Criar o service token

Cloudflare Zero Trust dashboard → **Access → Service Auth → Service Tokens** →
*Create Service Token*:

- Nome: `assistente-os-agent` (ou `assistente-os-ci`, um por consumidor).
- Duração: 1 ano (padrão). Anote a data de expiração.

O dashboard mostra **uma vez** o `Client Secret`. Guarde imediatamente.

## 2. Autorizar o token na aplicação Access

Access → **Applications** → a aplicação do hostname `assistente-os.coderstudio.club`
→ **Policies** → *Add a policy*:

- Nome: `service-token-bypass`
- Action: **Service Auth**
- Include → **Service Token** → selecionar `assistente-os-agent`.

Sem esta policy o token é ignorado e o Access continua exigindo login.

## 3. Guardar as credenciais (nunca no repo)

`~/.assistant-os/.env` (fora do git, via symlink `.env` na raiz):

```
CF_ACCESS_CLIENT_ID=<client id>.access
CF_ACCESS_CLIENT_SECRET=<client secret>
```

No GitHub, para o CI: **Settings → Secrets and variables → Actions**:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

## 4. Usar

```bash
curl -sS https://assistente-os.coderstudio.club/health \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $ASSISTENTE_OS_DAEMON_TOKEN"
```

- Com os 3 headers → `200`.
- Sem os headers do Access → `302` (redirect para login) ou `403`.
- Com Access mas sem o Bearer → `401` do daemon.

## 5. Rotação

O service token tem validade fixa (definida na criação). Procedimento de troca,
**antes** do vencimento:

1. Criar um novo service token (passo 1) e adicioná-lo à policy existente (passo 2)
   — a policy pode incluir os dois durante a transição.
2. Atualizar `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` em `~/.assistant-os/.env`
   e nos secrets do GitHub.
3. Confirmar com o `curl` do passo 4.
4. Remover o token antigo da policy e revogá-lo no dashboard.

## CI

`.github/workflows/ci.yml` — se algum passo de deploy/health-check bater no
domínio público, injetar os headers a partir dos secrets:

```yaml
      - name: Health check (produção)
        run: |
          curl -fsS https://assistente-os.coderstudio.club/health \
            -H "CF-Access-Client-Id: ${{ secrets.CF_ACCESS_CLIENT_ID }}" \
            -H "CF-Access-Client-Secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}"
```

O daemon **não** precisa de nenhuma mudança de código: os headers `CF-Access-*`
são consumidos e removidos pela borda da Cloudflare; nunca chegam ao processo.
