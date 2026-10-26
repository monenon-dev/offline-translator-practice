import { useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react'
import { compareNumbers, formatMismatch } from './numberCheck'
import type { Backend, Lang, WorkerMessage, WorkerRequest } from './translator.worker'

const LANG_NAMES: Record<Lang, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
}

type Status = 'loading' | 'ready' | 'error'

const STATUS_TEXT: Record<Status, string> = {
  loading: '로딩 중',
  ready: '준비 완료',
  error: '오류',
}

type Paragraph = {
  source: string
  status: 'pending' | 'translating' | 'done' | 'error'
  result?: string
  // 사용자가 수정한 번역문 (원본 번역과 같으면 undefined)
  edited?: string
  error?: string
}

type ParagraphAction =
  | { type: 'reset'; sources: string[] }
  | { type: 'start'; index: number }
  | { type: 'done'; index: number; text: string }
  | { type: 'error'; index: number; message: string }
  | { type: 'edit'; index: number; text: string }
  | { type: 'revert'; index: number }

function paragraphsReducer(state: Paragraph[], action: ParagraphAction): Paragraph[] {
  if (action.type === 'reset') return action.sources.map((source) => ({ source, status: 'pending' }))
  return state.map((p, i) => {
    if (i !== action.index) return p
    if (action.type === 'start') return { ...p, status: 'translating' }
    if (action.type === 'done') return { ...p, status: 'done', result: action.text }
    if (action.type === 'edit') return { ...p, edited: action.text === p.result ? undefined : action.text }
    if (action.type === 'revert') return { ...p, edited: undefined }
    return { ...p, status: 'error', error: action.message }
  })
}

// 빈 줄을 기준으로 문단을 나눈다
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// 수정본이 있으면 수정본, 없으면 번역본. 번역에 실패한 문단은 원문을 표시해 둔다.
function buildExportText(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => p.edited ?? p.result ?? `[번역 실패] ${p.source}`)
    .join('\n\n')
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
}

const buttonClass =
  'rounded px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400'

