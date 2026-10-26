# Offline Translator

## 목표
서버 없이 브라우저에서 로컬로 동작하는 문서 번역 + 후편집 도구 (90분 내 완성용 경량 버전)

## 스택
React, TypeScript, Tailwind, @huggingface/transformers, Web Worker

## 규칙
- 한 번에 한 기능만 구현한다.
- 요청하지 않은 기능, 라이브러리, 리팩터링을 추가하지 않는다.
- 상태는 useState/useReducer만 사용한다.
- 로그인, DB, 서버, 테스트 코드는 만들지 않는다.
- 각 단계가 끝나면 변경한 파일 목록과 실행 방법을 3줄 이내로 알려준다.
