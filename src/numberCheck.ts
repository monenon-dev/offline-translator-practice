// 1,200 / 3.14 / 1,234.5 / 42 형태의 숫자 (천 단위 콤마, 소수점 포함)
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

// 숫자를 단어로 쓴 경우 (10일 → ten days, 제3자 → third party, 十点 → 10시)
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth']
// 11월 → November. may/march 같은 일반 단어와 섞이지 않게 대문자로 시작할 때만 인정한다
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const WORD_VALUES = new Map<string, number>()
UNITS.forEach((w, i) => WORD_VALUES.set(w, i))
TENS.forEach((w, i) => w && WORD_VALUES.set(w, i * 10))
ORDINALS.forEach((w, i) => w && WORD_VALUES.set(w, i))

const WORD_RE = new RegExp(`\\b(?:(${TENS.filter(Boolean).join('|')})-(${UNITS.slice(1, 10).join('|')})|(${[...WORD_VALUES.keys()].join('|')}))\\b`, 'gi')
const MONTH_RE = new RegExp(`\\b(${MONTHS.filter(Boolean).join('|')})\\b`, 'g')
// 1년간 → for a year. a/an은 흔한 단어라 뒤에 시간 단위가 올 때만 1로 본다
const A_UNIT_RE = /\b(?:a|an)\s+(?:year|month|week|day|hour|minute|second)\b/gi
// 한자 숫자 1~99 (三, 十, 十二, 二十三). 일본어·중국어 문서용
const CJK_DIGITS = '一二三四五六七八九'
const CJK_RE = /[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九]/g

export type NumberMismatch = {
  // 원문에는 있는데 번역문에 없는 숫자 (원문 표기 그대로)
  missing: string[]
  // 번역문에만 있는 숫자 (번역문 표기 그대로)
  extra: string[]
}

type Extracted = { raw: string; value: string }

function extractNumbers(text: string): Extracted[] {
  // 콤마를 지우고 Number로 정규화해서 1,200 = 1200, 3.50 = 3.5 로 비교한다
  return (text.match(NUMBER_RE) ?? []).map((raw) => ({ raw, value: String(Number(raw.replace(/,/g, ''))) }))
}

function extractWordNumbers(text: string): Extracted[] {
  const words = Array.from(text.matchAll(WORD_RE), (m) => {
    const value = m[1] ? WORD_VALUES.get(m[1].toLowerCase())! + WORD_VALUES.get(m[2].toLowerCase())! : WORD_VALUES.get(m[3].toLowerCase())!
    return { raw: m[0], value: String(value) }
  })
  const months = Array.from(text.matchAll(MONTH_RE), (m) => ({ raw: m[0], value: String(MONTHS.indexOf(m[1])) }))
  const cjk = Array.from(text.matchAll(CJK_RE), (m) => {
    const digit = (c: string) => CJK_DIGITS.indexOf(c) + 1
    const [tens, ones] = m[0].includes('十') ? m[0].split('十') : [null, m[0]]
    const value = (tens === null ? 0 : tens ? digit(tens) * 10 : 10) + (ones ? digit(ones) : 0)
    return { raw: m[0], value: String(value) }
  })
  const aUnits = Array.from(text.matchAll(A_UNIT_RE), (m) => ({ raw: m[0], value: '1' }))
  return [...words, ...months, ...cjk, ...aUnits]
}

function takeMatch(pool: Extracted[], value: string): boolean {
  const i = pool.findIndex((t) => t.value === value)
  if (i === -1) return false
  pool.splice(i, 1)
  return true
}

// 원문과 번역문의 숫자를 개수까지 맞춰 비교한다. 일치하면 null.
// 숫자 단어는 반대편 숫자와 짝을 맞출 때만 쓰고, 그 자체로 불일치로 세지 않는다 (one of the parties, 一般 등)
export function compareNumbers(source: string, translation: string): NumberMismatch | null {
  const targetDigits = extractNumbers(translation)
  const targetWords = extractWordNumbers(translation)
  const sourceWords = extractWordNumbers(source)
  const missing: string[] = []
  for (const n of extractNumbers(source)) {
    if (!takeMatch(targetDigits, n.value) && !takeMatch(targetWords, n.value)) missing.push(n.raw)
  }
  const extra = targetDigits.filter((t) => !takeMatch(sourceWords, t.value)).map((t) => t.raw)
  return missing.length || extra.length ? { missing, extra } : null
}

export function formatMismatch({ missing, extra }: NumberMismatch): string {
  const list = (nums: string[]) => (nums.length ? nums.join(', ') : '없음')
  return `숫자 불일치: 원문 ${list(missing)} / 번역 ${list(extra)}`
}
