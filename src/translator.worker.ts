import { pipeline, type ProgressInfo, type TranslationPipeline } from '@huggingface/transformers'

// 영·한·일·중 12개 방향을 모델 하나로 번역하는 다국어 모델
const MODEL_ID = 'Xenova/m2m100_418M'
// m2m100은 WebGPU에서 q4f16·fp16이면 출력이 깨지고 q8은 WASM보다 3배 이상 느려서 WASM q8로 고정한다
const BACKEND: Backend = 'wasm'

export type Backend = 'webgpu' | 'wasm'

// m2m100 언어 코드
export type Lang = 'ko' | 'en' | 'ja' | 'zh'

// 메인 → 워커
export type WorkerRequest = { type: 'translate'; paragraphs: string[]; src: Lang; tgt: Lang }

// 워커 → 메인
export type WorkerMessage =
  | { type: 'loading'; backend: Backend }
  | { type: 'progress'; progress: number }
  | { type: 'ready'; backend: Backend }
  | { type: 'error'; message: string }
  | { type: 'paragraph-start'; index: number }
  | { type: 'paragraph-done'; index: number; text: string }
  | { type: 'paragraph-error'; index: number; message: string }
  | { type: 'translate-done' }

const post = (msg: WorkerMessage) => self.postMessage(msg)

let translator: TranslationPipeline | null = null

async function init() {
  post({ type: 'loading', backend: BACKEND })
  translator = await pipeline('translation', MODEL_ID, {
    device: BACKEND,
    dtype: 'q8',
    progress_callback: (p: ProgressInfo) => {
      if (p.status === 'progress_total') post({ type: 'progress', progress: p.progress })
    },
  })
  post({ type: 'ready', backend: BACKEND })
}

// 문단을 문장 단위로 나눈다.
// 여러 문장을 한 번에 넣으면 모델이 문장·숫자를 빠뜨려서, 짧은 문단도 문장마다 따로 번역한다.
function splitIntoChunks(text: string, lang: Lang): string[] {
  return Array.from(new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text), (s) => s.segment.trim()).filter(
    Boolean,
  )
}

async function translateParagraph(text: string, src: Lang, tgt: Lang): Promise<string> {
  const results: string[] = []
  for (const chunk of splitIntoChunks(text, src)) {
    const [out] = await translator!(chunk, { src_lang: src, tgt_lang: tgt })
    results.push(out.translation_text)
  }
  // 일본어·중국어는 문장 사이에 공백을 넣지 않는다
  return results.join(tgt === 'ja' || tgt === 'zh' ? '' : ' ')
}

async function translateAll(paragraphs: string[], src: Lang, tgt: Lang) {
  for (let index = 0; index < paragraphs.length; index++) {
    post({ type: 'paragraph-start', index })
    try {
      post({ type: 'paragraph-done', index, text: await translateParagraph(paragraphs[index], src, tgt) })
    } catch (err) {
      post({ type: 'paragraph-error', index, message: String((err as Error)?.message ?? err) })
    }
  }
  post({ type: 'translate-done' })
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'translate') translateAll(e.data.paragraphs, e.data.src, e.data.tgt)
}

init().catch((err) => post({ type: 'error', message: String(err?.message ?? err) }))
