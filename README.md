# GCM

## 기능

- **GitHub Device Flow 인증**: 브라우저에서 GitHub 토큰 발급
- **모델 목록 조회**: Copilot에서 사용 가능한 모델 표시 (카테고리별 분류)
- **구독/사용량 확인**: 플랜, 프리미엄 요청 잔여량, 갱신일 등
- **토큰 직접 입력**: 수동으로 토큰을 붙여넣어 저장 가능

## 설치

### 1. GCM 확장 설치

GCM 폴더를 SillyTavern 확장 디렉토리에 복사합니다:

```
SillyTavern/data/<user>/extensions/third-party/GCM/
```

또는 SillyTavern UI에서 "Install Extension"으로 설치합니다.

### 2. CORS 프록시 활성화 (필수!)

GCM은 GitHub/Copilot API를 호출하기 위해 SillyTavern 내장 CORS 프록시가 필요합니다.
(브라우저에서 직접 외부 API를 호출하면 CORS에 의해 차단됩니다.)

SillyTavern의 `config.yaml` 파일을 열고 다음 설정을 추가/변경:

```yaml
enableCorsProxy: true
```

SillyTavern을 **재시작**하면 완료입니다.

## 사용법

1. SillyTavern 확장 패널에서 **GCM** 섹션을 찾습니다.
2. **🔐 토큰 발급 시작** 버튼을 클릭하거나, 직접 토큰을 입력하고 **💾** 저장합니다.
3. 토큰이 설정되면 **모델 목록**과 **사용량**을 조회할 수 있습니다.

## 보안

- 토큰은 SillyTavern 확장 설정에 저장되며, 외부로 전송되지 않습니다.
- CORS 프록시는 SillyTavern 서버를 통해 요청을 중계합니다.
