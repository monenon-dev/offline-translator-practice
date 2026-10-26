# Offline Translator
서버 없이 브라우저에서 동작하는 영·한·일·중 문서 번역 + 후편집 도구 (transformers.js, `Xenova/m2m100_418M` q8, Web Worker, WASM).
실행: `pnpm install` → `pnpm dev` → http://localhost:5173 (첫 실행 시 모델 약 640MB 다운로드, 이후 브라우저 캐시 사용)
기능: 원문/번역 언어 선택, 붙여넣기·.txt 열기 → 문단별·문장 단위 순차 번역(진행률·스피너) → 원문/번역 행 정렬, 숫자 불일치 경고
후편집: 번역문 클릭해 수정, "수정됨" 표시·개수, 원본 번역으로 되돌리기, 수정본 우선으로 .txt 내보내기
