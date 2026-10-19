# 공연장 좌석표

좌석별 학번 입력 · 학년/반별 출결현황 · 전달사항을 여러 사람이 함께 입력하고 저장하는 웹페이지입니다.

## 구조

```
├─ api/state.js        # 저장용 서버 함수 (Upstash Redis)
├─ public/index.html   # 화면
├─ package.json
└─ vercel.json
```

## 배포 (Vercel)

1. 이 저장소를 Vercel에서 Import (Framework Preset: Other)
2. Storage / Marketplace 에서 **Upstash Redis** 추가 후 프로젝트에 Connect
3. Redeploy
4. `https://내주소.vercel.app/api/state` 를 열어 `{"ok":true,...}` 가 보이면 정상
