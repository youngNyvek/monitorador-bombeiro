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
- Permite arrastar e redimensionar uma região de monitoramento
- Executa OCR somente na região selecionada
- Compara texto esperado e palavras-chave com normalização local
- Emite alerta contínuo com som e vibração
- Permite parar alerta, pausar e retomar o monitoramento
- Guarda histórico local das detecções
- Opcionalmente salva o recorte do alerta no IndexedDB local

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

## Arquitetura

- `src/app-controller.ts`: orquestra câmera, OCR, áudio, vibração, histórico e máquina de estados.
- `src/state/machine.ts`: reducer puro das transições do estado principal.
- `src/services/*`: câmera, recorte, preprocessamento, OCR, áudio, vibração, Wake Lock, persistência e histórico.
- `src/ui/region-editor.ts`: interação de arrastar/redimensionar da área monitorada.
- `tests/*`: testes unitários da comparação textual e da máquina de estados.

## Limitações conhecidas

- OCR local é pesado e depende de contraste/iluminação.
- Em segundo plano, o navegador pode pausar câmera, áudio ou OCR.
- Wake Lock não existe em todos os navegadores.
- O áudio precisa de interação explícita do usuário para ser liberado.
- O salvamento de recortes depende de IndexedDB e da quota local.
- A seleção da câmera traseira é uma melhor tentativa via `facingMode: environment`.
- Os modelos do Tesseract.js podem ser baixados do CDN na primeira execução, mas imagens e texto não são enviados para servidor.
