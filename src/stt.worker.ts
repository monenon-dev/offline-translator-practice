import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers'
import type { Lang } from './translator.worker'

// 영·한·일·중을 모두 알아듣는 다국어 Whisper 모델
const MODEL_ID = 'Xenova/whisper-small'

// 메인 → 워커 (audio는 16kHz 모노)
export type SttRequest = { type: 'transcribe'; audio: Float32Array; lang: Lang }

// 워커 → 메인
export type SttMessage =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; text: string }
  | { type: 'transcribe-error'; message: string }

const post = (msg: SttMessage) => self.postMessage(msg)

let transcriber: AutomaticSpeechRecognitionPipeline | null = null

async function init() {
  transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    // 인코더를 q8로 압축하면 빠른 말을 잘 못 알아들어서 인코더만 fp32로 둔다
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: (p: ProgressInfo) => {
      if (p.status === 'progress_total') post({ type: 'progress', progress: p.progress })
    },
  })
  post({ type: 'ready' })
}

async function transcribe(audio: Float32Array, lang: Lang) {
  try {
    // 30초가 넘는 녹음은 겹치는 구간으로 잘라서 인식한다
    const out = await transcriber!(audio, { language: lang, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
    post({ type: 'result', text: (Array.isArray(out) ? out[0] : out).text.trim() })
  } catch (err) {
    post({ type: 'transcribe-error', message: String((err as Error)?.message ?? err) })
  }
}

self.onmessage = (e: MessageEvent<SttRequest>) => {
  if (e.data.type === 'transcribe') transcribe(e.data.audio, e.data.lang)
}

init().catch((err) => post({ type: 'error', message: String(err?.message ?? err) }))
