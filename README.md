# GCM

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
