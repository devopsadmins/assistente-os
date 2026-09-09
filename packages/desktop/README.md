# @assistente-os/desktop

Casca Electron sobre o SPA existente em `packages/web`, pra uso pessoal em
mais de uma máquina apontando pro mesmo daemon (não é uma tela de login
multi-usuário — reaproveita o mesmo `VITE_DEV_TOKEN`/`VITE_DEV_SOUL_ID` de
`packages/web/.env.local`).

## Dev (janela aponta pro Vite dev server)

```bash
npm run dev --workspace=@assistente-os/web   # em um terminal
npm run dev --workspace=@assistente-os/desktop  # em outro
```

## Empacotar um .zip portátil pra Windows

Sem instalador (sem NSIS — precisaria de Wine no host de build). É só
descompactar e rodar o `.exe` — sem wizard, sem atalho de menu iniciar.

```bash
VITE_API_BASE_URL=http://<ip-lan-do-server-01>:4310 \
  npm run package:win --workspace=@assistente-os/desktop
```

Gera `packages/desktop/release/assistente-os-desktop-win32-x64/`. Zipar essa
pasta inteira e copiar pra máquina Windows; rodar
`assistente-os-desktop.exe` de dentro dela (o app importa os arquivos ao
redor, não só o .exe).

`VITE_API_BASE_URL` é obrigatório aqui porque o app empacotado não tem o
proxy do Vite — ele fala direto (fetch) com o daemon nesse endereço. Por
isso o `BrowserWindow` do app empacotado roda com `webSecurity: false`
(ver comentário em `main.js`): o daemon não manda cabeçalho CORS, e isso é
aceitável só porque é uso pessoal numa LAN de confiança, não algo exposto
pra terceiros.

Se o `.exe` não conseguir falar com o daemon a partir de outra máquina,
confira: 1) o daemon está com `AOS_HOST=0.0.0.0` (já é o caso hoje) e
2) nenhum firewall (`ufw` no server-01, Windows Defender na outra ponta)
bloqueando a porta 4310.
