const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '')));

const server = app.listen(8081, async () => {
    console.log("Servidor de debug rodando na porta 8081");
    try {
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        
        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
        page.on('pageerror', error => console.error('BROWSER ERROR:', error.message));
        page.on('response', response => {
            if (!response.ok()) {
                console.warn('HTTP ERROR:', response.url(), response.status());
            }
        });

        console.log("Navegando...");
        await page.goto('http://127.0.0.1:8081', { waitUntil: 'networkidle0' });
        
        await new Promise(r => setTimeout(r, 2000));
        
        await browser.close();
        server.close();
        console.log("Debug finalizado.");
    } catch (e) {
        console.error("Erro no script de debug:", e);
        server.close();
    }
});