function App() {
  const workerRef = useRef<Worker | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [progress, setProgress] = useState(0)
  const [backend, setBackend] = useState<Backend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [paragraphs, dispatch] = useReducer(paragraphsReducer, [])
  const [translating, setTranslating] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [srcLang, setSrcLang] = useState<Lang>('ko')
  const [tgtLang, setTgtLang] = useState<Lang>('en')
  // 현재 결과 표가 어떤 언어쌍으로 번역됐는지 (번역 후 선택을 바꿔도 머리글이 맞도록)
  const [resultLangs, setResultLangs] = useState<{ src: Lang; tgt: Lang } | null>(null)

  useEffect(() => {
    const worker = new Worker(new URL('./translator.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'loading') {
        setBackend(msg.backend)
        setProgress(0)
      } else if (msg.type === 'progress') {
        setProgress(msg.progress)
      } else if (msg.type === 'ready') {
        setBackend(msg.backend)
        setProgress(100)
        setStatus('ready')
      } else if (msg.type === 'error') {
        setError(msg.message)
        setStatus('error')
      } else if (msg.type === 'paragraph-start') {
        dispatch({ type: 'start', index: msg.index })
      } else if (msg.type === 'paragraph-done') {
        dispatch({ type: 'done', index: msg.index, text: msg.text })
      } else if (msg.type === 'paragraph-error') {
        dispatch({ type: 'error', index: msg.index, message: msg.message })
      } else {
        setTranslating(false)
      }
    }
    workerRef.current = worker
    return () => worker.terminate()
  }, [])

  const handleTranslate = () => {
    const sources = splitParagraphs(sourceText)
    if (sources.length === 0) {
      setNotice('번역할 내용이 없습니다. 원문을 입력하거나 .txt 파일을 열어 주세요.')
      return
    }
    setNotice(null)
    dispatch({ type: 'reset', sources })
    setEditingIndex(null)
    setTranslating(true)
    setResultLangs({ src: srcLang, tgt: tgtLang })
    workerRef.current?.postMessage({
      type: 'translate',
      paragraphs: sources,
      src: srcLang,
      tgt: tgtLang,
    } satisfies WorkerRequest)
  }

  const handleFileOpen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 선택해도 change 이벤트가 오도록 초기화
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setNotice(`지원하지 않는 파일 형식입니다: ${file.name} — .txt 파일만 열 수 있습니다.`)
      return
    }
    const text = await file.text()
    // UTF-8로 해석할 수 없는 바이트는 U+FFFD로 바뀐다
    if (text.includes('�')) {
      setNotice(`${file.name}을(를) 읽을 수 없습니다. UTF-8로 저장된 텍스트 파일인지 확인해 주세요.`)
      return
    }
    if (!text.trim()) {
      setNotice(`${file.name}이(가) 비어 있습니다.`)
      return
    }
    setNotice(null)
    setSourceText(text)
  }

  const finishedCount = paragraphs.filter((p) => p.status === 'done' || p.status === 'error').length
  const editedCount = paragraphs.filter((p) => p.edited !== undefined).length
  // 번역이 끝난 문단만 현재 번역문(수정본 우선)과 원문의 숫자를 비교
  const mismatches = paragraphs.map((p) =>
    p.status === 'done' ? compareNumbers(p.source, p.edited ?? p.result ?? '') : null,
  )
  const warningCount = mismatches.filter(Boolean).length
  const canExport = paragraphs.length > 0 && !translating

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Offline Translator</h1>
            <div className="flex items-center gap-3 text-sm">
              <span
                className={
                  status === 'ready' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-gray-600'
                }
              >
                {STATUS_TEXT[status]}
                {status === 'loading' && ` ${Math.round(progress)}%`}
              </span>
              {backend && <span className="text-xs text-gray-400">{backend.toUpperCase()}</span>}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-200">
            <div
              className={`h-full transition-all ${status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-4 px-6 py-4">
        {status === 'error' && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">번역 모델을 불러오지 못했습니다.</p>
            <p className="mt-1">
              처음 실행할 때는 모델을 내려받아야 하므로 인터넷 연결이 필요합니다. 연결을 확인한 뒤 페이지를 새로고침해
              주세요.
            </p>
            {error && <p className="mt-1 text-xs text-red-500">상세: {error}</p>}
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <label className="font-semibold" htmlFor="src-lang">
                원문
              </label>
              <select
                id="src-lang"
                value={srcLang}
                onChange={(e) => setSrcLang(e.target.value as Lang)}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
              <span className="text-gray-400">→</span>
              <label className="font-semibold" htmlFor="tgt-lang">
                번역
              </label>
              <select
                id="tgt-lang"
                value={tgtLang}
                onChange={(e) => setTgtLang(e.target.value as Lang)}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
              {srcLang === tgtLang && <span className="text-xs text-red-600">원문과 다른 언어를 고르세요.</span>}
            </div>
            <label className="cursor-pointer text-sm text-blue-600 hover:underline">
              .txt 파일 열기
              <input type="file" accept=".txt,text/plain" onChange={handleFileOpen} className="hidden" />
            </label>
          </div>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="번역할 문서를 붙여넣으세요. 문단은 빈 줄로 구분합니다."
            className="h-40 w-full resize-y rounded border border-gray-300 bg-white p-3 text-sm leading-relaxed focus:border-blue-500 focus:outline-none"
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTranslate}
            disabled={status !== 'ready' || translating || srcLang === tgtLang}
            className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
          >
            번역
          </button>
          {paragraphs.length > 0 && (
            <>
              <span className="text-sm text-gray-600">
                {finishedCount} / {paragraphs.length}
              </span>
              <span className="text-sm text-amber-700">
                수정됨 {editedCount} / {paragraphs.length}
              </span>
              <span className={`text-sm ${warningCount ? 'text-red-600' : 'text-gray-500'}`}>
                ⚠ 숫자 경고 {warningCount}
              </span>
            </>
          )}
          <button
            onClick={() => downloadText(buildExportText(paragraphs), 'translation.txt')}
            disabled={!canExport}
            className={`${buttonClass} ml-auto border border-gray-300 bg-white text-gray-700 hover:bg-gray-100`}
          >
            내보내기
          </button>
        </div>

        {notice && (
          <div className="flex items-start justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p>{notice}</p>
            <button onClick={() => setNotice(null)} className="text-amber-600 hover:text-amber-900" aria-label="닫기">
              ✕
            </button>
          </div>
        )}

        {paragraphs.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            아직 번역한 문단이 없습니다.
            <br />
            원문을 붙여넣거나 .txt 파일을 연 뒤 "번역"을 누르세요.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-gray-300 bg-white text-sm leading-relaxed">
            <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-300 bg-gray-100 text-xs font-semibold text-gray-600">
              <div className="px-4 py-2">원문{resultLangs && ` (${LANG_NAMES[resultLangs.src]})`}</div>
              <div className="px-4 py-2">
                번역{resultLangs && ` (${LANG_NAMES[resultLangs.tgt]})`} · 클릭해서 수정
              </div>
            </div>
            <div className="divide-y divide-gray-200">
              {paragraphs.map((p, i) => {
                const isEdited = p.edited !== undefined
                const mismatch = mismatches[i]
                return (
                  <div key={i} className="grid grid-cols-2 divide-x divide-gray-200">
                    {/* 오른쪽 번역문(p-1 + 테두리)과 줄 높이를 맞추기 위해 같은 여백을 준다 */}
                    <div className="p-3">
                      <p className="whitespace-pre-wrap border border-transparent p-1 text-gray-700">{p.source}</p>
                    </div>
                    <div className={`p-3 ${isEdited ? 'bg-amber-50' : ''}`}>
                      {p.status === 'pending' && <p className="p-1 text-gray-300">대기 중</p>}
                      {p.status === 'translating' && (
                        <div className="p-1">
                          <Spinner />
                        </div>
                      )}
                      {p.status === 'error' && <p className="p-1 text-red-600">번역 오류: {p.error}</p>}
                      {p.status === 'done' &&
                        (editingIndex === i ? (
                          <textarea
                            autoFocus
                            defaultValue={p.edited ?? p.result}
                            onFocus={(e) =>
                              e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)
                            }
                            onBlur={(e) => {
                              dispatch({ type: 'edit', index: i, text: e.target.value })
                              setEditingIndex(null)
                            }}
                            className="field-sizing-content w-full resize-none rounded border border-blue-400 p-1 focus:outline-none"
                          />
                        ) : (
                          <p
                            onClick={() => setEditingIndex(i)}
                            className="cursor-text whitespace-pre-wrap rounded border border-transparent p-1 text-gray-900 hover:bg-gray-100"
                          >
                            {p.edited ?? p.result}
                          </p>
                        ))}
                      {mismatch && editingIndex !== i && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-red-600">
                          <span aria-hidden>⚠</span>
                          {formatMismatch(mismatch)}
                        </p>
                      )}
                      {isEdited && editingIndex !== i && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-800">수정됨</span>
                          <button
                            onClick={() => dispatch({ type: 'revert', index: i })}
                            className="text-xs text-gray-500 underline hover:text-gray-800"
                          >
                            원본 번역으로 되돌리기
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default App
