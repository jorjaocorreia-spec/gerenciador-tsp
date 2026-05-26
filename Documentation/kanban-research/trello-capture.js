/**
 * Trello UI Reverse Engineering — Playwright Capture Script
 * Faz scraping visual, DOM, CSS tokens e fluxos UX do Trello
 * Saída: screenshots/ + trello-dom-analysis.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'screenshots');
const TRELLO_URL = 'https://trello.com';
const DEMO_BOARD_URL = 'https://trello.com/b/nC8QJJoZ/trello-development-roadmap';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function capture(page, name, clip = null) {
  const opts = { path: path.join(OUT_DIR, `${name}.png`), fullPage: !clip };
  if (clip) opts.clip = clip;
  await page.screenshot(opts);
  console.log(`  ✓ Screenshot: ${name}.png`);
}

async function extractCSSTokens(page) {
  return page.evaluate(() => {
    const styles = {};
    const root = document.documentElement;
    const computed = getComputedStyle(root);

    // Extrair variáveis CSS customizadas
    const vars = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText === ':root' || rule.selectorText === 'html') {
            const text = rule.cssText;
            const matches = text.matchAll(/--([^:]+):\s*([^;]+);/g);
            for (const m of matches) {
              vars[`--${m[1].trim()}`] = m[2].trim();
            }
          }
        }
      } catch (e) {}
    }

    // Capturar computed styles dos elementos-chave
    const selectors = [
      '.board-wrapper', '.js-list', '.list-wrapper', '.list-header',
      '.list-card', '.card-title', '.js-card-name',
      '.list-add-button', '.open-add-list',
      '[data-testid="board-header"]', '[data-testid="list-header"]',
      '[data-testid="list-card"]', '[data-testid="card-name"]'
    ];

    const elementStyles = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const cs = getComputedStyle(el);
        elementStyles[sel] = {
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          borderRadius: cs.borderRadius,
          padding: cs.padding,
          margin: cs.margin,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily,
          boxShadow: cs.boxShadow,
          border: cs.border,
          width: cs.width,
          minWidth: cs.minWidth,
          maxWidth: cs.maxWidth,
          gap: cs.gap,
          display: cs.display,
          flexDirection: cs.flexDirection,
          overflow: cs.overflow,
          cursor: cs.cursor,
          transition: cs.transition,
        };
      }
    }

    return { cssVars: vars, elementStyles };
  });
}

async function extractDOMStructure(page) {
  return page.evaluate(() => {
    function getStructure(el, depth = 0, maxDepth = 4) {
      if (depth > maxDepth) return null;
      return {
        tag: el.tagName?.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList || []).slice(0, 6),
        dataAttrs: Object.fromEntries(
          Array.from(el.attributes || [])
            .filter(a => a.name.startsWith('data-') || a.name.startsWith('aria-'))
            .map(a => [a.name, a.value.substring(0, 60)])
        ),
        text: el.childNodes.length === 1 && el.firstChild?.nodeType === 3
          ? el.textContent?.trim().substring(0, 80)
          : null,
        children: Array.from(el.children || []).slice(0, 8).map(c => getStructure(c, depth + 1, maxDepth)).filter(Boolean)
      };
    }

    const results = {};

    // Board container
    const board = document.querySelector('.board-wrapper, [data-testid="board-container"], .js-board-list');
    if (board) results.board = getStructure(board);

    // Lista (coluna)
    const list = document.querySelector('.js-list, [data-testid="list"]');
    if (list) results.list = getStructure(list);

    // Card
    const card = document.querySelector('.js-member-card, .list-card, [data-testid="list-card"]');
    if (card) results.card = getStructure(card);

    // Header
    const header = document.querySelector('[data-testid="board-header"], .board-header');
    if (header) results.header = getStructure(header);

    // Add card button
    const addCard = document.querySelector('.open-card-composer, [data-testid="list-add-card-button"]');
    if (addCard) results.addCardButton = getStructure(addCard);

    return results;
  });
}

async function extractInteractionPatterns(page) {
  return page.evaluate(() => {
    const patterns = {};

    // Botões e suas dimensões
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 20);
    patterns.buttons = buttons.map(b => ({
      text: b.textContent?.trim().substring(0, 40),
      classes: Array.from(b.classList).slice(0, 4),
      dataTestId: b.getAttribute('data-testid'),
      ariaLabel: b.getAttribute('aria-label'),
      style: {
        padding: getComputedStyle(b).padding,
        borderRadius: getComputedStyle(b).borderRadius,
        background: getComputedStyle(b).backgroundColor,
        fontSize: getComputedStyle(b).fontSize,
      }
    }));

    // Inputs e textareas
    const inputs = Array.from(document.querySelectorAll('input, textarea')).slice(0, 10);
    patterns.inputs = inputs.map(i => ({
      type: i.type,
      placeholder: i.placeholder?.substring(0, 40),
      classes: Array.from(i.classList).slice(0, 4),
    }));

    // Links de navegação
    const navLinks = Array.from(document.querySelectorAll('nav a, [role="navigation"] a, .header-btn')).slice(0, 15);
    patterns.navigation = navLinks.map(a => ({
      text: a.textContent?.trim().substring(0, 30),
      href: a.href?.substring(0, 60),
      classes: Array.from(a.classList).slice(0, 4),
    }));

    // Drag handles
    const dragEls = Array.from(document.querySelectorAll('[draggable="true"], [data-drag-handle]')).slice(0, 5);
    patterns.dragElements = dragEls.map(d => ({
      tag: d.tagName,
      classes: Array.from(d.classList).slice(0, 4),
      cursor: getComputedStyle(d).cursor,
    }));

    return patterns;
  });
}

async function main() {
  console.log('\n🎯 Trello UI Reverse Engineering — Playwright Capture');
  console.log('=========================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const analysis = {
    timestamp: new Date().toISOString(),
    sections: {}
  };

  // ── 1. HOMEPAGE ──────────────────────────────────────────────────
  console.log('📸 1/6 — Homepage...');
  const homePage = await browser.newPage();
  await homePage.setViewportSize({ width: 1440, height: 900 });
  try {
    await homePage.goto(TRELLO_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await capture(homePage, '01-homepage-full');
    await capture(homePage, '01-homepage-hero', { x: 0, y: 0, width: 1440, height: 600 });
    await capture(homePage, '01-homepage-navbar', { x: 0, y: 0, width: 1440, height: 70 });

    const homeMeta = await homePage.evaluate(() => ({
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.content,
      fonts: Array.from(document.fonts).map(f => f.family).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10),
      primaryColors: (() => {
        const els = document.querySelectorAll('[class*="btn"], [class*="button"]');
        return Array.from(els).slice(0, 3).map(el => ({
          bg: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
          borderRadius: getComputedStyle(el).borderRadius,
          padding: getComputedStyle(el).padding,
        }));
      })()
    }));
    analysis.sections.homepage = homeMeta;
    console.log(`  Title: ${homeMeta.title}`);
  } catch (e) {
    console.log(`  ⚠ Homepage error: ${e.message}`);
    analysis.sections.homepage = { error: e.message };
  }
  await homePage.close();

  // ── 2. PUBLIC BOARD ──────────────────────────────────────────────
  console.log('\n📸 2/6 — Public Trello Board...');
  const boardPage = await browser.newPage();
  await boardPage.setViewportSize({ width: 1440, height: 900 });

  // User-agent moderno para evitar bloqueio
  await boardPage.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8'
  });

  try {
    await boardPage.goto(DEMO_BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    await capture(boardPage, '02-board-full');
    await capture(boardPage, '02-board-header', { x: 0, y: 0, width: 1440, height: 60 });

    // Capturar primeira coluna
    const firstList = await boardPage.$('.js-list, [data-testid="list"]');
    if (firstList) {
      const bbox = await firstList.boundingBox();
      if (bbox) {
        await capture(boardPage, '02-board-column', {
          x: Math.max(0, bbox.x - 5),
          y: Math.max(0, bbox.y - 5),
          width: Math.min(bbox.width + 10, 1440),
          height: Math.min(bbox.height + 10, 900)
        });
      }
    }

    // Capturar primeiro card
    const firstCard = await boardPage.$('.js-member-card, [data-testid="list-card"]');
    if (firstCard) {
      const bbox = await firstCard.boundingBox();
      if (bbox) {
        await capture(boardPage, '02-board-card', {
          x: Math.max(0, bbox.x - 5),
          y: Math.max(0, bbox.y - 5),
          width: Math.min(bbox.width + 10, 500),
          height: Math.min(bbox.height + 10, 300)
        });
      }
    }

    // DOM e CSS
    const cssTokens = await extractCSSTokens(boardPage);
    const domStructure = await extractDOMStructure(boardPage);
    const interactions = await extractInteractionPatterns(boardPage);

    analysis.sections.board = { cssTokens, domStructure, interactions };

    // Medidas das colunas
    analysis.sections.boardMeasurements = await boardPage.evaluate(() => {
      const list = document.querySelector('.js-list, [data-testid="list"]');
      const card = document.querySelector('.list-card, [data-testid="list-card"]');
      const header = document.querySelector('.list-header, [data-testid="list-header"]');
      const addBtn = document.querySelector('.open-card-composer, [data-testid="list-add-card-button"]');

      const measure = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          width: Math.round(r.width), height: Math.round(r.height),
          padding: cs.padding, margin: cs.margin,
          borderRadius: cs.borderRadius, background: cs.backgroundColor,
          boxShadow: cs.boxShadow, fontSize: cs.fontSize,
          fontWeight: cs.fontWeight, color: cs.color,
        };
      };

      return {
        column: measure(list),
        card: measure(card),
        columnHeader: measure(header),
        addCardButton: measure(addBtn),
        boardBackground: (() => {
          const board = document.querySelector('.board-wrapper, .js-board-list');
          return board ? getComputedStyle(board).backgroundColor : null;
        })()
      };
    });

    console.log('  ✓ DOM capturado');
    console.log('  ✓ CSS tokens extraídos');
    console.log('  ✓ Medidas capturadas');

  } catch (e) {
    console.log(`  ⚠ Board error: ${e.message}`);
    analysis.sections.board = { error: e.message };
    // Ainda tenta pegar screenshot do estado atual
    try {
      await capture(boardPage, '02-board-current-state');
    } catch (_) {}
  }

  // ── 3. HOVER STATE ───────────────────────────────────────────────
  console.log('\n📸 3/6 — Hover states...');
  try {
    const firstCard = await boardPage.$('.js-member-card, [data-testid="list-card"]');
    if (firstCard) {
      await firstCard.hover();
      await sleep(500);
      const bbox = await firstCard.boundingBox();
      if (bbox) {
        await capture(boardPage, '03-card-hover', {
          x: Math.max(0, bbox.x - 10),
          y: Math.max(0, bbox.y - 10),
          width: Math.min(bbox.width + 20, 400),
          height: Math.min(bbox.height + 20, 300)
        });
      }

      const hoverStyles = await boardPage.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          transform: cs.transform, boxShadow: cs.boxShadow,
          background: cs.backgroundColor, border: cs.border,
          opacity: cs.opacity, zIndex: cs.zIndex,
        };
      }, '.js-member-card, [data-testid="list-card"]');

      analysis.sections.hoverStates = { card: hoverStyles };
    }
  } catch (e) {
    console.log(`  ⚠ Hover error: ${e.message}`);
  }

  // ── 4. CLICK CARD — MODAL ────────────────────────────────────────
  console.log('\n📸 4/6 — Card detail modal...');
  try {
    const firstCard = await boardPage.$('.js-member-card, [data-testid="list-card"]');
    if (firstCard) {
      await firstCard.click();
      await sleep(2000);
      await capture(boardPage, '04-card-modal-full');
      await capture(boardPage, '04-card-modal-top', { x: 0, y: 0, width: 1440, height: 600 });

      const modalStructure = await boardPage.evaluate(() => {
        const modal = document.querySelector('.window, [data-testid="card-back"]') ||
                      document.querySelector('.card-detail-window');
        if (!modal) return null;

        const sections = {};
        ['[data-testid="card-back-title"]', '.window-title', '.card-title',
         '[data-testid="card-back-description"]', '.description',
         '[data-testid="card-back-checklist"]', '.checklist',
         '[data-testid="card-back-labels"]', '.card-labels',
         '[data-testid="card-back-due-date"]', '.due-date',
         '[data-testid="card-back-members"]', '.member',
         '[data-testid="card-back-attachments"]', '.attachments',
         '[data-testid="card-back-comment-input"]', '.comment-box',
         '.js-add-checklist-button', '[data-testid="card-back-add-checklist"]',
         '.window-sidebar',
        ].forEach(sel => {
          const el = document.querySelector(sel);
          if (el) {
            sections[sel] = {
              found: true,
              text: el.textContent?.trim().substring(0, 60),
              rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })()
            };
          }
        });

        return {
          modalSize: (() => { const r = modal.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
          layout: {
            hasSidebar: !!document.querySelector('.window-sidebar'),
            hasMainContent: !!document.querySelector('.window-main-col'),
            sections
          }
        };
      });

      analysis.sections.cardModal = modalStructure;
      console.log('  ✓ Modal capturado');

      // Fechar modal
      await boardPage.keyboard.press('Escape');
      await sleep(500);
    }
  } catch (e) {
    console.log(`  ⚠ Modal error: ${e.message}`);
  }

  // ── 5. ADD CARD FLOW ─────────────────────────────────────────────
  console.log('\n📸 5/6 — Add card flow...');
  try {
    const addBtn = await boardPage.$('.open-card-composer, [data-testid="list-add-card-button"], .list-add-button');
    if (addBtn) {
      await addBtn.click();
      await sleep(1000);
      await capture(boardPage, '05-add-card-form');

      const formAnalysis = await boardPage.evaluate(() => {
        const composer = document.querySelector('.list-card-composer, [data-testid="list-card-composer"]');
        if (!composer) return null;
        const textarea = composer.querySelector('textarea');
        const buttons = Array.from(composer.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim(),
          classes: Array.from(b.classList).slice(0, 4),
          style: {
            bg: getComputedStyle(b).backgroundColor,
            color: getComputedStyle(b).color,
            borderRadius: getComputedStyle(b).borderRadius,
            padding: getComputedStyle(b).padding,
          }
        }));
        return {
          hasTextarea: !!textarea,
          textareaPlaceholder: textarea?.placeholder,
          buttons,
          composerStyle: {
            bg: getComputedStyle(composer).backgroundColor,
            borderRadius: getComputedStyle(composer).borderRadius,
            padding: getComputedStyle(composer).padding,
            boxShadow: getComputedStyle(composer).boxShadow,
          }
        };
      });

      analysis.sections.addCardForm = formAnalysis;

      await boardPage.keyboard.press('Escape');
      await sleep(500);
    }
  } catch (e) {
    console.log(`  ⚠ Add card error: ${e.message}`);
  }

  // ── 6. RESPONSIVE / MOBILE ───────────────────────────────────────
  console.log('\n📸 6/6 — Responsive views...');
  try {
    await boardPage.setViewportSize({ width: 768, height: 1024 });
    await sleep(1000);
    await capture(boardPage, '06-board-tablet');

    await boardPage.setViewportSize({ width: 375, height: 812 });
    await sleep(1000);
    await capture(boardPage, '06-board-mobile');

    await boardPage.setViewportSize({ width: 1440, height: 900 });
  } catch (e) {
    console.log(`  ⚠ Responsive error: ${e.message}`);
  }

  await boardPage.close();

  // ── 7. SALVAR ANÁLISE JSON ───────────────────────────────────────
  const jsonPath = path.join(__dirname, 'trello-dom-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));
  console.log(`\n✅ Análise salva em: trello-dom-analysis.json`);
  console.log(`📁 Screenshots em: ${OUT_DIR}`);

  const files = fs.readdirSync(OUT_DIR);
  console.log(`\n📸 ${files.length} screenshots capturados:`);
  files.forEach(f => console.log(`   ${f}`));

  await browser.close();
  console.log('\n✅ Captura concluída!\n');
}

main().catch(e => {
  console.error('❌ Erro:', e.message);
  process.exit(1);
});
