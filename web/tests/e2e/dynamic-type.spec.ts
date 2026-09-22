import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

// P4-T06 dynamic type: every size is in rem, so a larger root font (iOS Text Size, up to 200 % here) grows the whole
// UI without clipping text or scrolling sideways. Screenshots of each screen are attached to the report.

const LONG_FRONT =
  'to take something into account when making a decision about a very long and complicated matter that ' +
  'involves many different people, places, events and a lot of other small things to remember all at once'

/** No element sticks out to the right of the viewport (the page would scroll sideways). */
async function expectNoSidewaysScroll(page: Page, screen: string) {
  const wide = await page.evaluate(() => {
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && found.length < 5; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      const right = range.getBoundingClientRect().right
      if (right > window.innerWidth + 1) found.push(`"${node.textContent?.slice(0, 50)}" → ${Math.round(right)}`)
    }
    for (const element of document.querySelectorAll('body *')) {
      const right = element.getBoundingClientRect().right
      if (right > window.innerWidth + 1 && found.length < 10)
        found.push(`<${element.tagName.toLowerCase()}> → ${Math.round(right)}`)
    }
    return found
  })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `${screen}: ${wide.join('; ')}`).toBeLessThanOrEqual(1)
}

for (const scale of [100, 200]) {
  test(`text at ${scale} %: no clipped text or sideways scrolling, answer buttons stay clear`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((percent) => {
      // WebKit runs init scripts before the document element exists.
      const apply = () => document.documentElement.style.setProperty('font-size', `${percent}%`)
      if (document.documentElement) apply()
      else document.addEventListener('readystatechange', apply, { once: true })
    }, scale)
    await setUpApp(page)
    await seed(page, {
      decks: [deckRow('d1', 'English', { directions: 'forward' })],
      cards: [cardRow('c1', 'd1', LONG_FRONT, 'учитывать'), cardRow('c2', 'd1', 'cat', 'кот')],
      card_states: [newStateRow('c1'), newStateRow('c2')],
    })
    expect(LONG_FRONT.length).toBeGreaterThanOrEqual(200)

    // SCREENSHOT_DIR also saves them as files (for a look at the layouts).
    const shoot = async (name: string) => {
      const path =
        process.env.SCREENSHOT_DIR && `${process.env.SCREENSHOT_DIR}/${testInfo.project.name}-${name}-${scale}.png`
      await testInfo.attach(`${name} ${scale}%`, { body: await page.screenshot({ path }), contentType: 'image/png' })
    }

    for (const [name, path] of [
      ['today', '/'],
      ['deck', '/decks/d1'],
      ['settings', '/settings'],
    ] as const) {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await expectNoSidewaysScroll(page, name)
      await shoot(name)
    }
    for (const tab of ['Today', 'Decks', 'Statistics', 'Settings']) {
      await expect(page.getByRole('link', { name: tab })).toBeVisible()
    }

    await page.goto('/study?deck=d1')
    await page.getByRole('button', { name: 'Start' }).click()
    const card = page.getByRole('button', { name: /^Word: to take something/ })
    const know = page.getByRole('button', { name: 'Know', exact: true })
    await expect(card).toBeVisible()
    await expect(know).toBeInViewport()
    const cardBox = await card.boundingBox()
    const knowBox = await know.boundingBox()
    expect(cardBox && knowBox && knowBox.y >= cardBox.y + cardBox.height - 1).toBe(true)
    await expectNoSidewaysScroll(page, 'study')
    await shoot('study card with a 200-character front')
  })
}
