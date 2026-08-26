import { chromium } from 'playwright-core'
const S = process.env.S
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const p = await (await nav.newContext({ viewport: { width: 1400, height: 800 } })).newPage()
await p.goto(`file://${S}/procedimiento.html`, { waitUntil: 'load' })
const problemas = await p.evaluate(() => {
  const malas = []
  document.querySelectorAll('.lamina').forEach((l, i) => {
    const banda = l.querySelector('.banda')
    if (banda && banda.scrollHeight > banda.clientHeight + 2)
      malas.push(`lámina ${i}: la banda desborda (${banda.scrollHeight} > ${banda.clientHeight}) · ${l.querySelector('h2')?.textContent}`)
    const exp = l.querySelector('.explicacion')
    if (exp && exp.scrollHeight > 0.78 * 96)
      malas.push(`lámina ${i}: explicación de ${exp.scrollHeight}px · ${l.querySelector('h2')?.textContent}`)
    if (l.scrollHeight > l.clientHeight + 2)
      malas.push(`lámina ${i}: la lámina desborda (${l.scrollHeight} > ${l.clientHeight})`)
  })
  return malas
})
console.log(problemas.length ? problemas.join('\n') : 'todas las láminas entran')
await nav.close()
