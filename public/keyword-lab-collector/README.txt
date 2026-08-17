Commerce OS Keyword Lab Collector v0.1.1

목적:
1688 상품 페이지의 실제 렌더링 화면에서 중국 상품명과 옵션명·옵션값을 읽어 Commerce OS Keyword Lab으로 전달합니다.

설치:
1. ZIP을 다운로드해 새 폴더에 압축 해제합니다.
2. Chrome 주소창에 chrome://extensions 를 입력합니다.
3. 개발자 모드를 켭니다.
4. 압축해제된 확장프로그램을 로드합니다.
5. Commerce OS Ops Center의 Keyword Lab 탭을 새로고침합니다.

v0.1.1 변경:
- commerce-os-ops-center.vercel.app 기본 주소뿐 아니라 새 Vercel 배포/Preview 주소에서도 수집기 연결 상태를 감지합니다.
- 실제 동작은 commerce-os-ops-center 계열 Vercel 주소에서만 허용합니다.

수집 원칙:
- 상세페이지 SaaS에서 검증된 렌더링 DOM 접근 방식을 참고하지만, 코드는 Commerce OS Ops Center 내부의 독립 수집기입니다.
- AI-Saurus 저장소나 상세페이지 제작 기능을 호출하거나 수정하지 않습니다.

이 수집기는 상품 수정, 주문, 가격 변경을 수행하지 않습니다.
