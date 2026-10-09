// NOTA: a verificação "consultor FORA da lista de permitidos não consegue inserir nas tabelas direct_*"
// é MANUAL (não há conta de teste disponível nessa condição); este script não a cobre.
const { chromium } = require('playwright');
const assert = require('assert');

const BASE = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';
const TEST_EMAIL = 'testes@teste.com';
const TEST_PASS = process.env.TSP_TEST_PASSWORD;
const CLIENT_EMAIL = 'jorjaocorreia@gmail.com';
const CLIENT_PASS = process.env.TSP_CLIENT_PASSWORD;
if (!TEST_PASS || !CLIENT_PASS) { console.error('Defina TSP_TEST_PASSWORD e TSP_CLIENT_PASSWORD'); process.exit(1); }

let failed = 0;
async function step(name, fn) {
    try { await fn(); console.log(`OK   ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}\n`, e.message); }
}

async function login(page, email, pass) {
    await page.goto(`${BASE}/index.html`);
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', pass);
    await page.click('#auth-submit');
    await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 20000 });
}

// Chama a API do Supabase com o JWT da sessão aberta na página
async function apiCount(page, table) {
    return page.evaluate(async (t) => {
        const { data, error } = await window.supabaseClient.from(t).select('id');
        return { n: data ? data.length : -1, error: error ? error.message : null };
    }, table);
}

