import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // 1. Qual será a pasta de destino? (Você pode mudar este nome)
    outDir: 'github_version', 
    
    // 2. Limpa a pasta antiga antes de gerar uma nova versão
    emptyOutDir: true, 

    // 3. Força o uso do Terser para compressão máxima
    minify: 'terser', 

    // 4. Configuração Extrema do Terser
    terserOptions: {
      compress: {
        drop_console: true,     // Remove TODOS os console.log, console.error, etc
        drop_debugger: true,    // Remove qualquer 'debugger' esquecido
        passes: 3,              // Faz o algoritmo rodar 3 vezes para exprimir até a última gota
        pure_getters: true,     // Otimiza funções que só retornam valores
        unsafe: true            // Permite transformações agressivas no código (ex: x=x+1 vira x++)
      },
      mangle: {
        toplevel: true,         // Encurta os nomes das funções e variáveis globais para a, b, c...
        // ATENÇÃO: Nunca ative 'properties: true' em jogos, pois ele renomeia funções 
        // nativas do navegador (como as do Canvas ou DOM) e quebra o jogo.
      },
      format: {
        comments: false         // Remove todos os comentários do código
      }
    }
  }
});