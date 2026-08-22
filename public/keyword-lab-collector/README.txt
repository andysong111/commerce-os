Commerce OS Keyword Lab Collector v0.1.2

목적:
1688 상품 페이지의 실제 렌더링 화면에서 중국 상품명과 옵션명·옵션값을 읽어 Commerce OS Keyword Lab으로 전달합니다.
또한 Error 404, 상품 단종·삭제, 판매처·공장 폐업과 로그인·보안검증 같은 일시 접속 문제를 구분해 Commerce OS에 전달합니다.

설치·업데이트:
1. ZIP을 다운로드해 새 폴더에 압축 해제합니다.
2. Chrome 주소창에 chrome://extensions 를 입력합니다.
3. 개발자 모드를 켭니다.
4. 기존 Commerce OS Keyword Lab Collector가 있으면 삭제합니다.
5. 압축해제된 확장프로그램을 로드합니다.
6. Commerce OS Ops Center를 Ctrl+F5로 새로고침합니다.

v0.1.2 변경:
- 1688 Error 404, 상품 하차·삭제, 판매처·공장 폐업을 영구 링크 오류로 판정합니다.
- 로그인, 보안검증, 접속 제한, 일시적인 빈 화면은 영구 오류로 확정하지 않습니다.
- 상품출시 진행관리에서 고정링크 1번을 한 번에 하나씩 저속 검사할 수 있습니다.
- commerce-os-ops-center.vercel.app 기본 주소와 Commerce OS 계열 Vercel Preview 주소에서 작동합니다.

수집 원칙:
- 상세페이지 SaaS에서 검증된 렌더링 DOM 접근 방식을 참고하지만, 코드는 Commerce OS Ops Center 내부의 독립 수집기입니다.
- AI-Saurus 저장소나 상세페이지 제작 기능을 호출하거나 수정하지 않습니다.
- 링크 검사는 사용자가 실행할 때만 진행하며, 페이지를 여는 것만으로 1688 링크를 자동 호출하지 않습니다.

이 수집기는 상품 수정, 주문, 가격 변경을 수행하지 않습니다.
고정링크 삭제·승격은 상품출시 진행관리 화면에서 사용자가 확인한 뒤 별도 버튼으로 실행합니다.