(async () => {
    const browser = await chromium.launch({ headless: true });

    // ===== Conta permitida (testes@teste.com) =====
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, TEST_EMAIL, TEST_PASS);
    await page.click('.nav-item[data-view="financeiro"]');

    await step('aba Vendas Diretas visível para conta permitida', async () => {
        await page.waitForSelector('#fin-tab-direct', { state: 'visible', timeout: 10000 });
    });

    await step('abrir aba e ver os 4 cards', async () => {
        await page.click('#fin-tab-direct');
        await page.waitForSelector('#ds-cards .stat-card', { timeout: 15000 });
        assert.strictEqual(await page.locator('#ds-cards .stat-card').count(), 4);
    });

    await step('criar venda parcelada em 3x com cliente novo', async () => {
        await page.click('#btn-ds-new-service');
        await page.fill('#ds-svc-new-client', 'E2E Cliente Direto');
        await page.fill('#ds-svc-desc', 'E2E Serviço');
        await page.fill('#ds-svc-total', '300,00');
        await page.fill('#ds-svc-n', '3');
        await page.waitForSelector('.ds-svc-row-amount');
        assert.strictEqual(await page.locator('.ds-svc-row-amount').count(), 3);
        await page.click('#form-ds-service button[type=submit]');
        await page.waitForSelector('#modal-ds-service', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr td:has-text("E2E Serviço 1/3")');
    });

    await step('marcar a parcela 1 como paga e ver Recebido', async () => {
        const row = page.locator('#ds-charges-tbody tr', { hasText: 'E2E Serviço 1/3' });
        await row.getByText('Marcar paga').click();
        await page.click('#form-ds-pay button[type=submit]');
        await page.waitForSelector('#modal-ds-pay', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr:has-text("Paga em")');
        const recebido = await page.locator('#ds-cards .stat-card').nth(1).locator('.stat-value').innerText();
        assert.ok(recebido.includes('100,00'), `Recebido esperado 100,00, veio ${recebido}`);
    });

    await step('desfazer pagamento volta a pendente', async () => {
        const row = page.locator('#ds-charges-tbody tr', { hasText: 'E2E Serviço 1/3' });
        await row.getByText('Desfazer').click();
        await page.waitForSelector('#ds-charges-tbody tr:has-text("E2E Serviço 1/3"):has-text("Pendente")');
    });

    await step('criar mensalidade e gerar cobranças', async () => {
        await page.click('#btn-ds-new-subscription');
        await page.selectOption('#ds-sub-client', { label: 'E2E Cliente Direto' });
        await page.fill('#ds-sub-desc', 'E2E Mensal');
        await page.fill('#ds-sub-amount', '500,00');
        await page.fill('#ds-sub-dueday', '28');
        await page.click('#form-ds-subscription button[type=submit]');
        await page.waitForSelector('#modal-ds-subscription', { state: 'hidden' });
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("E2E Mensal")');
    });

    await step('reajustar mensalidade', async () => {
        const row = page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' });
        await row.getByText('Reajustar').click();
        await page.fill('#ds-adj-amount', '650,00');
        await page.click('#form-ds-adjust button[type=submit]');
        await page.waitForSelector('#modal-ds-adjust', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr:has-text("Mensalidade"):has-text("650,00")');
    });

    await step('cancelar mensalidade (2 passos) e reativar', async () => {
        const row = page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' });
        await row.getByText('Cancelar').click();
        await page.click('#btn-ds-cancel-confirm');   // 1º clique: pede confirmação
        await page.click('#btn-ds-cancel-confirm');   // 2º clique: confirma
        await page.waitForSelector('#modal-ds-cancel', { state: 'hidden' });
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("Cancelada desde")');
        // Reativar abre uma NOVA mensalidade pré-preenchida; o contrato cancelado permanece cancelado.
        await page.locator('#ds-contracts-tbody tr', { hasText: 'Cancelada desde' }).getByText('Reativar').click();
        await page.waitForSelector('#modal-ds-subscription.active');
        assert.strictEqual(await page.inputValue('#ds-sub-desc'), 'E2E Mensal');
        await page.click('#form-ds-subscription button[type=submit]');
        await page.waitForSelector('#modal-ds-subscription', { state: 'hidden' });
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("E2E Mensal"):has-text("Ativa")');
        assert.strictEqual(await page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' }).count(), 2);
        assert.ok(await page.locator('#ds-contracts-tbody tr', { hasText: 'Cancelada desde' }).count() >= 1);
    });

    await step('botão de ocultar valores esconde os valores novos', async () => {
        // O app nasce com valores ocultos por padrão (applyMoneyVisibility); garante o estado "visível"
        // antes e alterna para "oculto" de forma determinística.
        const isHidden = () => page.evaluate(() => document.body.classList.contains('money-hidden'));
        if (await isHidden()) await page.click('#btn-toggle-money-fin');
        assert.strictEqual(await isHidden(), false, 'valores deveriam estar visíveis');
        await page.click('#btn-toggle-money-fin');
        assert.strictEqual(await isHidden(), true, 'body sem classe money-hidden');
        await page.waitForTimeout(500); // transição de filter de 0.35s
        const hiddenCount = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#financeiro-panel-direct .money-value'))
                .filter(el => getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).filter.includes('blur')).length);
        assert.ok(hiddenCount > 0, 'nenhum .money-value ficou oculto');
    });

    await step('aba Tecinco continua carregando', async () => {
        await page.click('#fin-tab-tecinco');
        await page.waitForSelector('#financeiro-table', { state: 'visible' });
        await page.waitForSelector('#financeiro-tbody tr', { timeout: 15000 });
    });

    await step('FK cruzada: client_id/contract_id inexistentes são rejeitados pelo banco', async () => {
        const r = await page.evaluate(async () => {
            const db = window.supabaseClient;
            const uid = (await db.auth.getUser()).data.user.id;
            const k = await db.from('direct_contracts').insert({
                user_id: uid, client_id: crypto.randomUUID(), kind: 'subscription', description: 'x',
                monthly_amount_cents: 100, due_day: 1, start_month: '2030-01'
            });
            const c = await db.from('direct_charges').insert({
                user_id: uid, contract_id: crypto.randomUUID(), charge_key: 'i:1', competence: '2030-01',
                due_date: '2030-01-10', amount_cents: 100
            });
            return { contract: k.error ? k.error.message : null, charge: c.error ? c.error.message : null };
        });
        assert.ok(r.contract, 'insert de contrato com client_id aleatório deveria falhar');
        assert.ok(r.charge, 'insert de cobrança com contract_id aleatório deveria falhar');
    });

    await step('banco barra exclusão de contrato com cobrança paga', async () => {
        const r = await page.evaluate(async () => {
            const db = window.supabaseClient;
            const { data: cs } = await db.from('direct_clients').select('id').eq('name', 'E2E Cliente Direto');
            const { data: ks } = await db.from('direct_contracts').select('id').eq('client_id', cs[0].id).eq('kind', 'service');
            const { data: chs } = await db.from('direct_charges').select('id').eq('contract_id', ks[0].id).limit(1);
            const today = new Date().toISOString().slice(0, 10);
            await db.from('direct_charges').update({ status: 'paid', paid_at: today }).eq('id', chs[0].id);
            const del = await db.from('direct_contracts').delete().eq('id', ks[0].id);
            await db.from('direct_charges').update({ status: 'pending', paid_at: null }).eq('id', chs[0].id);
            return del.error ? del.error.message : null;
        });
        assert.ok(r && /pagas/i.test(r), `exclusão deveria ser barrada com mensagem contendo "pagas"; veio: ${r}`);
    });

    // ===== Limpeza dos dados do teste (RLS permite apagar o que é seu) =====
    await step('limpeza: remover dados E2E', async () => {
        await page.evaluate(async () => {
            const db = window.supabaseClient;
            const { data: cs } = await db.from('direct_clients').select('id').eq('name', 'E2E Cliente Direto');
            for (const c of cs || []) {
                const { data: ks } = await db.from('direct_contracts').select('id').eq('client_id', c.id);
                for (const k of ks || []) {
                    await db.from('direct_charges').update({ status: 'pending', paid_at: null }).eq('contract_id', k.id);
                    await db.from('direct_contracts').delete().eq('id', k.id);
                }
                await db.from('direct_clients').delete().eq('id', c.id);
            }
        });
    });
    await ctx.close();

    // ===== Isolamento: usuário autenticado FORA da lista de e-mails permitidos =====
    // jorjaocorreia@gmail.com autentica, mas não está em direct_sales_allowed() (e hoje nem tem papel em
    // user_roles, então o app a desloga). Por isso usamos um cliente Supabase separado, sem passar pela UI.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE + '/index.html');
    await page2.waitForFunction(() => window.supabase && window.TSP_CONFIG && window.TSP_CONFIG.SUPABASE_URL);
    await step('conta fora da lista: autentica via cliente isolado', async () => {
        const email = await page2.evaluate(async ({ e, p }) => {
            window.__iso = window.supabase.createClient(window.TSP_CONFIG.SUPABASE_URL, window.TSP_CONFIG.SUPABASE_ANON_KEY,
                { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'iso-test' } });
            const { data, error } = await window.__iso.auth.signInWithPassword({ email: e, password: p });
            return error ? 'ERRO: ' + error.message : data.user.email;
        }, { e: CLIENT_EMAIL, p: CLIENT_PASS });
        assert.strictEqual(email, CLIENT_EMAIL);
    });
    await step('conta fora da lista: SELECT nas 4 tabelas volta vazio', async () => {
        for (const t of ['direct_clients', 'direct_contracts', 'direct_charges', 'direct_contract_adjustments']) {
            const r = await page2.evaluate(async (tbl) => {
                const { data, error } = await window.__iso.from(tbl).select('id');
                return { n: data ? data.length : -1, error: error ? error.message : null };
            }, t);
            assert.ok(r.n === 0 || r.error, t + ' vazou ' + r.n + ' linhas');
        }
    });
    await step('conta fora da lista: INSERT com o próprio user_id é negado pela RLS (cláusula de e-mail)', async () => {
        const err = await page2.evaluate(async () => {
            const uid = (await window.__iso.auth.getUser()).data.user.id;
            const { error } = await window.__iso.from('direct_clients').insert({ user_id: uid, name: 'x-nao-deve-existir' });
            return error ? error.message : null;
        });
        assert.ok(err && /row-level security|violates/i.test(err), 'INSERT deveria ser negado pela RLS, veio: ' + err);
    });
    await ctx2.close();

    await browser.close();
    if (failed) { console.error(`${failed} verificação(ões) falharam`); process.exit(1); }
    console.log('Todas as verificações passaram');
})();
