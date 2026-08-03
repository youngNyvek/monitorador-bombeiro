# Monitorador Bombeiro

Aplicação web estática, mobile-first, para transformar um celular em um monitor visual de uma tela de computador usando a câmera traseira, OCR local e alerta sonoro/vibratório.

## Stack

- HTML
- CSS
- TypeScript
- Vite
- Tesseract.js no navegador
- localStorage e IndexedDB

## O que faz

- Captura a câmera traseira com `navigator.mediaDevices.getUserMedia`
- Usa a imagem inteira da câmera para ler a tela
- Exige testes manuais de leitura e alarme antes de iniciar o monitoramento
- Executa OCR na imagem completa da câmera
- Compara texto esperado e palavras-chave com normalização local
- Emite alerta contínuo com som e vibração
- Permite parar alerta, pausar e retomar o monitoramento
- Guarda histórico local das detecções
- Opcionalmente salva a imagem do alerta no IndexedDB local
- Mantém o log do OCR recolhível para deixar a câmera em destaque

## Rodando localmente

```bash
npm install
npm run dev
```

Abra a URL exibida pelo Vite. No Chrome para Android, use uma URL `https://` ou `localhost`.

## Build

```bash
npm run build
```

Pré-visualizar o build:

```bash
npm run preview
```

## GitHub Pages

O projeto já inclui `base: './'` no Vite e um workflow em `.github/workflows/deploy.yml` para publicar em GitHub Pages.

Passos:

1. Ative GitHub Pages no repositório usando `GitHub Actions`.
2. Faça push da branch principal.
3. O workflow gera e publica o conteúdo de `dist/`.
4. Se o repositório ainda estiver com Pages desativado, crie um secret chamado `PAGES_ENABLEMENT_TOKEN` com um token que tenha permissão de Pages e rode o workflow de novo.

## Arquitetura

- `src/app-controller.ts`: orquestra câmera, OCR, áudio, vibração, histórico e máquina de estados.
- `src/state/machine.ts`: reducer puro das transições do estado principal.
- `src/services/*`: câmera, captura de imagem, preprocessamento, OCR, áudio, vibração, Wake Lock, persistência e histórico.
- `src/ui/*`: componentes de interface e controles visuais.
- `tests/*`: testes unitários da comparação textual e da máquina de estados.

## Limitações conhecidas

- OCR local é pesado e depende de contraste/iluminação.
- Em segundo plano, o navegador pode pausar câmera, áudio ou OCR.
- Wake Lock não existe em todos os navegadores.
- O áudio precisa de interação explícita do usuário para ser liberado.
- O salvamento de imagens depende de IndexedDB e da quota local.
- A seleção da câmera traseira é uma melhor tentativa via `facingMode: environment`.
- Os modelos do Tesseract.js podem ser baixados do CDN na primeira execução, mas imagens e texto não são enviados para servidor.
